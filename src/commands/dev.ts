import { join } from "node:path";
import process from "node:process";

import { Command, InvalidArgumentError } from "commander";

import { runDev } from "../dev/index.ts";
import { log } from "../logging.ts";
import type { ResolvedProject } from "../project.ts";
import { findWorkspace, resolveWorkspaceContext, type WorkspaceContext } from "../workspace.ts";

import { parseInteger, parsePlatform, parseSemver } from "./parsers.ts";

export interface DevCommandOptions {
  workspace?: string;
  platform?: string;
  version?: string;
  port?: number;
  memory?: string;
  clean?: boolean;
  freshWorld?: boolean;
  /**
   * Commander's `--no-watch` flag produces `watch === false` here; the
   * absence of the flag defaults to `true`.
   */
  watch?: boolean;
  reload?: boolean;
  offline?: boolean;
  json?: boolean;
  cwd?: string;
}

/**
 * Core command runner. Exposed for tests so they don't have to parse argv.
 *
 * Resolves workspace context, picks the target workspace, emits the JSON
 * startup line if asked, and delegates to `runDev`. Errors from `runDev`
 * are allowed to propagate — the CLI's top-level handler formats them.
 *
 * `dev` is inherently interactive: the dev server's own stdout/stderr stream
 * to the user's terminal. With `--json`, we emit one startup JSON line and
 * then let the server logs through unchanged (stderr). This matches the
 * "one structured envelope, then raw output" pattern from §3.1.
 */
export async function runDevCommand(opts: DevCommandOptions): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const context = resolveWorkspaceContext(cwd);
  if (context === undefined) {
    throw new Error("No pluggy project found — run this from inside a project directory.");
  }

  const target = selectDevTarget(context, opts);

  if (opts.json === true) {
    const platformId = opts.platform ?? target.compatibility?.platforms?.[0];
    const mcVersion = opts.version ?? target.compatibility?.versions?.[0];
    const port = opts.port ?? target.dev?.port ?? 25565;
    const devDir = join(target.rootDir, "dev");
    const startupLine = {
      status: "starting",
      platform: platformId,
      version: mcVersion,
      port,
      devDir,
    };
    console.log(JSON.stringify(startupLine));
  } else {
    log.info(`dev: starting ${target.name}`);
  }

  // Forward JVM args from `dev.jvmArgs` in project.json (there is no CLI flag
  // in the declared surface; `--args` is documented but not wired as a
  // commander option per the task's flag list).
  await runDev(target, {
    platform: opts.platform,
    version: opts.version,
    port: opts.port,
    memory: opts.memory,
    clean: opts.clean,
    freshWorld: opts.freshWorld,
    watch: opts.watch,
    reload: opts.reload,
    offline: opts.offline,
    args: target.dev?.jvmArgs,
  });
}

/**
 * Resolve the one target workspace based on context + flags.
 *
 * Rules (per spec §2.11):
 *  - At a root with workspaces → `--workspace <name>` is required.
 *  - Inside a workspace → that workspace.
 *  - Standalone → the project itself.
 *  - `--workspaces` is not a flag on this command; `dev` is always one.
 *
 * Exported for testing.
 */
export function selectDevTarget(
  context: WorkspaceContext,
  opts: Pick<DevCommandOptions, "workspace">,
): ResolvedProject {
  if (context.atRoot && context.workspaces.length > 0) {
    if (opts.workspace === undefined) {
      throw new InvalidArgumentError(
        "dev requires --workspace <name> at a root that declares workspaces. " +
          `Known workspaces: ${context.workspaces.map((w) => w.name).join(", ")}`,
      );
    }
    return findWorkspace(context, opts.workspace).project;
  }

  if (context.current !== undefined) {
    if (opts.workspace !== undefined && opts.workspace !== context.current.name) {
      throw new InvalidArgumentError(
        `--workspace "${opts.workspace}" does not match the current workspace "${context.current.name}". Run from the root to target a different workspace.`,
      );
    }
    return context.current.project;
  }

  // Standalone.
  if (opts.workspace !== undefined) {
    throw new InvalidArgumentError(
      `--workspace "${opts.workspace}" given but this project declares no workspaces.`,
    );
  }
  return context.root;
}

export function devCommand(): Command {
  return new Command("dev")
    .description("Start a development server for the project.")
    .option("--workspace <name>", "Required when run at a root with workspaces.")
    .option("--platform <name>", "Override the primary platform.", parsePlatform)
    .option("--version <ver>", "Override the primary MC version.", parseSemver)
    .option("--port <n>", "Server listen port.", parseInteger)
    .option("--memory <x>", "JVM heap size (e.g. 2G, 512M).")
    .option("--clean", "Wipe dev/ before starting.")
    .option("--fresh-world", "Keep dev/ but delete dev/world*.")
    .option("--no-watch", "Run once, don't watch or rebuild.")
    .option("--reload", "Use /reload instead of full restart on change.")
    .option("--offline", "Set online-mode=false in server.properties.")
    .action(async function action(this: Command, options) {
      const globalOpts = this.optsWithGlobals();
      await runDevCommand({
        workspace: options.workspace,
        platform: options.platform,
        version: options.version,
        port: options.port,
        memory: options.memory,
        clean: options.clean === true,
        freshWorld: options.freshWorld === true,
        // commander: `--no-watch` → opts.watch === false; absence → undefined
        // (commander's default for negated bool flags is `true` when registered
        // via `.option("--no-watch", ...)`). Pass through verbatim so `runDev`
        // sees `watch !== false` means "watch".
        watch: options.watch,
        reload: options.reload === true,
        offline: options.offline === true,
        json: globalOpts.json === true,
      });
    });
}
