import process from "node:process";

import { Command, InvalidArgumentError } from "commander";

import { buildProject, type BuildResult } from "../build/index.ts";
import { bold, log } from "../logging.ts";
import type { ResolvedProject } from "../project.ts";
import {
  findWorkspace,
  resolveWorkspaceContext,
  topologicalOrder,
  type WorkspaceContext,
} from "../workspace.ts";

/**
 * Options extracted from commander flags that `runBuildCommand` consumes.
 * Extracting the helper keeps tests off the commander surface.
 */
export interface BuildCommandOptions {
  output?: string;
  clean?: boolean;
  skipClasspath?: boolean;
  workspace?: string;
  workspaces?: boolean;
  json?: boolean;
  cwd?: string;
}

export interface BuildCommandResult {
  status: "success" | "partial";
  /** Zero on full success, 1 when at least one workspace failed. */
  exitCode: 0 | 1;
  results: Array<{
    workspace: string;
    rootDir: string;
    ok: boolean;
    outputPath?: string;
    sizeBytes?: number;
    durationMs: number;
    error?: string;
  }>;
}

/**
 * Core command runner. Exposed for tests so they don't have to parse argv.
 *
 * Returns an aggregate result. Exit-code mapping is the caller's job; the
 * CLI wires `process.exit(result.exitCode)` at the end.
 */
export async function runBuildCommand(opts: BuildCommandOptions): Promise<BuildCommandResult> {
  const cwd = opts.cwd ?? process.cwd();
  const context = resolveWorkspaceContext(cwd);
  if (context === undefined) {
    throw new Error("No pluggy project found — run this from inside a project directory.");
  }

  // Determine the list of workspaces to build.
  const targets = selectBuildTargets(context, opts);

  const results: BuildCommandResult["results"] = [];
  let anyFailed = false;

  for (const target of targets) {
    const label = target.name;
    const rootDir = target.rootDir;
    const started = Date.now();
    try {
      if (!opts.json) {
        log.info(`${bold("build")} ${label}`);
      }
      const res: BuildResult = await buildProject(target, {
        output: opts.output,
        clean: opts.clean,
        skipClasspath: opts.skipClasspath,
      });
      results.push({
        workspace: label,
        rootDir,
        ok: true,
        outputPath: res.outputPath,
        sizeBytes: res.sizeBytes,
        durationMs: res.durationMs,
      });
      if (!opts.json) {
        log.success(
          `${label}: ${res.outputPath} (${formatBytes(res.sizeBytes)}, ${res.durationMs}ms)`,
        );
      }
    } catch (err) {
      anyFailed = true;
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        workspace: label,
        rootDir,
        ok: false,
        durationMs: Date.now() - started,
        error: message,
      });
      if (!opts.json) {
        log.error(`${label}: ${message}`);
      }
      // Single-project failure: rethrow so the CLI surfaces it cleanly.
      if (targets.length === 1) {
        throw err;
      }
      // Multi-workspace: continue through the rest so the user sees
      // which others succeeded.
    }
  }

  const exitCode: 0 | 1 = anyFailed ? 1 : 0;
  const status: BuildCommandResult["status"] = anyFailed ? "partial" : "success";

  if (opts.json) {
    const payload = {
      status: anyFailed ? "error" : "success",
      results: results.map((r) => ({
        workspace: r.workspace,
        rootDir: r.rootDir,
        ok: r.ok,
        outputPath: r.outputPath,
        sizeBytes: r.sizeBytes,
        durationMs: r.durationMs,
        error: r.error,
      })),
    };
    if (anyFailed) {
      // Aggregate failure → stderr per §3.1.
      console.error(JSON.stringify(payload, null, 2));
    } else {
      console.log(JSON.stringify(payload, null, 2));
    }
  } else if (targets.length > 1) {
    log.info("");
    log.info(bold("summary"));
    for (const r of results) {
      if (r.ok) {
        log.info(
          `  ${r.workspace}: ${r.outputPath} (${formatBytes(r.sizeBytes ?? 0)}, ${r.durationMs}ms)`,
        );
      } else {
        log.info(`  ${r.workspace}: FAILED — ${r.error ?? "unknown error"}`);
      }
    }
  }

  return { status, exitCode, results };
}

/**
 * Resolve the list of workspaces/projects to build based on context + flags.
 *
 * Rules (per spec §2.9):
 *  - At a root with workspaces, default to all in topological order.
 *    `--workspace <name>` narrows to one. `--workspaces` is an explicit opt-in.
 *  - Inside a workspace, build that workspace.
 *  - Standalone projects build themselves.
 *
 * Exported for testing.
 */
export function selectBuildTargets(
  context: WorkspaceContext,
  opts: Pick<BuildCommandOptions, "workspace" | "workspaces">,
): ResolvedProject[] {
  // At the root with declared workspaces.
  if (context.atRoot && context.workspaces.length > 0) {
    if (opts.workspace !== undefined) {
      const node = findWorkspace(context, opts.workspace);
      return [node.project];
    }
    // Default: build all in topological order.
    return topologicalOrder(context.workspaces).map((n) => n.project);
  }

  // Inside a workspace.
  if (context.current !== undefined) {
    if (opts.workspace !== undefined && opts.workspace !== context.current.name) {
      throw new InvalidArgumentError(
        `--workspace "${opts.workspace}" does not match the current workspace "${context.current.name}". Run from the root to build a different workspace.`,
      );
    }
    if (opts.workspaces === true) {
      // Spec treats --workspaces as meaningful only at the root. Refuse inside.
      throw new InvalidArgumentError(
        "--workspaces is only valid at the repo root; you're inside workspace " +
          `"${context.current.name}".`,
      );
    }
    return [context.current.project];
  }

  // Standalone project.
  if (opts.workspace !== undefined) {
    throw new InvalidArgumentError(
      `--workspace "${opts.workspace}" given but this project declares no workspaces.`,
    );
  }
  return [context.root];
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function buildCommand(): Command {
  return new Command("build")
    .alias("b")
    .description("Build the project and output a plugin jar.")
    .option("--output <path>", "Output jar path.")
    .option("--clean", "Wipe build cache before building.")
    .option("--skip-classpath", "Don't regenerate .classpath.")
    .option("--workspace <name>", "Build a single workspace.")
    .option("--workspaces", "Explicit all-workspaces build.")
    .action(async function action(this: Command, options) {
      const globalOpts = this.optsWithGlobals();
      const result = await runBuildCommand({
        output: options.output,
        clean: options.clean === true,
        skipClasspath: options.skipClasspath === true,
        workspace: options.workspace,
        workspaces: options.workspaces === true,
        json: globalOpts.json === true,
      });
      if (result.exitCode !== 0) {
        // One or more workspace builds failed — signal a non-zero exit.
        process.exit(result.exitCode);
      }
    });
}
