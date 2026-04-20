## Commit Message Conventions

This repository follows the Conventional Commits specification for commit messages. This means that each commit message should be structured in the following format:

```<type>[optional scope]: <description>
[optional body]
[optional footer(s)]
```

Where:

- `<type>` is a required field that indicates the type of change being made. Common types include `feat` for new features, `fix` for bug fixes, `docs` for documentation changes, `style` for code formatting, `refactor` for code changes that neither fix a bug nor add a feature, and `test` for adding or modifying tests.
- `[optional scope]` is an optional field that provides additional context about the change, such as the area of the codebase affected (e.g., `api`, `ui`, `database`).
- `<description>` is a required field that provides a brief summary of the change.
- `[optional body]` is an optional field that can include a more detailed description of the change, including the motivation for the change and any relevant background information.
- `[optional footer(s)]` is an optional field that can include any additional information, such as breaking changes or issues closed by the commit.

Examples of valid commit messages:

```feat(api): add new endpoint for user authentication
fix(ui): resolve issue with button alignment
docs: update README with installation instructions
style: reformat code using Prettier
refactor: simplify data fetching logic
test: add unit tests for user model
```

By following these conventions, we can maintain a clear and consistent commit history that makes it easier to understand the changes being made and the reasons behind them. This also helps with generating changelogs and automating releases based on commit messages.

Please do not co-author commits with AI assistants, as this can create confusion about the source of the changes and may not accurately reflect the contributions of human developers. Instead, focus on writing clear and descriptive commit messages that accurately convey the intent and impact of the changes being made.

## Conventions

See `conventions/` for the full conventions with examples in both TypeScript and Go:

- **`conventions/QUALITY.md`** -API design: verb+noun entry points, category objects, single call backbone, no global state, fail-early errors.
- **`conventions/PERFORMANCE.md`** -Performance: data structure selection, bounded collections, early exits, signal over polling, hot-path allocations, batching, coordination.

## Repository structure

