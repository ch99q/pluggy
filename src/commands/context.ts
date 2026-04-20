/**
 * Shared helpers for commands that operate on a workspace scope.
 *
 * `install` and `remove` need to turn global flags + cwd into:
 *   - a concrete list of target workspace nodes (or the root, for standalone
 *     projects), and
 *   - a ResolveContext for the resolver (merged registries, root dir).
 *
 * Keeping this shared avoids two copies of the scope-resolution rules drifting
 * apart. See docs/SPEC.md §2.4 / §2.5 for the scoping rules.
 */

import process from "node:process";

import { InvalidArgumentError } from "commander";

import type { ResolvedProject } from "../project.ts";
import type { ResolveContext } from "../resolver/index.ts";
import type { WorkspaceContext } from "../workspace.ts";
import { findWorkspace, resolveWorkspaceContext } from "../workspace.ts";

export interface ScopeOptions {
  /** Global `--project <path>` override (commander reads via optsWithGlobals). */
  cwd?: string;
  /** Per-command `--workspace <name>` flag. */
  workspace?: string;
  /** Per-command `--workspaces` flag (explicitly all). */
  workspaces?: boolean;
  /**
   * When true, refuse to implicitly span all workspaces at a root. `remove`
   * wants this — running at the root without an explicit flag is ambiguous.
   * `install` sets this to false (at-root default is "all workspaces").
   */
  requireExplicitAtRoot?: boolean;
  /** Command name, used in error messages ("install", "remove", ...). */
  commandName: string;
}

/**
 * A single target for a workspace-aware command. Either a concrete workspace
 * node, or the root project itself (standalone projects only).
 */
export interface ScopeTarget {
  /** Human-readable name for logs / JSON output. */
  name: string;
  /** The resolved project this target writes to. */
  project: ResolvedProject;
}

export interface ResolvedScope {
  /** The full workspace context (root + all workspaces). */
  context: WorkspaceContext;
  /** Every target the command should act on. At least one. */
  targets: ScopeTarget[];
  /**
   * True when the caller is acting across every workspace (either implicitly
   * at a root, or with `--workspaces`). False for single-target commands.
   */
  spansAllWorkspaces: boolean;
}

/**
 * Resolve the workspace scope from cwd + per-command flags.
 *
 * Throws `InvalidArgumentError` for user-input problems (no project found,
 * unknown workspace name, ambiguous root scope).
 */
export function resolveScope(opts: ScopeOptions): ResolvedScope {
  const cwd = opts.cwd ?? process.cwd();
  const context = resolveWorkspaceContext(cwd);
  if (context === undefined) {
    throw new InvalidArgumentError(
      `${opts.commandName}: no pluggy project found at or above "${cwd}"`,
    );
  }

  // --workspace <name> wins over all other scoping — pick that single node.
  if (opts.workspace !== undefined) {
    if (context.workspaces.length === 0) {
      throw new InvalidArgumentError(
        `${opts.commandName}: --workspace "${opts.workspace}" was given but this project has no workspaces`,
      );
    }
    const node = findWorkspace(context, opts.workspace);
    return {
      context,
      targets: [{ name: node.name, project: node.project }],
      spansAllWorkspaces: false,
    };
  }

  // --workspaces (plural): explicitly act on every workspace.
  if (opts.workspaces === true) {
    if (context.workspaces.length === 0) {
      throw new InvalidArgumentError(
        `${opts.commandName}: --workspaces was given but this project has no workspaces`,
      );
    }
    return {
      context,
      targets: context.workspaces.map((w) => ({ name: w.name, project: w.project })),
      spansAllWorkspaces: true,
    };
  }

  // Inside a workspace → that workspace only.
  if (context.current !== undefined) {
    return {
      context,
      targets: [{ name: context.current.name, project: context.current.project }],
      spansAllWorkspaces: false,
    };
  }

  // At the root. If workspaces exist, scoping rules split between commands:
  //   - `remove` requires an explicit flag here (ambiguous otherwise).
  //   - `install` defaults to "all workspaces".
  if (context.workspaces.length > 0) {
    if (opts.requireExplicitAtRoot === true) {
      throw new InvalidArgumentError(
        `${opts.commandName}: at the workspace root — pass --workspace <name> or --workspaces to disambiguate`,
      );
    }
    return {
      context,
      targets: context.workspaces.map((w) => ({ name: w.name, project: w.project })),
      spansAllWorkspaces: true,
    };
  }

  // Standalone project — single target = the root.
  return {
    context,
    targets: [{ name: context.root.name, project: context.root }],
    spansAllWorkspaces: false,
  };
}

/**
 * Build a ResolveContext suitable for passing to `resolveDependency`.
 *
 * Registries are read off the root (workspace merging happens there already);
 * `rootDir` is the root's directory, which is the base for `file:` paths and
 * the location of `pluggy.lock`.
 */
export function buildResolveContext(
  context: WorkspaceContext,
  flags: { beta?: boolean; force?: boolean } = {},
): ResolveContext {
  const registries: string[] = [];
  const seen = new Set<string>();
  // Pull registries from both the root and every workspace. `workspace.ts`
  // already merges root-into-workspace, but the root's own `registries` array
  // isn't on any workspace node if there are no workspaces. Easier to union
  // here than to reach across the boundary.
  const push = (entry: string | { url: string } | undefined): void => {
    if (entry === undefined) return;
    const url = typeof entry === "string" ? entry : entry.url;
    if (seen.has(url)) return;
    seen.add(url);
    registries.push(url);
  };
  for (const r of context.root.registries ?? []) push(r);
  for (const ws of context.workspaces) {
    for (const r of ws.project.registries ?? []) push(r);
  }

  return {
    rootDir: context.root.rootDir,
    includePrerelease: flags.beta === true,
    force: flags.force === true,
    registries,
    workspaceContext: context,
  };
}

/**
 * Enumerate every declared dependency across a list of targets.
 * Returns one entry per `(targetName, depName)` pair so install can track
 * `declaredBy` correctly.
 */
export function collectDeclared(targets: ScopeTarget[]): Array<{
  declaredBy: string;
  name: string;
  value: string | { source: string; version: string };
}> {
  const out: Array<{
    declaredBy: string;
    name: string;
    value: string | { source: string; version: string };
  }> = [];
  for (const target of targets) {
    const deps = target.project.dependencies ?? {};
    for (const name of Object.keys(deps)) {
      const value = deps[name];
      if (value === undefined) continue;
      out.push({ declaredBy: target.name, name, value });
    }
  }
  return out;
}

/**
 * Canonicalize a `DependencyValue` (either sugar string or long form) into a
 * `(source, version)` pair matching `project.json`'s long-form grammar.
 *
 * Short form (`"foo": "1.2.3"`) is sugar for `modrinth:<name>` — §1.4.
 */
export function canonicalizeDeclared(
  name: string,
  value: string | { source: string; version: string },
): { source: string; version: string } {
  if (typeof value === "string") {
    return { source: `modrinth:${name}`, version: value };
  }
  return { source: value.source, version: value.version };
}
