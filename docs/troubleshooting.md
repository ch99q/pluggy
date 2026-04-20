# Troubleshooting

Grouped by command / stage. Error messages here are copied verbatim from
the code, with placeholders (`<...>`) for interpolated values.

## `pluggy init`

### `Invalid project name: "<name>". Only alphanumeric characters and underscores are allowed.`

`--name` must match `^[a-zA-Z0-9_]+$`. Hyphens, dots, and Unicode aren't
allowed. This is enforced by `init` and checked again by `doctor`.

### `Invalid main class: "<main>". It must be a valid Java classpath (e.g., com.example.Main).`

`--main` must be a dotted Java class path with at least one dot —
`package.Class`. Single-word class names aren't accepted; Java requires
a package for production plugin classes.

### Network errors during init or dev

`pluggy init` hits PaperMC / Spigot / Modrinth to pick the latest
version for `compatibility.versions[0]`. If your network is offline or
the upstream is down:

- Pass `--version <semver>` to skip the network call.
- Or just put a version in `project.json` after `init` completes.

`pluggy dev` also hits the platform registry for the server jar. The
first run per `(platform, version)` needs network; subsequent runs
reuse the cache.

## `pluggy install` / `pluggy remove`

### `install: at the workspace root — pass --workspace <name> to pick a target for "<plugin>"`

You ran `pluggy install <identifier>` at a multi-workspace root. pluggy
doesn't know which workspace to add the dep to. Pass `--workspace <name>`
to choose one.

### `install: --workspaces and a specific [plugin] are mutually exclusive — pick one workspace with --workspace <name>`

Same idea — you can't add one dep to every workspace in one command.

### `install: conflicting declarations of "<name>" across workspaces — <source>@<v1> vs <source>@<v2>`

Two workspaces declare the same dep with different versions. Bulk
install refuses to pick a winner. Align the versions in `project.json`
by hand, then rerun.

### `Maven: no registries configured for "<g>:<a>:<v>". Declare a Maven registry in project.json:registries.`

Maven deps need at least one entry in `project.json:registries`. Maven
Central is a common default:

```json
"registries": ["https://repo1.maven.org/maven2/"]
```

### `Maven: could not resolve "<coord>" from any configured registry. Tried: ...`

The artifact wasn't found at any registry in your list. The "Tried:"
block shows the exact URL for each attempt and the HTTP response — use
that to diagnose.

Common causes:

- Typo in the coordinate. Maven is case-sensitive.
- Missing registry for a non-Central artifact (e.g. PaperMC's Maven repo
  for `paper-api`).
- 401 on a private registry with missing or wrong credentials.

### `Modrinth: version "<v>" not found for slug "<slug>". available: <top-3>, ...`

The exact version string doesn't exist. Modrinth uses the plugin's
declared `version_number`, which may not be a clean semver. Check
`pluggy info <slug>` or https://modrinth.com/plugin/<slug>/versions to
see the real strings.

### `Modrinth: version "<v>" of "<slug>" is a <type> release; pass --beta to install pre-releases`

You asked for a specific pre-release without `--beta`. Re-run with
`--beta` to accept alpha/beta versions.

### `remove: "<plugin>" is not declared in <workspace> (<path>)`

You asked to remove something that isn't there. Check `pluggy list` for
the actual dep names — the key in `dependencies` is what remove wants,
not the slug.

### `remove: at the workspace root — pass --workspace <name> or --workspaces to disambiguate`

At a multi-workspace root, `remove` refuses to guess. Pick one workspace
with `--workspace <name>` or confirm "all" with `--workspaces`.

## `pluggy build`

### `build: project "<name>" declares platforms from different descriptor families ("<a>" uses "<path1>", "<b>" uses "<path2>"). Split them into separate workspaces — one per family.`