pluggy is a Minecraft plugin CLI. The source tree is TypeScript, organized around a [commander](https://github.com/tj/commander.js) command tree and a pluggable platform registry. Many modules are currently stubs — see `docs/SPEC.md` §8 for what's implemented vs planned.

```
src/
├── mod.ts               # CLI entrypoint; thin dispatcher over commands/
├── commands/            # one file per subcommand, each exports an XxxCommand() factory
│   ├── init.ts          # ✅ implemented
│   ├── install.ts, remove.ts, info.ts, search.ts, list.ts,
│   ├── build.ts, doctor.ts, dev.ts     # ⚠️ stubs (throw "not implemented")
│   ├── upgrade.ts       # ✅ simplified (fetch latest release, print install instructions)
│   └── parsers.ts       # commander argParser functions (semver, version, platform, integer)
├── platform/            # platform registry + providers
│   ├── platform.ts      # PlatformProvider interface + createPlatform registry
│   ├── mod.ts           # imports each provider for side-effect registration
│   ├── descriptor/      # per-family descriptor specs (bukkit.ts, bungee.ts, velocity.ts)
│   ├── spigot/          # Spigot, Bukkit, BuildTools
│   └── papermc/         # Paper, Folia, Velocity, Waterfall, Travertine
├── resolver/            # ⚠️ stub — dep resolution per source kind (modrinth, maven, file, workspace)
├── build/               # ⚠️ stub — compile → resources → descriptor → shade → jar
├── dev/                 # ⚠️ stub — dev-server runtime (stage, spawn, watch, plugins)
├── source.ts            # ⚠️ stub — source-string parser → ResolvedSource tagged union
├── workspace.ts         # ⚠️ stub — workspace discovery, inheritance, graph
├── lockfile.ts          # ⚠️ stub — pluggy.lock read/write/verify
├── portable.ts          # ⚠️ stub — cross-platform helpers (hardlink, paths, signals)
├── project.ts           # project.json resolution, Project types, OS-specific cache path
├── defaults/            # templates copied into new projects (config.yml, package.java)
├── template.ts          # ${project.x} substitution used by init and build
├── logging.ts           # terminal logging built on picocolors
├── types.d.ts           # ambient declarations for *.yml / *.java text imports
└── **/*.test.ts         # contract tests co-located with their modules
```

Plus: `playground/` (manual-test sandbox), `bin/` (compiled binary output), `.github/workflows/` (`bun build --compile` release pipeline).

## Runtime & tooling

Vite+ (`vp`) drives the development loop. Bun produces the shipped CLI binary. See the Vite+ block below for the full command surface.

- `vp install` - install dependencies
- `vp check` - format, lint, and type checks (Oxlint + Oxfmt + tsgo)
- `vp test` - run tests via the bundled Vitest
- `vp dev` / `vp pack` - library build during development
- `bun build --compile --outfile=bin/pluggy ./src/mod.ts` - standalone CLI binary for releases

Vite+'s `pack` only emits JavaScript. The single-file executable is always produced with Bun's `--compile` flag, which is what ships to users via the install scripts.

### Testing

Use `vite-plus/test` (the Vitest wrapper). Do **not** install `vitest` directly.

```ts
import { expect, test } from "vite-plus/test";
import { getPlatform } from "../src/platform/mod.ts";

test("spigot platform is registered", () => {
  expect(getPlatform("spigot").id).toBe("spigot");
});
```

Tests live next to the code they cover as `*.test.ts`. Network-dependent tests (platform `download`, `getVersions`) hit real upstream APIs intentionally — do not mock them.

### CLI conventions

- Every command lives in `src/commands/<name>.ts` and exports a factory `xxxCommand()` that returns a `Command` (from `commander`). `src/mod.ts` imports the factories and calls `program.addCommand()` — keep `mod.ts` thin.
- Inside an action, read global flags with `this.optsWithGlobals()` (the action must be a non-arrow `function` so `this` binds). Never reference a module-level `currentProject` — resolve fresh inside the action.
- Every command must honour the global `--json` flag: emit a single structured JSON object on success, and a `{ status: "error", message, exitCode }` object on failure. Never mix JSON and human text in the same output.
- Throw `InvalidArgumentError` (from `commander`) for user-input problems; throw regular `Error` for runtime/IO failures. Both are caught by the top-level handler in `src/mod.ts`, which formats them per `--json`.
- Use `@inquirer/prompts` for interactive prompts. `--yes` or `--json` must bypass prompts entirely — with `--json`, prompts become errors rather than hangs.
- New platform providers go through `createPlatform((ctx) => ({ ... }))` and must be imported from `src/platform/mod.ts` for the side-effect registration. `createPlatform` must not perform I/O at module-load time — defer disk writes to the command that needs them (otherwise the Bun-compiled binary crashes reading from the read-only `$bunfs` path).

### Stub-module convention

Many modules are stubs: their functions throw `new Error("not implemented: <name>")`. When implementing a stub:

1. Write or un-skip the contract tests in `<module>.test.ts` first. They're `describe.skip` blocks with concrete assertions — they define the contract the implementation must satisfy.
2. Replace the `throw` body with the implementation.
3. Remove the `.skip` from the tests and confirm they pass with `vp test <module>`.
4. Do not change the exported function signatures, argument shapes, or return types without updating `docs/SPEC.md` first. Callers in other modules rely on them.

This pattern lets parallel agents implement different modules without blocking on each other.

### Cross-platform requirements

Every file path, process spawn, signal, and UI concern must work identically on macOS, Linux, and Windows. Concrete rules live in `docs/SPEC.md` §3.8:

- Paths in `project.json` / `pluggy.lock` are always forward-slashed (normalize via `portable.toPosixPath`).
- Link large files with `portable.linkOrCopy` (hardlink first, copy fallback — never symlink).
- Signal handling goes through `portable.installShutdownHandler` which wraps `child.kill()` (the cross-platform Node shim).
- Write generated files with LF line endings (`portable.writeFileLF`).
- Never spawn a shell — always call `spawn(cmd, args, ...)` directly. Node handles `.exe` on Windows.

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, but it invokes Vite through `vp dev` and `vp build`.

## Vite+ Workflow

`vp` is a global binary that handles the full development lifecycle. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

### Start

- create - Create a new project from a template
- migrate - Migrate an existing project to Vite+
- config - Configure hooks and agent integration
- staged - Run linters on staged files
- install (`i`) - Install dependencies
- env - Manage Node.js versions

### Develop

- dev - Run the development server
- check - Run format, lint, and TypeScript type checks
- lint - Lint code
- fmt - Format code
- test - Run tests

### Execute

- run - Run monorepo tasks
- exec - Execute a command from local `node_modules/.bin`
- dlx - Execute a package binary without installing it as a dependency
- cache - Manage the task cache

### Build

- build - Build for production
- pack - Build libraries
- preview - Preview production build

### Manage Dependencies

Vite+ automatically detects and wraps the underlying package manager such as pnpm, npm, or Yarn through the `packageManager` field in `package.json` or package manager-specific lockfiles.

- add - Add packages to dependencies
- remove (`rm`, `un`, `uninstall`) - Remove packages from dependencies
- update (`up`) - Update packages to latest versions
- dedupe - Deduplicate dependencies
- outdated - Check for outdated packages
- list (`ls`) - List installed packages
- why (`explain`) - Show why a package is installed
- info (`view`, `show`) - View package information from the registry
- link (`ln`) / unlink - Manage local package links
- pm - Forward a command to the package manager

### Maintain

- upgrade - Update `vp` itself to the latest version

These commands map to their corresponding tools. For example, `vp dev --port 3000` runs Vite's dev server and works the same as Vite. `vp test` runs JavaScript tests through the bundled Vitest. The version of all tools can be checked using `vp --version`. This is useful when researching documentation, features, and bugs.

## Common Pitfalls

- **Using the package manager directly:** Do not use pnpm, npm, or Yarn directly. Vite+ can handle all package manager operations. For Bun-specific operations that Vite+ does not wrap (notably `bun build --compile`), calling `bun` directly is expected.
- **Always use Vite commands to run tools:** Don't attempt to run `vp vitest` or `vp oxlint`. They do not exist. Use `vp test` and `vp lint` instead.
- **Running scripts:** Vite+ built-in commands (`vp dev`, `vp build`, `vp test`, etc.) always run the Vite+ built-in tool, not any `package.json` script of the same name. To run a custom script that shares a name with a built-in command, use `vp run <script>`.
- **Do not install Vitest, Oxlint, Oxfmt, or tsdown directly:** Vite+ wraps these tools. They must not be installed directly. You cannot upgrade these tools by installing their latest versions. Always use Vite+ commands.
- **Use Vite+ wrappers for one-off binaries:** Use `vp dlx` instead of package-manager-specific `dlx`/`npx` commands.
- **Import JavaScript modules from `vite-plus`:** Instead of importing from `vite` or `vitest`, all modules should be imported from the project's `vite-plus` dependency. For example, `import { defineConfig } from 'vite-plus';` or `import { expect, test, vi } from 'vite-plus/test';`. You must not install `vitest` to import test utilities.
- **Type-Aware Linting:** There is no need to install `oxlint-tsgolint`, `vp lint --type-aware` works out of the box.

## CI Integration

For GitHub Actions, consider using [`voidzero-dev/setup-vp`](https://github.com/voidzero-dev/setup-vp) to replace separate `actions/setup-node`, package-manager setup, cache, and install steps with a single action.

```yaml
- uses: voidzero-dev/setup-vp@v1
  with:
    cache: true
- run: vp check
- run: vp test
```

## Review Checklist for Agents

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to validate changes.
- [ ] For release-shaped changes, verify `bun build --compile --outfile=bin/pluggy ./src/mod.ts` still produces a working binary.
<!--VITE PLUS END-->
