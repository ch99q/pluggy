# Dev server

`pluggy dev` boots a real Paper / Spigot / Velocity server in a staging
directory next to your project, with your plugin and its runtime
dependencies loaded. On every file save, pluggy debounces for 200 ms,
rebuilds, and restarts the server (or `/reload`s it if you pass
`--reload`).

This page covers the moving parts: the staging directory layout, runtime
plugin detection, EULA handling, shutdown semantics, and how restart vs
reload differ.

## Staging layout

```text
<workspace>/
├── project.json
├── src/
├── bin/
│   └── my_plugin-1.0.0.jar     (from pluggy build)
└── dev/
    ├── server.jar              (hardlinked from the cache)
    ├── eula.txt
    ├── server.properties
    ├── logs/                   (written by the server)
    ├── world/                  (written by the server)
    ├── world_nether/
    ├── world_the_end/
    └── plugins/
        ├── my_plugin-1.0.0.jar
        ├── worldedit-7.3.15.jar
        └── helper.jar          (from project.dev.extraPlugins)
```

`dev/` is entirely disposable. `--clean` wipes it before each startup;
`--fresh-world` preserves it but deletes `dev/world*`.

The server jar at `dev/server.jar` is a hardlink to
`~/Library/Caches/pluggy/versions/<id>-<version>-<build>.jar` (macOS;
other OSes have equivalent paths). Hardlink falls back to copy on
cross-filesystem setups.

## `server.properties` rendering

`server.properties` is rendered fresh on every `pluggy dev`. User
overrides come from `project.dev.serverProperties` and win over pluggy's
defaults. The default block is:

```properties
motd=<project.name> dev
online-mode=false
server-port=25565
```

- `motd` — derived from the project name.
- `online-mode` — forced `false` unless `project.dev.onlineMode` is set
  to `true` (or `--offline` is passed, which forces `false` harder).
  Offline mode lets you connect without a Mojang account, which is the
  norm for local dev.
- `server-port` — `project.dev.port` or `--port`, default 25565.

Any key you declare in `project.dev.serverProperties` shows up after the
defaults, in declaration order. User keys win on conflict with a default.

## EULA handling

pluggy writes `dev/eula.txt` on every run:

```text
# EULA auto-accepted by pluggy on your behalf. Set PLUGGY_DEV_NO_EULA=1 to manage this file yourself.
# See https://account.mojang.com/documents/minecraft_eula
eula=true
```

This is a convenience for local dev. Set `PLUGGY_DEV_NO_EULA=1` in your
environment to opt out — pluggy leaves `dev/eula.txt` untouched and you
can accept the EULA manually (which the server will prompt you to do on
first launch).

You're still bound by Mojang's EULA whichever path you take. pluggy isn't
accepting it _for_ you in any legal sense; it's saving you from rerunning
the server once to flip a flag.

## Runtime plugin detection

Compile dependencies and plugin dependencies are the same list in
`project.json:dependencies`. pluggy distinguishes them at dev-time by
opening each jar and checking whether it contains the primary platform's
descriptor file.

| Platform                     | Descriptor path        |
| ---------------------------- | ---------------------- |
| paper, folia, spigot, bukkit | `plugin.yml`           |
| waterfall, travertine        | `bungee.yml`           |
| velocity                     | `velocity-plugin.json` |

