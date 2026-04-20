# Pluggy — Feature Spec

The canonical specification for the pluggy CLI: `project.json` schema, every command and flag, cross-cutting behavior.

This document describes the **target state**. Current code implements a subset; see §8 for outstanding work.

Status markers:

- ✅ implemented and verified
- ⚠️ stubbed (command is registered, action is a no-op or partial)
- ❌ not implemented / explicitly removed
- 🎯 planned behavior that is not yet in code

---

## 0. Scope

Pluggy is a **plugin development tool**. It targets Minecraft server plugin platforms — code that runs inside an existing server binary using that server's plugin API.

Out of scope:

- **Mods.** Fabric, Forge, Quilt, NeoForge, LiteLoader, and similar loaders patch the game itself and require fundamentally different toolchains (Mixin, access transformers, remapping between intermediate and production mappings). They are intentionally not supported. Modrinth categorizes them separately (`project_type: "mod"` vs `"plugin"`), and pluggy only resolves plugins.
- **Resource packs, shaders, data packs, modpacks.** Different artifact types with their own tooling.

If mod support ever lands, it belongs in a sibling tool (same `project.json` grammar, different platform providers and build pipeline).

Within plugins, pluggy covers three descriptor families:

- **Bukkit family** (bukkit, spigot, paper, folia) → `plugin.yml`
- **BungeeCord family** (waterfall, travertine) → `bungee.yml`
- **Velocity** → `velocity-plugin.json`

---

## 1. `project.json` — configuration schema

A pluggy project is defined by `project.json` at the project root. `pluggy` walks up from the current working directory until it finds one.

### 1.1 Full example

```jsonc
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "A plugin that does things.",
  "authors": ["Alice", "Bob"],
  "main": "com.example.MyPlugin",

  "compatibility": {
    "versions": ["1.21.8", "1.21.7"],
    "platforms": ["paper", "bukkit"],
  },

  "dependencies": {
    "worldedit": "7.3.15",
    "placeholderapi": "2.11.6",
    "custom-lib": {
      "source": "file:./libs/custom-lib.jar",
      "version": "1.0.0",
    },
    "adventure-api": {
      "source": "maven:net.kyori:adventure-api",
      "version": "4.22.0",
    },
  },

  "registries": [
    "https://repo1.maven.org/maven2/",
    {
      "url": "https://private.example.com/maven",
      "credentials": { "username": "user", "password": "secret" },
    },
  ],

  "shading": {
    "some-library": {
      "include": ["com/library/api/**", "com/library/util/**"],
      "exclude": ["com/library/internal/**"],
    },
  },

  "resources": {
    "plugin.yml": "./resources/plugin.yml",
    "config.yml": "./resources/config.yml",
    "lang/": "./i18n/",
  },

  "ide": "vscode",
  "workspaces": ["./modules/api", "./modules/impl"],

  "dev": {
    "port": 25565,
    "memory": "2G",
    "onlineMode": false,
    "jvmArgs": ["-XX:+UseG1GC"],
    "serverProperties": {
      "motd": "my plugin dev server",
      "difficulty": "peaceful",
    },
  },
}
```

### 1.2 Top-level fields

