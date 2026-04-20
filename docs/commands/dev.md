# `pluggy dev`

Run a live Minecraft server with your plugin and its runtime dependencies
loaded. Rebuilds and restarts on source change.

## Usage

```text
pluggy dev [options]
```

## Flags

| Flag                 | Default                              | Notes                                                   |
| -------------------- | ------------------------------------ | ------------------------------------------------------- |
| `--workspace <name>` | none                                 | **Required** at a multi-workspace root.                 |
| `--platform <id>`    | `project.compatibility.platforms[0]` | Override the platform (e.g. `paper` → `spigot`).        |
| `--version <semver>` | `project.compatibility.versions[0]`  | Override the MC version.                                |
| `--port <n>`         | `project.dev.port` or `25565`        | Written into `server.properties`.                       |
| `--memory <x>`       | `project.dev.memory` or `2G`         | JVM heap; becomes `-Xmx<value>`.                        |
| `--clean`            | off                                  | Wipe `dev/` before staging.                             |
| `--fresh-world`      | off                                  | Keep `dev/` but delete every `dev/world*` subdirectory. |
| `--no-watch`         | watch on                             | Run once; don't restart on change.                      |
| `--reload`           | off                                  | Use `/reload confirm` instead of a full restart.        |
| `--offline`          | off                                  | Force `online-mode=false` in `server.properties`.       |

## What it does

1. Resolves the primary platform (`paper` by default) and MC version.
2. Downloads the platform jar into
   `~/Library/Caches/pluggy/versions/<id>-<ver>-<build>.jar`.
   (Linux: `~/.cache/pluggy/...`. Windows: `%LOCALAPPDATA%\pluggy\cache\...`.)
3. Runs a full `pluggy build` for the target workspace.
4. Resolves runtime plugin deps — each declared dep is opened as a zip,
   and those containing the platform's descriptor file
   (`plugin.yml` / `bungee.yml` / `velocity-plugin.json`) are flagged as
   runtime plugins. Compile-only libraries are excluded from
   `dev/plugins/`.
5. Stages `dev/` next to the workspace's `project.json`:
   - `dev/server.jar` → hardlinked (copy fallback) from the cached
     platform jar.
   - `dev/eula.txt` → `eula=true` with an auto-accepted header. Set
     `PLUGGY_DEV_NO_EULA=1` to have pluggy leave the file alone so you
     can accept Mojang's EULA yourself.
   - `dev/server.properties` → generated from the project defaults,
     merged with `project.dev.serverProperties`.
6. Populates `dev/plugins/` with the plugin jar, runtime plugin deps,
   and `project.dev.extraPlugins`. Each entry is hardlinked by basename.
7. Spawns `java -Xmx<mem> <jvmArgs> -jar server.jar` inside `dev/`.

## The `dev/` layout

```text
dev/
├── server.jar
├── eula.txt
├── server.properties
├── world/           (created by the server on first run)
├── world_nether/
├── world_the_end/
├── logs/
└── plugins/
    ├── my_plugin-1.0.0.jar
    └── worldedit-7.3.15.jar
```

Everything under `dev/` is safe to delete. `--clean` wipes it, `--fresh-world`
keeps it but removes every `dev/world*` subdirectory.

## Restart vs reload

On source change (`src/`, `project.json`, any file referenced by
`project.resources`), pluggy debounces for 200 ms and then rebuilds.

**Default (restart)** — pluggy writes `stop\n` to the server's stdin,
waits for it to exit, swaps the plugin jar under `dev/plugins/`, and
respawns the JVM. Safe but slow (tens of seconds for world save +
shutdown + startup).

**`--reload`** — pluggy swaps the jar in place and sends `reload confirm`
to the server stdin. Fast (under a second) but uses Bukkit's `/reload`,
which is widely known to be unreliable for stateful plugins (listener
registration, static caches, ClassLoader-pinned objects). Use only when
you know your plugin is reload-clean.

Rebuild failures don't restart the server — pluggy keeps the previous
jar running and logs the failure:

```text
dev: change detected — rebuilding…
✖ dev: rebuild failed — keeping previous jar running: compile: javac exited with code 1 ...
```

## Shutdown

- First Ctrl+C: writes `stop\n` to the server, waits up to 30 seconds
  for clean exit. If the server doesn't exit in time, `child.kill()`
  sends the default signal (SIGTERM on POSIX, `taskkill` equivalent on
  Windows via Node's kill shim).
- Second Ctrl+C within 2 seconds: SIGKILL the server immediately.
- The signal handler is installed via `installShutdownHandler` from
  `portable.ts` and works the same on macOS, Linux, and Windows.

The dev command returns when the server has exited and the watcher has
been torn down.

## Watching

Watched locations:

- `<workspace>/src/` (recursive).
- Every directory referenced by `project.resources` (recursive, normalized
  to the parent dir — atomic-rewrite editors evict the file inode, so
  file-level watchers die; watching the dir survives).
- The directory containing `project.json`.

Debounce is 200 ms. A burst of saves coalesces into one rebuild.

## Human output

```text
$ pluggy dev
dev: starting my_plugin
[server output on stdout/stderr, unfiltered]
```

## JSON output

`--json` on `dev` writes exactly one JSON line at startup, then hands
stdout/stderr to the server unchanged:

```json
{
  "status": "starting",
  "platform": "paper",
  "version": "1.21.8",
  "port": 25565,
  "devDir": "/repo/dev"
}
```

This is designed for CI and supervisors. After the envelope line, the
rest of stdout is Minecraft's own logs.

## Error cases

| Trigger                                 | Message                                                                                                        |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Multi-workspace root, no `--workspace`  | `dev requires --workspace <name> at a root that declares workspaces. Known workspaces: ...`                    |
| `--workspace X` from inside workspace Y | `--workspace "X" does not match the current workspace "Y". Run from the root to target a different workspace.` |
| No platforms declared                   | `runDev: no platform configured — set compatibility.platforms[0] or pass --platform`                           |
| `java` not on PATH                      | Standard `spawn ENOENT` — see [Troubleshooting](../troubleshooting.md#java-not-found).                         |

## See also

- [Dev server deep dive](../dev-server.md) — staging, EULA, shutdown,
  extraPlugins.
- [`pluggy build`](./build.md) — the same build is what `dev` runs on every change.
- [`pluggy doctor`](./doctor.md) — validate your JDK and project before
  starting a dev session.
