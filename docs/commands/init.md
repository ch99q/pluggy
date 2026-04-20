# `pluggy init`

Scaffold a new plugin project. Writes `project.json`, a Bukkit `JavaPlugin`
stub, and a template `config.yml`.

## Usage

```text
pluggy init [options] [path]
```

`path` defaults to `.` (the current directory). Any other value is resolved
against `process.cwd()`.

## Flags

| Flag                   | Default                       | Notes                                                                                                 |
| ---------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| `--name <name>`        | basename of target dir        | Must match `^[a-zA-Z0-9_]+$`.                                                                         |
| `--version <semver>`   | `1.0.0`                       | Validated as `\d+\.\d+\.\d+(-[a-zA-Z0-9]+)?`.                                                         |
| `--description <text>` | `"A simple Minecraft plugin"` | Free-form.                                                                                            |
| `--main <fqcn>`        | `com.example.Main`            | Must be a Java classpath — at least `package.Class`.                                                  |
| `--platform <id>`      | `paper`                       | Any registered platform: `paper`, `folia`, `spigot`, `bukkit`, `velocity`, `waterfall`, `travertine`. |
| `-y, --yes`            | off                           | Skip confirmations. Always on under `--json`.                                                         |

The `--version` here refers to the plugin's own `project.version`. To pin
the Minecraft version (`compatibility.versions[0]`), don't pass `--version`;
edit `project.json` after init, or use `pluggy info` against a specific
platform version.

At init time pluggy calls the selected platform's `getLatestVersion()`,
which hits the upstream API (PaperMC, Spigot, etc.). Expect a short
network wait on first run.

## Files produced

```text
<target>/
├── project.json
├── src/
│   ├── config.yml
│   └── com/example/Main.java    (or whatever --main resolves to)
```

The `.java` and `.yml` stubs are rendered through the `${project.x}`
templater before being written, so they reference the real project name /
version / class name / package name.

## Prompts

Without `-y`, pluggy prompts before:

- Scaffolding into a non-empty directory.
- Scaffolding inside an existing pluggy project (either overwriting it or
  nesting a new project).

Both prompts default to "no". Under `--json`, these situations throw
instead of prompting — an interactive prompt in a non-interactive session
would hang forever.

## Human output

```text
$ pluggy init --yes --name example --main com.example.Main --platform paper
Project "example" initialized successfully at /tmp/example
```

## JSON output

```json
{
  "status": "success",
  "project": {
    "name": "example",
    "version": "1.0.0",
    "description": "A simple Minecraft plugin",
    "main": "com.example.Main",
    "compatibility": {
      "versions": ["1.21.8"],
      "platforms": ["paper"]
    }
  },
  "dir": "/tmp/example"
}
```

## Error cases

| Trigger                        | Message                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Invalid `--name`               | `Invalid project name: "<name>". Only alphanumeric characters and underscores are allowed.`                   |
| Invalid `--main`               | `Invalid main class: "<main>". It must be a valid Java classpath (e.g., com.example.Main).`                   |
| Unknown `--platform`           | `Invalid platform: "<p>". Available platforms: paper, folia, spigot, bukkit, velocity, waterfall, travertine` |
| Non-empty target dir (no `-y`) | Interactive confirm; "no" aborts with `Aborting project initialization.`                                      |
| Existing project dir (no `-y`) | As above.                                                                                                     |

Network failures during `getLatestVersion()` propagate from the platform
provider — see [Troubleshooting](../troubleshooting.md#network-errors-during-init-or-dev).

## See also

- [`project.json` reference](../project-json.md) — what the output config
  means and how to extend it.
- [Getting started](../getting-started.md) — the full from-zero walkthrough.