| Field           | Type       | Required               | Purpose                                                                                                                                     |
| --------------- | ---------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`          | `string`   | ✅                     | Project identifier. Validated `^[a-zA-Z0-9_]+$`. Used for the output jar filename and descriptor `name`.                                    |
| `version`       | `string`   | ✅                     | Semver (`1.0.0`, `1.0.0-alpha`). Validated `^\d+\.\d+\.\d+(-[a-zA-Z0-9]+)?$`.                                                               |
| `description`   | `string`   | optional               | Free-form. Written into the descriptor at build time.                                                                                       |
| `authors`       | `string[]` | optional               | Written into the descriptor at build time.                                                                                                  |
| `main`          | `string`   | ✅ (plugin workspaces) | Fully-qualified Java class. Must contain at least one `.`. Validated `^[a-zA-Z0-9_.]+$`. Not required at root when workspaces are declared. |
| `compatibility` | `object`   | ✅                     | Target platforms and MC versions. See §1.3.                                                                                                 |
| `dependencies`  | `object`   | optional               | Declared deps. See §1.4.                                                                                                                    |
| `registries`    | `array`    | optional               | Additional Maven repositories. See §1.5.                                                                                                    |
| `shading`       | `object`   | optional               | Per-dependency class include/exclude rules. See §1.6.                                                                                       |
| `resources`     | `object`   | optional               | Files bundled into the jar. See §1.7.                                                                                                       |
| `ide`           | `string`   | optional               | `"vscode"` ✅ / `"eclipse"` ✅ / `"intellij"` 🎯. Build writes matching project files pointing at the resolved classpath.                   |
| `workspaces`    | `string[]` | optional               | Paths to workspace sub-projects. See §1.8.                                                                                                  |
| `dev`           | `object`   | optional               | Dev server settings for `pluggy dev`. See §1.9.                                                                                             |

### 1.3 `compatibility` — target platforms and versions

```json
{
  "compatibility": {
    "versions": ["1.21.8", "1.21.7"],
    "platforms": ["paper", "bukkit"]
  }
}
```

| Field       | Type       | Semantics                                                                                                                                                                          |
| ----------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `versions`  | `string[]` | Target MC versions. `versions[0]` is the **primary** version used by `build` to select the server jar. Additional entries drive compatibility checks when resolving Modrinth deps. |
| `platforms` | `string[]` | Target platforms. `platforms[0]` is the **primary** platform; it determines which descriptor file is generated (§5.2). Defaults to `"paper"` if unset.                             |

Registered platforms: `paper`, `folia`, `travertine`, `velocity`, `waterfall`, `spigot`, `bukkit`.

If `platforms` spans more than one descriptor family (e.g. `["paper", "waterfall"]`), `build` refuses and asks the user to split into workspaces, one per family.

### 1.4 `dependencies` — declared deps

A map from dependency name → version string **or** `Dependency` object.

```ts
type DependencyValue = string | { source: string; version: string };
```

The short form (bare string) is sugar for `{ source: "modrinth:<key>", version: "<string>" }`. The long form is required for any non-Modrinth source.

**Source notation** (see §6 for the formal grammar):

| Form                       | Example                           | Resolution                |
| -------------------------- | --------------------------------- | ------------------------- |
| `modrinth:<slug>`          | `"modrinth:worldedit"`            | Modrinth API              |
| `maven:<group>:<artifact>` | `"maven:net.kyori:adventure-api"` | Resolved via `registries` |
| `file:<path>`              | `"file:./libs/foo.jar"`           | Local jar on disk         |
| `workspace:<name>`         | `"workspace:mypluginsuite-api"`   | Sibling workspace (§1.8)  |

The CLI accepts a slightly different identifier grammar for `pluggy install <x>` — see §6.

### 1.5 `registries` — additional Maven repositories

```ts
type Registry = string | { url: string; credentials?: { username: string; password: string } };
```

- String form: `"https://repo1.maven.org/maven2/"`
- Object form for authenticated registries.

The Modrinth registry is implicit and always present; it does not need to appear in `registries`.

### 1.6 `shading` — fine-grained jar packaging

Controls which classes from a dependency are copied into the final plugin jar.

```json
{
  "shading": {
    "some-library": {
      "include": ["com/library/api/**"],
      "exclude": ["com/library/internal/**"]
    }
  }
}
```

- Globs use `*` (single segment) and `**` (any depth), matched against class file paths inside the dependency jar.
- If `include` is present, only matching classes are shaded; `exclude` then subtracts from that set.
- If a dep is not listed under `shading`, the default is to **not** shade it (the user declares what comes in).

### 1.7 `resources` — file bundle mapping

Maps **paths inside the final jar** to **paths in the project**. At build time, `pluggy` walks this map, applies template substitution where appropriate, and writes each file into the jar at the declared location.

```jsonc
{
  "resources": {
    "plugin.yml": "./resources/plugin.yml", // file → file
    "config.yml": "./resources/config.yml", // file → file
    "lang/": "./i18n/", // directory → directory (recursive)
    "assets/icon.png": "./branding/icon.png", // binary file (copied byte-for-byte)
  },
}
```

**Mapping rules:**

- Keys ending in `/` are directory mappings; every file under the value path is copied recursively into the key path, preserving relative structure.
- Otherwise it's a single-file mapping.
- All paths in values are relative to the project root.

**Template substitution (§4)** runs only on files with allowlisted extensions:
`.yml`, `.yaml`, `.json`, `.properties`, `.txt`, `.md`.
All other files are copied byte-for-byte (prevents corrupting PNGs, jars, class files, etc.).

**Descriptor interaction:**

- The descriptor file for the primary platform (e.g. `plugin.yml` for bukkit family) is **auto-generated** from `project.json` unless the user supplies it via `resources`.
- When the user supplies it, their file wins and template substitution still runs. They can reference `${project.name}` etc.
- This lets users add custom sections (`permissions:`, `commands:`) that the auto-generator can't produce.

**Conflict rules:**

- If a dependency's jar also contains a path listed in `resources`, the user's `resources` entry wins.
- If two entries in `resources` resolve to the same output path, the first-declared wins.

### 1.8 `workspaces` — multi-module projects

Pluggy supports monorepo layouts where one repo contains multiple related plugins (typical: `api` + `impl` + `addon-*`).

**Repo layout:**

```
my-plugin-suite/
├── project.json               # root: declares workspaces, shared config
├── modules/
│   ├── api/
│   │   ├── project.json       # api workspace
│   │   └── src/…
│   ├── impl/
│   │   ├── project.json       # impl workspace (depends on api)
│   │   └── src/…
│   └── addon-economy/
│       ├── project.json
│       └── src/…
```

**Root vs workspace `project.json`:**

The root is **orchestration-only** — it declares `workspaces` and shared config, but has no `main` and no source tree of its own. The root's `project.json`:

```jsonc
{
  "name": "my-plugin-suite",
  "version": "1.0.0",
  "workspaces": ["./modules/api", "./modules/impl", "./modules/addon-economy"],
  "compatibility": {
    "versions": ["1.21.8"],
    "platforms": ["paper"],
  },
  "registries": ["https://repo.maven.org/maven2/"],
}
```

A workspace's `project.json` (e.g. `modules/impl/project.json`):

```jsonc
{
  "name": "mypluginsuite-impl",
  "version": "1.0.0",
  "main": "com.example.impl.Plugin",
  "dependencies": {
    "mypluginsuite-api": {
      "source": "workspace:mypluginsuite-api",
      "version": "*",
    },
    "placeholderapi": "2.11.6",
  },
}
```

**Inheritance rules** — a workspace inherits from the root unless it overrides:

| Field                                  | Inheritance                                               |
| -------------------------------------- | --------------------------------------------------------- |
| `compatibility`                        | Inherited. Can be overridden per workspace.               |
| `registries`                           | Merged (root + workspace).                                |
| `authors`, `description`               | Inherited unless overridden.                              |
| `version`                              | **Not inherited.** Each workspace versions independently. |
| `name`, `main`                         | Workspace-only. Root must not declare `main`.             |
| `dependencies`, `shading`, `resources` | Workspace-only.                                           |

**Workspace-to-workspace dependencies:**

Use a `workspace:<name>` source, where `<name>` matches the target workspace's `name` field. At resolve time:

- Pluggy finds the sibling workspace, reads its `project.json`.
- Build order is topologically sorted (dependencies built first).
- The sibling's compiled jar is on the dependent's classpath.
- The sibling is **not** bundled into the dependent's jar by default (consumers install both). Override via `shading` if a fat jar is wanted.

Because the resolver runs before (or independently of) the build, workspace sources get a sentinel integrity `"sha256-pending-build"` in the lockfile until `build` has produced the sibling's jar at `<workspace.root>/bin/<name>-<version>.jar`. The install flow re-hashes the jar and replaces the sentinel before considering the lockfile fresh.

**Detecting context:**

Given a cwd, pluggy walks up looking for a `project.json`:

- If the found `project.json` declares `workspaces`, cwd is at the **root** (or in an unrelated subdir under it). When cwd is at or inside a declared workspace's directory, `current` is set to that workspace and `atRoot` is **false** — "inside a workspace" always means inside, even when cwd is exactly the workspace root.
- If the found `project.json` does not declare `workspaces`, and its parent's `project.json` lists this dir in `workspaces`, cwd is **in a workspace**.
- Otherwise it's a **standalone** (non-workspace) project.

**Edge cases:**

- **Missing workspace `project.json`.** If a path listed in `workspaces` does not contain a `project.json`, discovery fails with a hard error. Silently dropping the entry would hide typos in the workspaces array.
- **Nested workspaces.** A workspace's own `project.json` must not declare a further `workspaces` array. The hierarchy is single-level: one root, N leaf workspaces. Discovery ignores a nested `workspaces` field (doesn't recurse into it).

Per-command behavior is in §2. The lockfile is shared across all workspaces (§3.5).

### 1.9 `dev` — development runtime settings

Configures how `pluggy dev` (§2.11) spins up a local Minecraft server against your plugin.

```jsonc
{
  "dev": {
    "port": 25565,
    "memory": "2G",
    "onlineMode": false,
    "jvmArgs": ["-XX:+UseG1GC", "-XX:+ParallelRefProcEnabled"],
    "serverProperties": {
      "motd": "my plugin dev server",
      "difficulty": "peaceful",
      "spawn-protection": "0",
    },
    "extraPlugins": ["./dev-only-plugins/debug-tools.jar"],
  },
}
```

| Field              | Type       | Default | Purpose                                                                                                                                             |
| ------------------ | ---------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `port`             | `number`   | 25565   | Server listen port. Overridable via `--port`.                                                                                                       |
| `memory`           | `string`   | `"2G"`  | JVM heap size (e.g. `"2G"`, `"512M"`). Overridable via `--memory`.                                                                                  |
| `onlineMode`       | `boolean`  | `false` | `false` in dev lets you connect without a Mojang-authenticated account.                                                                             |
| `jvmArgs`          | `string[]` | `[]`    | Extra JVM flags appended after the heap args.                                                                                                       |
| `serverProperties` | `object`   | `{}`    | Key-value pairs written into `server.properties`. Values are stringified.                                                                           |
| `extraPlugins`     | `string[]` | `[]`    | Additional jar paths to drop into `dev/plugins/` that aren't declared as `dependencies` — useful for dev tooling like CoreProtect or debug plugins. |

All values can be overridden on the CLI (see §2.11). The repo-committed `dev` block is the team-shared baseline.

---

## 2. CLI surface

### 2.1 Global flags

Apply to every subcommand.

| Flag                     | Type   | Env          | Purpose                                   |
| ------------------------ | ------ | ------------ | ----------------------------------------- |
| `-v`, `--verbose`        | bool   | `DEBUG=1`    | Enable debug logging                      |
| `-p`, `--project <path>` | string | —            | Override `project.json` location          |
| `--json`                 | bool   | —            | Emit structured JSON only (no human text) |
| `--no-color`             | bool   | `NO_COLOR=1` | Disable ANSI colors                       |
| `-h`, `--help`           | bool   | —            | Command-specific help                     |
| `-V`, `--version`        | bool   | —            | Print pluggy version                      |

**Workspace targeting is per-command, not global.** Commands that accept it declare `--workspace <name>` and/or `--workspaces` (plural). See each command's flag table.

### 2.2 Command matrix

| Command               | Aliases | Status          | Workspace-aware                                                     |
| --------------------- | ------- | --------------- | ------------------------------------------------------------------- |
| `init [path]`         | —       | ✅              | Auto-detects root context                                           |
| `install [plugin]`    | `i`     | ⚠️              | `--workspace <name>`, `--workspaces`                                |
| `remove <plugin>`     | `rm`    | ⚠️              | `--workspace <name>`, `--workspaces`                                |
| `info <plugin>`       | `show`  | ⚠️              | Global                                                              |
| `search <query>`      | —       | ⚠️              | Global                                                              |
| `list`                | `ls`    | ⚠️              | `--workspace <name>`, `--workspaces`                                |
| `build`               | `b`     | ⚠️              | `--workspace <name>`, `--workspaces`                                |
| `doctor`              | —       | ⚠️              | Checks root + all workspaces                                        |
| `dev`                 | —       | ⚠️              | `--workspace <name>` required at root; see §2.11 for full flag list |
| `upgrade`             | —       | ✅ (simplified) | CLI-level (ignores workspaces)                                      |
| `completions <shell>` | —       | ✅              | Emits a completion script for bash/zsh/fish/pwsh                    |

### 2.3 `init [path]` — scaffold a new project ✅

| Flag                   | Type   | Default                       | Notes                           |
| ---------------------- | ------ | ----------------------------- | ------------------------------- |
| `--name <name>`        | string | basename of target dir        | Validated `^[a-zA-Z0-9_]+$`     |
| `--version <semver>`   | string | `1.0.0`                       | Validated                       |
| `--description <text>` | string | `"A simple Minecraft plugin"` |                                 |
| `--main <FQCN>`        | string | `com.example.Main`            | Must contain `.`, validated     |
| `--platform <name>`    | enum   | `paper`                       | One of the registered platforms |
| `-y`, `--yes`          | bool   | false                         | Skip all confirmation prompts   |

**Behavior:**

- Confirms if target dir is non-empty.
- Confirms if `cwd` is already inside a pluggy project.
- Calls `getPlatform(platform).getLatestVersion()` to pre-fill `compatibility.versions[0]`.
- Writes:
  - `project.json`
  - `src/config.yml` (from default template with substitution)
  - `src/<package-path>/<ClassName>.java` (from default template)

**Workspace context:** if `init` is run with a path inside a root project (one that declares `workspaces`), the new project is scaffolded **and** added to the root's `workspaces` array. Otherwise it's a standalone project. No flag needed — context is inferred.

### 2.4 `install [plugin]` — resolve and add deps ⚠️

Aliases: `i`.

| Arg/Flag             | Type       | Default   | Notes                                                                                  |
| -------------------- | ---------- | --------- | -------------------------------------------------------------------------------------- |
| `[plugin]`           | identifier | —         | Omitted = install everything already in `project.json`. See §6 for identifier grammar. |
| `--force`            | bool       | false     | Skip compatibility checks                                                              |
| `--beta`             | bool       | false     | Include pre-release versions during Modrinth resolution (§3.7)                         |
| `--workspace <name>` | string     | —         | Target a specific workspace                                                            |
| `--workspaces`       | bool       | see below | Run across all workspaces explicitly                                                   |

**Default scope:**

- At a **root** (with workspaces): install across all workspaces (shared resolution, one lockfile).
- In a **workspace**: install in the current workspace only.
- **Standalone**: install in the project.

**Behavior (planned):**

1. Parse identifier → `{ source, version }` using the grammar in §6.
2. Check Modrinth compatibility against `compatibility.versions` / `compatibility.platforms`; warn, or hard-fail without `--force`.
3. Download jar; cache under `<cache>/dependencies/`.
4. Write entry to the target `project.json:dependencies`.
5. Update shared lockfile at repo root (§3.5).

**Multi-workspace conflicts.** If two workspaces declare the same dep name with different `source` or `version`, `install` refuses with a descriptive error rather than silently picking one. The lockfile is shared across the repo; there can only be one resolved entry per name.

**Orphan lockfile entries.** On a no-argument `install` that resolves every declaration, any lockfile entry not declared by at least one workspace is dropped. (Orphans are still tolerated by `install --force <plugin>` and never reported as "stale" by `verifyLock` — see §3.5.)

**Examples:**

```bash
pluggy install                                          # install all declared deps
pluggy install worldedit                                # Modrinth, latest stable
pluggy install placeholderapi@2.11.6                    # Modrinth, pinned
pluggy install ./libs/custom-library.jar                # local file
pluggy install maven:net.kyori:adventure-api@4.22.0     # Maven
pluggy install worldedit --workspace api                # target one workspace
pluggy install --beta --force                           # include pre-releases, ignore compat
```

### 2.5 `remove <plugin>` — drop a dep ⚠️

Aliases: `rm`.

| Arg/Flag             | Type   | Default | Notes                                                |
| -------------------- | ------ | ------- | ---------------------------------------------------- |
| `<plugin>`           | string | —       | Dependency name (key in `project.json:dependencies`) |
| `--keep-file`        | bool   | false   | Leave the local/cached jar on disk                   |
| `--workspace <name>` | string | —       | Target a specific workspace                          |
| `--workspaces`       | bool   | false   | Remove from every workspace that declares it         |

**Default scope:**

- At a **root** with workspaces: requires `--workspace <name>` or `--workspaces` (ambiguous otherwise — errors).
- In a **workspace** or **standalone**: removes from the current project.

**Lockfile behavior.** When the dep is removed from every project that declared it, the lockfile entry is dropped. Otherwise `declaredBy` is trimmed to reflect the new reality.

**Cached-jar deletion.** Unless `--keep-file`, `remove` deletes the **cached** copy under `<cache>/dependencies/<kind>/…` (the content-addressed copy pluggy manages). It never deletes the user's own `file:` source jar. Deletion is best-effort — failures warn but don't fail the command.

### 2.6 `info <plugin>` — show plugin details ⚠️

Aliases: `show`.

| Arg        | Notes                                     |
| ---------- | ----------------------------------------- |
| `<plugin>` | Identifier in any supported form (see §6) |

**Output (planned):** description, homepage, license, available versions, per-version compatibility against the current `compatibility` config, download size.

**Homepage fallback order** (Modrinth source): `source_url` → `wiki_url` → `issues_url` → `discord_url` → `null`. The first non-null wins.

**Per-version compatibility check** (emitted only when `info` is run inside a pluggy project): for each Modrinth version, the version's `game_versions` array is intersected with the project's `compatibility.versions`. Non-empty intersection ⇒ `"ok"`; empty ⇒ `"warn"`. The field is omitted outside a project.

Not workspace-aware — operates on the passed identifier.

### 2.7 `search <query>` — browse Modrinth ⚠️

| Flag                 | Type   | Default | Notes                                                 |
| -------------------- | ------ | ------- | ----------------------------------------------------- |
| `--size <n>`         | int    | 10      | Results per page                                      |
| `--page <n>`         | int    | 0       | Zero-indexed page                                     |
| `--platform <name>`  | enum   | —       | Filter by platform (adds a `categories:<name>` facet) |
| `--version <semver>` | string | —       | Filter by MC version (adds a `versions:<ver>` facet)  |
| `--beta`             | bool   | false   | No-op at search; honored at resolve time (§3.7)       |

**`--beta` limitation.** Modrinth's `/v2/search` endpoint has no project-level pre-release facet — individual versions have a `version_type`, but the search API doesn't filter on it. `--beta` is accepted for consistency but is a **no-op at search time**; it's honored later when `install` / `info` resolves a specific version. Setting it in human mode logs a warning; in `--json` mode it is silent.

Global command; not workspace-aware. Only searches Modrinth (Maven has no search API; local file lookups are not meaningful across a registry).

### 2.8 `list` — installed deps and registries ⚠️

Aliases: `ls`.

| Flag                 | Type   | Default   | Notes                                                                               |
| -------------------- | ------ | --------- | ----------------------------------------------------------------------------------- |
| `--tree`             | bool   | false     | Render with tree-draw characters (transitive children 🎯 when lockfile tracks them) |
| `--outdated`         | bool   | false     | Only list deps with newer stable versions on Modrinth                               |
| `--workspace <name>` | string | —         | Show a specific workspace                                                           |
| `--workspaces`       | bool   | see below | Aggregated view across all workspaces                                               |

**Default scope:** at a root with workspaces → aggregated. In a workspace or standalone → current project.

**Short-form dep resolution.** A short-form dependency value (`"worldedit": "7.3.15"`) is always treated as a Modrinth pin where the **dep name doubles as the slug**. This is symmetric with the schema rule in §1.4.

**Registries** are rendered as `{ url, authenticated }` with `authenticated: true` when the entry has `credentials`. Usernames and passwords are never emitted in either human or JSON output — `list` is safe to share.

### 2.9 `build` — compile and package ⚠️

Aliases: `b`.

| Flag                 | Type   | Default                      | Notes                             |
| -------------------- | ------ | ---------------------------- | --------------------------------- |
| `--output <path>`    | string | `./bin/<name>-<version>.jar` | Output jar path                   |
| `--clean`            | bool   | false                        | Wipe staging before building      |
| `--skip-classpath`   | bool   | false                        | Skip IDE scaffolding (§1.2 `ide`) |
| `--workspace <name>` | string | —                            | Build a single workspace          |
| `--workspaces`       | bool   | see below                    | Explicit "all workspaces"         |

**Default scope:** at a root with workspaces → build all in topological order. In a workspace or standalone → build that project.

**Build pipeline (planned):**

1. Resolve deps → download + cache.
2. Download matching server jar for `compatibility.platforms[0]` / `compatibility.versions[0]`.
3. Generate `.classpath` (IDE integration) unless `--skip-classpath`.
4. Copy `resources` entries into a staging dir (with template substitution per §4).
5. Compile sources with `javac` against the full classpath.
6. Auto-generate the primary platform's descriptor (§5.2) from `project.json` if not provided via `resources`.
7. Package into jar; apply `shading` rules.
8. For workspaces: output each as a separate jar.

**Failure mode.**

- **Single project** (standalone, inside a workspace, or `--workspace <name>` narrowed): a build failure rethrows immediately. The CLI's top-level handler formats the error.
- **Multiple workspaces** (root default or `--workspaces`): a workspace failure is logged and collected but does **not** abort the remaining workspaces — users see which others succeeded. After the run, the command exits `1` if any workspace failed.

**JSON output routing.** On full success, the aggregate JSON envelope goes to stdout. On any workspace failure (even partial), the envelope goes to stderr with `status: "error"` and full per-workspace `results[]`. Matches §3.1.

### 2.10 `doctor` — environment check ⚠️

No flags.

**Checks (planned):**

- Java toolchain present and version (needed for BuildTools-based platforms).
- Cache location accessible + size.
- All `registries` reachable.
- `project.json` conforms to schema — **run against every workspace**, not just the root, so a bad leaf is named.
- Workspace graph valid (no cycles, all `workspace:` deps resolve).
- Descriptor family consistency (no cross-family `compatibility.platforms`).
- Outdated deps (suggest `list --outdated`).

**Warn vs fail.** Each check returns one of `pass` / `warn` / `fail`. Only `fail` contributes to a non-zero exit code. Typical mapping:

- `fail`: `java` missing, cache not writable, `project.json` invalid schema, workspace cycle, cross-family descriptor mismatch.
- `warn`: cache directory doesn't exist yet (first run), registry HEAD timeout, Java version outside BuildTools's 8–21 window when the primary platform is `spigot`/`bukkit`, `outdated` placeholder until it's implemented.

In `--json` mode, a full-success envelope goes to stdout; any `fail` sends the envelope to stderr with `status: "error"` plus a `failures: []` array for quick triage.

Checks the root and every workspace.

### 2.11 `dev` — development loop ⚠️

Spins up a real Minecraft server against your plugin, with all runtime-plugin dependencies dropped into its `plugins/` dir. Watches source, rebuilds, and restarts (or reloads) on change.

| Flag                 | Type     | Default                      | Notes                                           |
| -------------------- | -------- | ---------------------------- | ----------------------------------------------- |
| `--workspace <name>` | string   | —                            | Required when run at a root with workspaces     |
| `--platform <name>`  | enum     | `compatibility.platforms[0]` | Override the primary platform                   |
| `--version <ver>`    | string   | `compatibility.versions[0]`  | Override the primary MC version                 |
| `--port <n>`         | int      | `dev.port` ?? 25565          | Server listen port                              |
| `--memory <x>`       | string   | `dev.memory` ?? `"2G"`       | JVM heap (e.g. `2G`, `512M`)                    |
| `--clean`            | bool     | false                        | Wipe `dev/` before starting                     |
| `--fresh-world`      | bool     | false                        | Keep `dev/` but delete `dev/world*`             |
| `--no-watch`         | bool     | false                        | Run once, don't watch or rebuild                |
| `--reload`           | bool     | false                        | Use `/reload` instead of full restart on change |
| `--offline`          | bool     | from `dev.onlineMode`        | Set `online-mode=false` in `server.properties`  |
| `--args <...>`       | string[] | from `dev.jvmArgs`           | Extra JVM args, appended after heap             |

#### Runtime directory layout

`pluggy dev` stages everything under `<project>/dev/` (gitignored). This is intentionally in-project, not in the user cache, so state is inspectable when things misbehave.

```
<project>/
├── project.json
├── src/
├── dev/                              # gitignored
│   ├── server.jar                    # hardlink to the cached platform jar (copy if hardlink fails)
│   ├── eula.txt                      # auto-accepted (see below)
│   ├── server.properties             # rendered from project.json:dev.serverProperties
│   ├── plugins/
│   │   ├── <project-name>-<version>.jar
│   │   └── <runtime-plugin-deps>.jar…
│   ├── world/ world_nether/ world_the_end/
│   └── logs/
```

`--clean` wipes everything except the server jar link. `--fresh-world` keeps `dev/` but nukes the world directories between runs.

#### Runtime plugin vs compile library

Not every `dependency` gets copied into `dev/plugins/`. The rule:

> A dependency is a **runtime plugin** iff its jar contains the primary platform's descriptor file (per §5.2 — `plugin.yml`, `bungee.yml`, or `velocity-plugin.json`). Otherwise it's a **compile-time library** and stays on the classpath but out of `plugins/`.

By source kind:
| Source | Default treatment |
|---|---|
| `modrinth:<slug>` | Runtime plugin (auto-detected, almost always has a descriptor) |
| `maven:…` | Library (almost never has a Bukkit-style descriptor) |
| `file:…` | Auto-detected by peeking the jar manifest |
| `workspace:<name>` | Library unless the workspace itself has `main` and produces a descriptor |

`extraPlugins` in `project.json:dev` (§1.9) is an escape hatch for jars that aren't declared dependencies but should still end up in `plugins/` during dev — useful for dev-only tooling.

#### Flow on first run

1. Resolve server jar for the primary platform + version. Downloads via `platform.download()`; Spigot/Bukkit compile via BuildTools on first hit (show a progress UI — this takes minutes).
2. Stage `dev/`: link the server jar, write `eula.txt`, render `server.properties` from the `dev.serverProperties` block.
3. Run `build` (incremental) to produce the plugin jar.
4. Populate `dev/plugins/` with the plugin jar, all runtime-plugin deps, and `extraPlugins`.
5. Spawn `java -Xmx<memory> <jvmArgs> -jar dev/server.jar` with stdio piped to the user's terminal.
6. If `--watch` (default), start the file watcher.

#### Watch and reload

- Watches `src/**/*.java`, anything referenced by `resources`, and `project.json` itself.
- Debounces file events by 200ms to coalesce editor saves.
- On change: incremental rebuild. If build succeeds, **restart the server by default** (safer, always correct). With `--reload`, send `reload confirm\n` to the server's stdin instead (faster but known to corrupt plugins that hold state; `confirm` suppresses Bukkit's interactive safety prompt).
- If build fails, log the error and keep the server running on the previous jar.

#### Shutdown and stdin

- `Ctrl+C` sends `/stop` to the server's stdin, waits up to 30s for a clean exit, then terminates the child. A second `Ctrl+C` within 2s force-kills.
- On Unix the terminate step uses SIGTERM. On Windows, Node's `child.kill()` translates to `TerminateProcess`; observed behavior is identical to the user.
- User stdin is forwarded to the server (so `/op`, `/tp`, `/stop`, etc. work as expected from the terminal).

#### EULA

Mojang-based servers refuse to start without `eula.txt` set to `true`. `pluggy dev` auto-writes it on first run with a header comment noting that pluggy accepted it on the user's behalf. Set `PLUGGY_DEV_NO_EULA=1` to opt out and manage it manually.

#### JSON output

`dev` is inherently interactive — the server's own stdout/stderr stream to the user's terminal. `--json` therefore emits exactly **one** envelope on stdout at startup:

```json
{
  "status": "starting",
  "platform": "paper",
  "version": "1.21.8",
  "port": 25565,
  "devDir": "/.../dev"
}
```

After that line, the Minecraft server's logs pass through unchanged. Pluggy does not wrap or re-encode them. A later "stopped" envelope is not guaranteed; exit code communicates success/failure.

#### `server.properties` rendering

The file is written with pluggy defaults first (`motd=<project.name> dev`, `online-mode=<dev.onlineMode ?? false>`, `server-port=<port>`), then any keys from `project.dev.serverProperties` that aren't already defaults appended in declaration order. User-set values for default keys win per-key, but stay in their default slot for diff stability.

#### Platform caveats

- **Velocity** is a proxy, not a server — it can't host a playable world, and booting it without a configured backend is only useful for startup/plugin-loading tests. `pluggy dev` against a velocity workspace prints a warning and a hint toward a backend-server config. Full proxy-plus-backend orchestration is a future enhancement.
- **Paperclip first run** unpacks the real server (~30s). This is normal; show a progress indicator.

#### Scope limits

- Targets one project at a time — `--workspaces` (plural) is **not** accepted; the dev loop doesn't make sense across multiple workspaces simultaneously.
- Hot-code-swap (class-level JVM reload) is out of scope. Plugin restart is the unit of change.

### 2.12 `upgrade` — self-update ✅

| Flag           | Purpose                                                                            |
| -------------- | ---------------------------------------------------------------------------------- |
| `--print-only` | Skip the download; just print the latest release info and manual install commands. |

Default behaviour: fetches the latest GitHub release, downloads the asset matching the current platform (darwin-arm64, darwin-x64, linux-arm64, linux-x64, win32-x64), and atomically replaces the running binary.

Replacement is crash-safe:

1. Download to a temp file, `chmod +x` on Unix.
2. Rename the current binary to `<current>.old`.
3. Rename the new binary into `<current>`.
4. On step 3 failure, restore `<current>.old` so the user is never left without a working `pluggy`.

Platforms without a published asset (e.g. linux-arm64 without a build yet) fall back to the same output as `--print-only`.

### 2.13 `completions <shell>` — ✅ implemented

Prints a shell completion script for the requested shell to stdout. Supported shells: `bash`, `zsh`, `fish`, `pwsh`.

The script is generated by introspecting the live commander command tree, so it stays in sync with whatever flags and subcommands are currently registered.

| Arg       | Notes                                 |
| --------- | ------------------------------------- |
| `<shell>` | One of `bash`, `zsh`, `fish`, `pwsh`. |

**Install:**

```bash
# bash
pluggy completions bash > /usr/local/etc/bash_completion.d/pluggy