`compatibility.platforms` contains a mix of Bukkit-family (paper, folia,
spigot, bukkit), BungeeCord-family (waterfall, travertine), and
Velocity. One plugin, one descriptor. Move the others into separate
workspaces. See [Workspaces > Multi-family monorepos](./workspaces.md#multi-family-monorepos).

### `compile: javac exited with code <n> for project "<name>" (last 40 lines): ...`

Standard Java compile errors. pluggy surfaces the last 40 stderr lines
verbatim. Fix the errors in your editor and re-run.

### `compile: no .java sources found under "<dir>" for project "<name>"`

The workspace's `src/` directory is empty or missing. pluggy expects
sources to live under `<workspace>/src/`.

### `compile: failed to spawn javac for project "<name>": spawn javac ENOENT`

No `javac` on `PATH`. Install a JDK (not just a JRE). On macOS:
`brew install openjdk@21` and symlink `javac` into a directory that's on
your `PATH`. On Linux: `apt install openjdk-21-jdk` or equivalent.

Run `pluggy doctor` to see the detected JDK version.

### `shade: workspace dependency "<name>" has not been built yet — expected jar at "<path>". Build the sibling workspace first (topological order is the caller's responsibility).`

You're shading a `workspace:` dep from inside a workspace. From the repo
root, `pluggy build` orders workspaces topologically — the sibling
builds first. Run from the root, or run `pluggy build --workspace <dep>`
first then the dependent.

### `resources: source path "<rel>" (key "<key>") does not exist at "<abs>"`

A `resources` entry points at a file or directory that doesn't exist.
Check the path relative to the project root.

## `pluggy dev`

### `java not found`

See the `javac` entry above — same fix. `pluggy dev` spawns `java` to
run the server jar, and spawns `javac` (via the build pipeline) to
compile your sources.

### Server hangs on first startup

First run per platform-version downloads the server jar (Paper) or runs
BuildTools (Spigot/Bukkit). BuildTools can take minutes on slow machines
— it compiles CraftBukkit or Spigot from source through a Mojang
mapping step. Second run is fast; the jar is cached.

### Plugin doesn't load despite compiling

Check the server logs in `dev/logs/latest.log`. Common causes:

- `plugin.yml` main class doesn't match the compiled class name — did
  you rename the Java class without updating `project.main`?
- The plugin depends on another plugin (`depend:` in `plugin.yml`) that
  isn't in `dev/plugins/`. Add it to `dependencies` or
  `project.dev.extraPlugins`.
- `api-version` mismatch. pluggy derives `api-version` from
  `compatibility.versions[0]` (e.g. `"1.21.8"` → `"1.21"`). If
  you need `api-version` unset, provide your own `plugin.yml` via
  `project.resources`.

### `/reload` misbehaves but full restart is fine

Don't use `--reload`. Bukkit's `/reload` has known reliability problems
with stateful plugins. Full restart is slower but correct.

## `pluggy doctor`

### `✖ Java toolchain — java not found or failed to run: spawn java ENOENT`

Install a JDK. See the `javac` entry above.

### `! Java toolchain — Java 22 — spigot/bukkit BuildTools needs Java 8-21`

The detected JDK is outside the window Spigot BuildTools supports. This
is a warning — if you're building against Paper, it doesn't matter. If
you're building against Spigot or Bukkit, install a JDK in the supported
range and make it the first one on `PATH`.

### `✖ Cache reachability — cache is not writable: <path> (<errno>)`

The cache directory exists but pluggy can't write to it. Typical causes:

- Wrong ownership (e.g. you ran `sudo pluggy` once and `root` owns the
  cache). Fix with `sudo chown -R $USER <cache-path>`.
- Disk full.
- Filesystem mounted read-only.

### `! Registry <url> — unreachable: <errno>`

A declared Maven registry didn't respond to a `HEAD` with a 2xx/3xx/4xx.
It's a warning — some registries legitimately reject HEAD. Try
`pluggy install maven:<coord>@<version>` to see the real error from the
resolver.

### `✖ Workspace graph — workspace dependency cycle detected: <a> -> <b> -> <a>`

Two workspaces depend on each other through `workspace:`. This is a
build-order impossibility. Break the cycle by extracting a third
workspace that both sides depend on.

## Lockfile

### `Failed to parse lockfile at <path>: <json-error>`

`pluggy.lock` is malformed. Usually a merge conflict marker left over
from a rebase. Delete the file and run `pluggy install --force` to
regenerate.

### `Unsupported lockfile version: <n> (at <path>; expected 1)`

Someone wrote a newer-format lockfile with a newer pluggy. Upgrade
pluggy with `pluggy upgrade` (or `sudo pluggy upgrade` on POSIX installs).

### `Invalid lockfile entry "<key>" at <path>: ...`

Manual edit that broke the schema. Delete the entry and rerun
`pluggy install`.

## Environment

### `Error: ENOSPC: no space left on device`

The cache directory is full. `pluggy doctor` reports the current size.
Wipe with `rm -rf <cache-path>` — pluggy rebuilds on the next command.

### Windows: `pluggy` not recognized after install

The install script adds the binary directory to your user `PATH`, but
open terminals don't see the update until they restart. Open a fresh
terminal.

### macOS: "cannot be opened because the developer cannot be verified"

Gatekeeper is blocking an unsigned binary. Run:

```bash
xattr -d com.apple.quarantine /usr/local/bin/pluggy
```

Or bypass once through `System Settings > Privacy & Security`.

## Still stuck?

- Run the command with `--verbose`. pluggy logs intermediate steps,
  registry URLs it tried, and the reason for every skip.
- Run `pluggy doctor` and paste the output into your bug report.
- Check `pluggy.lock` and `project.json` with a JSON linter — a
  stray trailing comma will break parsing in ways that don't always
  surface at the parse line.