A jar that contains the descriptor is a _runtime plugin_ — it's
hardlinked into `dev/plugins/`. Everything else (pure library jars like
Adventure, Caffeine, the platform's own API jar) stays on the build
classpath but is not installed as a plugin.

`project.dev.extraPlugins` adds extra plugin jars by path — relative
to the workspace root — that aren't declared in `dependencies`. Useful
for locally-patched jars and test harnesses.

## Watching and debouncing

pluggy watches:

- `<workspace>/src/` recursively.
- Every directory referenced by `project.resources` (file-to-dir
  normalization — atomic-rewrite editors replace the inode, so file-level
  watchers die on save; watching the parent directory survives).
- The directory containing `project.json`.

On any event, pluggy sets a 200 ms debounce timer. Subsequent events
within the window reset the timer. When the timer fires, pluggy runs the
rebuild + restart/reload pipeline.

`--no-watch` disables the watcher entirely: pluggy builds, spawns the
server, and when the server exits the command returns.

## Restart vs `/reload`

### Default: full restart

```text
dev: change detected — rebuilding…
✔ build succeeded
(sends `stop\n` to server stdin; waits for exit)
(hardlinks the new jar into dev/plugins/)
(spawns `java -Xmx2G -jar server.jar` again)
```

A full shutdown + restart. Safe, slow, predictable. Expect 10 – 30
seconds depending on world size and plugin count.

### `--reload`: Bukkit reload

```text
dev: change detected — rebuilding…
✔ build succeeded
(hardlinks the new jar into dev/plugins/)
(sends `reload confirm\n` to server stdin)
```

Seconds, not tens of seconds. But — and this is loud in the code
comments — Bukkit's `/reload` is notoriously unreliable. Static caches
pinned by the old ClassLoader, listeners registered through Bukkit's API
that survive reload, scheduler tasks that reference old classes — all of
these lead to subtle bugs.

Use `--reload` only when you know your plugin is reload-clean. Default
to restart.

### When rebuild fails

The server stays running with the old jar. pluggy logs:

```text
dev: change detected — rebuilding…
✖ dev: rebuild failed — keeping previous jar running: compile: javac exited with code 1 ...
```

Fix the compile error in your editor, save, and pluggy will try again.

## Shutdown

Ctrl+C triggers the shutdown ladder in `portable.ts`:

1. **First Ctrl+C.** pluggy writes `stop\n` to the server's stdin and
   starts a 30-second timer. If the server exits before the timer
   expires, everything cleans up gracefully.
2. **Timer expires.** `child.kill()` sends SIGTERM on POSIX (or the
   Windows equivalent via Node's shim). The server gets one last chance
   to clean up.
3. **Second Ctrl+C within 2 seconds.** pluggy sends SIGKILL. The server
   dies immediately. World data may be unsafe.

The 2-second "second Ctrl+C" window resets after it expires. If you wait
longer than 2 seconds between presses, the second Ctrl+C restarts the
graceful sequence instead of force-killing.

On Windows the same semantics apply — Node's `ChildProcess.kill()`
wraps `taskkill` internally, and the SIGINT handler is installed through
`process.on('SIGINT', ...)` which Node translates from Ctrl+C events.

## Spawning directly

pluggy runs:

```text
java -Xmx<memory> <project.dev.jvmArgs or --args> -jar server.jar nogui
```

Working directory is `dev/`. stdin is piped — pluggy's stdin is forwarded
so you can type server commands into the terminal. stdout/stderr are
inherited, so the server's logs are your terminal's output. The trailing
`nogui` suppresses Bukkit's AWT console window on desktop JVMs — pluggy
always runs the server headless because stdin/stdout is its control
channel.

No shell is spawned. Windows handles `.exe` lookup internally when the
command is just `java`.

## Performance tips

- Use a separate `jvmArgs` for dev that cranks G1GC (`-XX:+UseG1GC`,
  `-XX:MaxGCPauseMillis=50`). The default heap is 2G — bump with
  `--memory 4G` if your plugin is heavy.
- `--fresh-world` between runs makes startup predictable without paying
  the world-regeneration cost on every change.
- If you're iterating on a pure command handler and don't care about
  world state, `--reload` is fine (despite the caveat above).

## See also

- [`pluggy dev` command reference](./commands/dev.md) — every flag.
- [Cross-platform notes](./cross-platform.md) — signal handling and path
  semantics across OSes.
- [project.json `dev` field](./project-json.md#dev-optional) — config
  shape.