# zsh
pluggy completions zsh > "${fpath[1]}/_pluggy"

# fish
pluggy completions fish > ~/.config/fish/completions/pluggy.fish

# pwsh
pluggy completions pwsh >> $PROFILE
```

**Scope:** completes command names, aliases, and flag names. Does not complete flag values (e.g. `--platform <name>` won't auto-list registered platforms) — that's a future refinement.

---

## 3. Cross-cutting behavior

### 3.1 Output modes

- **Default:** human-readable, ANSI colors unless `NO_COLOR` / `--no-color`.
- **`--json`:** single JSON object on stdout for success, single JSON object on stderr for errors. Shape:
  ```jsonc
  // success
  { "status": "success", "...": "..." }
  // error
  { "status": "error", "message": "…", "exitCode": 1 }
  ```
  Never mix JSON and human text in the same output.

### 3.2 Exit codes

| Code | Meaning                                                       |
| ---- | ------------------------------------------------------------- |
| `0`  | Success                                                       |
| `1`  | Runtime / IO error                                            |
| `2`  | Validation error (bad flag, bad project.json, bad identifier) |

### 3.3 Error handling rules

- Throw `InvalidArgumentError` (from `commander`) for user-input problems. The top-level handler formats and exits cleanly.
- Throw regular `Error` for runtime / IO failures.
- All errors are funneled through the same handler in `src/mod.ts`, which respects `--json`.

### 3.4 Cache layout

Per-OS user cache directory:

| OS      | Path                                                    |
| ------- | ------------------------------------------------------- |
| macOS   | `~/Library/Caches/pluggy/`                              |
| Linux   | `$XDG_CACHE_HOME/pluggy/` (fallback `~/.cache/pluggy/`) |
| Windows | `%LOCALAPPDATA%\pluggy\cache\`                          |

Subdirectories:

- `versions/` — server jars (Paper, Folia, Velocity, Waterfall, Travertine, compiled Spigot/Bukkit).
- `BuildTools/` — Spigot BuildTools workspace (the jar itself plus its checkout caches).
- `dependencies/` — Modrinth (`modrinth/<slug>/<version>.jar`), Maven (`maven/<groupId>/<artifactId>/<version>.jar`), and file (`file/<sha256>.jar` content-addressed) caches.

### 3.5 Lockfile

`pluggy.lock` lives at the **repo root** (next to the root `project.json`). For a standalone project, "root" is the project itself.

Shared across all workspaces — one resolution pass, consistent versions across sibling workspaces, single file to commit.

**Generated by `install`.** Each entry pins:

- Resolved version (concrete, not a range).
- Source (Modrinth URL, Maven coordinate, or file path).
- Integrity hash (SHA-256 of the resolved jar).
- Which workspace(s) declared this dep.

Subsequent `install` runs verify the lockfile; `install --force` or edits to `project.json:dependencies` invalidate and re-resolve.

#### Schema

```ts
interface Lockfile {
  version: 1; // must be exactly 1
  entries: Record<string, LockfileEntry>;
}

interface LockfileEntry {
  source: ResolvedSource; // per §6.3
  resolvedVersion: string; // concrete, never a range
  integrity: string; // see "Integrity encoding"
  declaredBy: string[]; // workspace names
}
```

#### On-disk format

Pluggy emits lockfiles in a **stable, diff-friendly form** so reviewing them in PRs is sane:

- 2-space-indented JSON.
- Trailing LF on the last line (LF line endings on every platform — see §3.8).
- Entries sorted alphabetically by key before serialization, regardless of insertion order.

These are stability guarantees, not implementation details. Pre-1.0 they may change; post-1.0 they are part of the public contract.

#### Integrity encoding

Integrity values are formatted as `"sha256-<hex>"` — lowercase hex digest, no base64 variants, no alternative algorithms. The hex form is deterministic, diff-friendly, and directly comparable byte-for-byte.

One reserved sentinel exists: **`"sha256-pending-build"`** is written by the resolver for `workspace:` dependencies that reference a sibling workspace whose jar has not been built yet. The install flow must re-hash the sibling jar after `build` produces it and replace the sentinel before considering the lockfile fresh.

#### Atomicity

Writes use a `<pid>`-stamped temp file in the same directory followed by `rename()` over the target, so a crash mid-write leaves either the previous lockfile or an orphan temp — never a half-written lockfile.

Commit `pluggy.lock` for reproducible builds.

### 3.6 Interactive prompts

All interactive prompts go through `@inquirer/prompts`. Never block on `globalThis.prompt` or synchronous APIs. `--yes` (on commands that accept it) or `--json` must bypass prompts entirely — with `--json`, prompts become errors rather than hangs.

### 3.7 Pre-release handling

By default, `install`, `search`, and Modrinth resolution **hide pre-release versions** (anything with a semver prerelease tag like `-alpha`, `-beta`, `-rc`, `-SNAPSHOT`). Pass `--beta` to include them.

Rationale: Minecraft plugins commonly publish `-SNAPSHOT` builds that don't follow strict semver. Defaulting to stable avoids silently breaking servers.

### 3.8 Cross-platform support

Pluggy must run on macOS, Linux, and Windows with identical observable behavior. Every file path, process spawn, signal, and UI concern below has an OS-appropriate mapping that the user never has to think about.

#### Paths

- In `project.json`, `pluggy.lock`, and CLI arguments, always write paths with **forward slashes** (`/`), including on Windows. The CLI normalizes to the OS separator at runtime via `node:path`.
- Backslashes are accepted on Windows for CLI input (because shells produce them), but normalized to forward slashes before being persisted.
- Relative paths are resolved relative to the file they appear in (usually `project.json`'s directory), never relative to the cwd of the invoking shell.
- Absolute paths work but are discouraged for portability.

#### Linking large files (server jars, cached deps)

- Server jars in `dev/` and dep jars in workspace classpaths are **hardlinked** from the user cache to avoid duplicating 50-100 MB files per project.
- Fall back to a byte-for-byte **copy** if hardlink fails (different volume, filesystem restriction, etc.).
- **Symlinks are never used.** Windows requires admin or Developer Mode to create them; hardlinks work without privileges.

#### Signal handling

| Action                    | Unix                                    | Windows                             |
| ------------------------- | --------------------------------------- | ----------------------------------- |
| First `Ctrl+C`            | Send `/stop\n` to child stdin; wait 30s | Same                                |
| After grace period        | SIGTERM, then SIGKILL                   | `child.kill()` → `TerminateProcess` |
| Second `Ctrl+C` within 2s | SIGKILL immediately                     | `TerminateProcess` immediately      |

Node's cross-platform signal translation handles the difference; user-visible behavior is identical.

#### File locking

Windows holds exclusive locks on files owned by a running process. The dev loop therefore **always stops the server before overwriting `plugins/*.jar`** — never attempts to replace a file held open by the running JVM. This is also correct behavior on Unix (the old inode survives, but stale-vs-new-plugin state is confusing).

#### Line endings

All generated files (`server.properties`, `eula.txt`, `plugin.yml`, other descriptors) are written with **LF** (`\n`) line endings on every platform. Minecraft servers, YAML parsers, and properties readers accept either; LF keeps build outputs byte-identical across OSes, which matters for hash-based caching.

#### Case sensitivity

Linux filesystems are case-sensitive; macOS (APFS default) and Windows (NTFS) are case-insensitive. A `main` class validated only at runtime can work on dev machines and break in CI.

- `pluggy init` warns if `main` doesn't exactly match a source file on disk after scaffold.
- `pluggy doctor` repeats the check for existing projects.
- `pluggy build` fails hard on mismatch.

#### Terminal and colors

- ANSI colors respect `NO_COLOR` and `--no-color` on every platform.
- Windows Terminal, PowerShell 7+, and modern `cmd.exe` (Windows 10 1809+) support ANSI natively; legacy consoles are auto-detected and colors are stripped.
- Interactive prompts (`@inquirer/prompts`) work in all three environments.

#### Process spawning

- Pluggy **never invokes a shell**. All subprocesses (`java`, BuildTools, etc.) are spawned via `node:child_process.spawn` directly, which prevents shell-injection classes of bug and avoids quoting differences between bash, zsh, and PowerShell.
- Executable resolution (`java` vs `java.exe`) is handled by Node's `PATH` lookup.

#### Install locations

| OS           | Binary                                                       | Install script |
| ------------ | ------------------------------------------------------------ | -------------- |
| macOS, Linux | `/usr/local/bin/pluggy`                                      | `install.sh`   |
| Windows      | `%LOCALAPPDATA%\pluggy\bin\pluggy.exe`, added to user `PATH` | `install.ps1`  |

Cache locations are documented in §3.4.

#### Java toolchain

`java` (or `java.exe`) must be discoverable on `PATH`. `doctor` reports the resolved path and version. BuildTools-based platforms (Spigot, Bukkit) additionally require Java 8-21 depending on target MC version; `doctor` warns when the wrong version is active.

---

## 4. Template variable substitution

Resource files (anything scaffolded by `init` or declared under `resources`, extension-allowlisted per §1.7) are processed with `${…}` substitution at write time. Variables walk the replacement object dot-wise; arrays are exposed by index.

| Variable                                            | Source                          |
| --------------------------------------------------- | ------------------------------- |
| `${project.name}`                                   | `project.json:name`             |
| `${project.version}`                                | `project.json:version`          |
| `${project.description}`                            | `project.json:description`      |
| `${project.main}`                                   | `project.json:main` (full FQCN) |
| `${project.className}`                              | Last dot-segment of `main`      |
| `${project.packageName}`                            | `main` minus the last segment   |
| `${project.authors.0}`, `${project.authors.1}`, ... | Array indices                   |

The older `$__PROJECT_NAME__$` form shown in early drafts of the README is retired. Current canonical syntax is `${…}`.

---

## 5. Platform providers

Platform providers live under `src/platform/` and are registered by importing them from `src/platform/mod.ts` for their side-effect. Each provider implements `PlatformProvider`.

### 5.1 Interface

```ts
export interface PlatformProvider {
  id: string;

  getVersions(): Promise<string[]>;
  getLatestVersion(): Promise<Version>;
  getVersionInfo(version: string): Promise<Version>;

  download(version: Version, ignoreCache: boolean): Promise<Version & { output: Uint8Array }>;

  api(version: string): Promise<MavenAPI>;

  // Descriptor produced for plugins targeting this platform
  descriptor: {
    path: string; // e.g. "plugin.yml"
    format: "yaml" | "json" | "toml";
    generate(project: ResolvedProject): string;
  };
}
```

Platform providers **must not** do I/O at module-load time. Deferring disk writes to the command that needs them is required: `bun build --compile` exposes the source at a read-only `/$bunfs` path, so any `mkdirSync` at registration crashes the binary on startup.

### 5.2 Descriptor per platform

Pluggy auto-generates the descriptor file for the primary platform (`compatibility.platforms[0]`) unless the user supplies it in `resources`.

| Provider   | Family     | Descriptor path                              | Format |
| ---------- | ---------- | -------------------------------------------- | ------ |
| bukkit     | Bukkit     | `plugin.yml`                                 | YAML   |
| spigot     | Bukkit     | `plugin.yml`                                 | YAML   |
| paper      | Bukkit     | `plugin.yml` (+ optional `paper-plugin.yml`) | YAML   |
| folia      | Bukkit     | `plugin.yml`                                 | YAML   |
| waterfall  | BungeeCord | `bungee.yml`                                 | YAML   |
| travertine | BungeeCord | `bungee.yml`                                 | YAML   |
| velocity   | Velocity   | `velocity-plugin.json`                       | JSON   |

**Cross-family `compatibility.platforms` is rejected by `build`.** If a user declares `["paper", "waterfall"]`, the build stops with guidance to split into two workspaces.

### 5.3 Provider summary

| Provider     | Upstream         | Maven API              | Compile strategy                         |
| ------------ | ---------------- | ---------------------- | ---------------------------------------- |
| `paper`      | fill.papermc.io  | ✅ `paper-api`         | Direct download                          |
| `folia`      | fill.papermc.io  | ✅ `folia-api`         | Direct download                          |
| `velocity`   | fill.papermc.io  | ✅ `velocity-api`      | Direct download                          |
| `waterfall`  | fill.papermc.io  | ✅ `waterfall-api`     | Direct download                          |
| `travertine` | fill.papermc.io  | ❌ (no Maven artifact) | Direct download, `application` target    |
| `spigot`     | hub.spigotmc.org | ✅ `spigot-api`        | BuildTools compile (requires local Java) |
| `bukkit`     | hub.spigotmc.org | ✅ `spigot-api`        | BuildTools compile (requires local Java) |

---

## 6. Dependency source notation

A formal grammar for the `Dependency.source` string and the CLI `install` identifier.

### 6.1 `project.json:dependencies[…].source` grammar

```
<source>  ::= "modrinth:" <slug>
            | "maven:" <groupId> ":" <artifactId>
            | "file:" <path>
            | "workspace:" <name>

<slug>         ::= [a-z0-9][a-z0-9-_]*            # Modrinth slug
<groupId>      ::= [a-zA-Z][\w.-]*
<artifactId>   ::= [a-zA-Z][\w.-]*
<path>         ::= relative or absolute filesystem path
<name>         ::= value of a sibling workspace's "name" field
```

The **short form** of a dependency value (bare string instead of object) is sugar for a `modrinth:` source:

```jsonc
{ "worldedit": "7.3.15" }
// equivalent to:
{ "worldedit": { "source": "modrinth:worldedit", "version": "7.3.15" } }
```

### 6.2 CLI identifier grammar (for `pluggy install <x>`, `pluggy info <x>`)

```
<identifier> ::= <slug> [ "@" <version> ]           # Modrinth
               | <file-path>                         # anything ending in .jar
               | "maven:" <groupId> ":" <artifactId> "@" <version>
               | "workspace:" <name>
```

On the CLI, `worldedit@7.3.15` is shorthand because typing `modrinth:worldedit@7.3.15` is tedious. In `project.json`, the `modrinth:` prefix is only needed for the explicit long form.

### 6.3 Parser requirements

A single parser module converts either string into a tagged union:

```ts
type ResolvedSource =
  | { kind: "modrinth"; slug: string; version: string }
  | { kind: "maven"; groupId: string; artifactId: string; version: string }
  | { kind: "file"; path: string; version: string }
  | { kind: "workspace"; name: string; version: string };
```

All downstream code (install, info, build, shading) operates on `ResolvedSource`, never on the raw string. This replaces the current regex-based dispatch in the CLI layer.

---

## 7. Open questions

Only one remains after the last design pass. Everything else has been resolved into the sections above.

1. **`devDependencies` split** — currently flat `dependencies`. Test-only or build-time-only libs (JUnit, Mockito, annotation processors) currently get shaded into the final jar unless the user writes an explicit `shading` exclude.

   Options:
   - **npm-style:** add a `devDependencies` field. Flat two-map split.
   - **Maven-style:** add a `scope: "compile" | "runtime" | "test" | "provided"` per dep.
   - **Do nothing:** solve with `shading` exclusion patterns.

   Most plugin devs don't run large test suites (servers are integration tests). Deferring until someone hits the problem.

---

## 8. Implementation plan

Pluggy is pre-1.0 and has not shipped a tagged release. **Every schema change in this spec is a hard break** — no back-compat shims, no deprecation windows, no dual-spelling reads. When a rename lands, the old name stops working the same day.

Work items to reach the state this spec describes:

1. Rename `compability` → `compatibility` in `src/project.ts` and all consumers. Hard cut.
2. Add `resources?: Record<string, string>` to the `Project` type.
3. Add `dev?: DevConfig` to the `Project` type (§1.9).
4. Add `workspaces?: string[]` validation + discovery helpers. (Field exists in the type; behavior is unimplemented.)
5. Add `descriptor` to the `PlatformProvider` interface and implement it in all 7 providers.
6. Introduce the source parser module (§6.3) and route all source-string handling through it.
7. Add the `--workspace <name>` and `--workspaces` flags to the commands listed in §2.2.
8. Introduce `pluggy.lock` handling at the repo root.
9. Implement hardlink-with-copy-fallback helper (§3.8) for cache → project file linking.
10. Wire the `dev` command end-to-end (§2.11).
