import process from "node:process";

import { Command } from "commander";

import { bold, dim, log } from "../logging.ts";
import { readLock } from "../lockfile.ts";
import type { Dependency, Registry, ResolvedProject } from "../project.ts";
import { parseSource, type ResolvedSource } from "../source.ts";
import {
  findWorkspace,
  resolveWorkspaceContext,
  type WorkspaceContext,
  type WorkspaceNode,
} from "../workspace.ts";

export interface ListOptions {
  tree?: boolean;
  outdated?: boolean;
  workspace?: string;
  workspaces?: boolean;
  json?: boolean;
  project?: string;
  cwd?: string;
}

export interface DepEntry {
  name: string;
  source: ResolvedSource;
  declaredVersion: string;
  resolvedVersion: string | null;
  integrity: string | null;
  declaredBy: string[];
}

export interface RegistryEntry {
  url: string;
  authenticated: boolean;
}

export interface ListResult {
  scope: "root" | "workspace" | "standalone";
  deps: DepEntry[];
  registries: RegistryEntry[];
  target: string;
}

/**
 * Perform the `list` action. Exposed as a helper so tests can drive it
 * without going through commander.
 */
export async function doList(options: ListOptions): Promise<ListResult> {
  const cwd = options.cwd ?? process.cwd();
  const ctx = resolveWorkspaceContext(cwd);
  if (ctx === undefined) {
    throw new Error(`not inside a pluggy project (from ${cwd})`);
  }

  const scope = determineScope(ctx, options);
  const targets = selectTargets(ctx, options, scope);
  const lock = readLock(ctx.root.rootDir);

  // Aggregate declarations keyed by dep name. A workspace and its siblings
  // may declare the same dep; we merge their `declaredBy` entries.
  const agg = new Map<string, DepEntry>();
  for (const { declaringName, project } of targets) {
    const deps = project.dependencies ?? {};
    for (const [name, rawValue] of Object.entries(deps)) {
      const source = normalizeDependencySource(name, rawValue);
      const declaredVersion = source.version;

      const lockEntry = lock?.entries[name];
      const resolvedVersion = lockEntry?.resolvedVersion ?? null;
      const integrity = lockEntry?.integrity ?? null;

      const existing = agg.get(name);
      if (existing) {
        if (!existing.declaredBy.includes(declaringName)) {
          existing.declaredBy.push(declaringName);
        }
      } else {
        agg.set(name, {
          name,
          source,
          declaredVersion,
          resolvedVersion,
          integrity,
          declaredBy: [declaringName],
        });
      }
    }
  }

  // Stable alphabetical ordering so tests and diffs are deterministic.
  const deps = Array.from(agg.values()).sort((a, b) => a.name.localeCompare(b.name));

  // Registries come from the root (merged) config. Credentials are elided to
  // avoid leaking secrets through `--json` output or logs.
  const registries = collectRegistries(ctx);

  const target =
    scope === "root"
      ? ctx.root.name
      : scope === "workspace"
        ? (options.workspace ?? ctx.current?.name ?? ctx.root.name)
        : ctx.root.name;

  const result: ListResult = { scope, deps, registries, target };

  if (options.outdated) {
    if (options.json) {
      // No mutation; just noted in the JSON payload (future: per-entry newer).
    } else {
      log.info(
        dim("(--outdated not yet implemented; will require a Modrinth version-query per dep)"),
      );
    }
  }

  if (options.tree) {
    if (!options.json) {
      log.info(
        dim("(--tree not yet implemented; transitive deps aren't tracked — printing flat list)"),
      );
    }
  }

  if (options.json) {
    console.log(JSON.stringify({ status: "success", ...result }, null, 2));
  } else {
    printHumanList(result);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Scope / targets
// ---------------------------------------------------------------------------

function determineScope(
  ctx: WorkspaceContext,
  options: ListOptions,
): "root" | "workspace" | "standalone" {
  if (ctx.workspaces.length === 0) return "standalone";
  if (options.workspace !== undefined) return "workspace";
  if (options.workspaces) return "root";
  // At root with workspaces and no flag → aggregated.
  if (ctx.atRoot) return "root";
  // Inside a workspace → current only, unless --workspaces given.
  return "workspace";
}

interface DepTarget {
  declaringName: string;
  project: ResolvedProject;
}

function selectTargets(
  ctx: WorkspaceContext,
  options: ListOptions,
  scope: "root" | "workspace" | "standalone",
): DepTarget[] {
  if (scope === "standalone") {
    return [{ declaringName: ctx.root.name, project: ctx.root }];
  }
  if (scope === "workspace") {
    if (options.workspace !== undefined) {
      const node = findWorkspace(ctx, options.workspace);
      return [{ declaringName: node.name, project: node.project }];
    }
    if (ctx.current) {
      return [{ declaringName: ctx.current.name, project: ctx.current.project }];
    }
    // Fall through — no current workspace; treat as root.
  }
  // Root: every workspace.
  return ctx.workspaces.map((w: WorkspaceNode) => ({
    declaringName: w.name,
    project: w.project,
  }));
}

// ---------------------------------------------------------------------------
// Dependency value normalization
// ---------------------------------------------------------------------------

function normalizeDependencySource(name: string, raw: string | Dependency): ResolvedSource {
  // Short-form string is a Modrinth pin. The dep name doubles as the slug.
  if (typeof raw === "string") {
    return { kind: "modrinth", slug: name, version: raw };
  }
  return parseSource(raw.source, raw.version);
}

// ---------------------------------------------------------------------------
// Registries
// ---------------------------------------------------------------------------

function collectRegistries(ctx: WorkspaceContext): RegistryEntry[] {
  // Resolve from current scope's merged config if inside a workspace (so a
  // workspace can see its inherited+own registries), else from root.
  const project = ctx.current?.project ?? ctx.root;
  const raw = project.registries ?? [];
  const out: RegistryEntry[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const { url, authenticated } = normalizeRegistry(entry);
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ url, authenticated });
  }
  return out;
}

function normalizeRegistry(entry: string | Registry): RegistryEntry {
  if (typeof entry === "string") return { url: entry, authenticated: false };
  return { url: entry.url, authenticated: entry.credentials !== undefined };
}

// ---------------------------------------------------------------------------
// Human output
// ---------------------------------------------------------------------------

function printHumanList(result: ListResult): void {
  log.info(bold(`${result.scope}: ${result.target}`));
  if (result.deps.length === 0) {
    log.info(dim("  (no dependencies declared)"));
  } else {
    log.info("");
    log.info(bold("dependencies:"));
    for (const dep of result.deps) {
      const resolved = dep.resolvedVersion ?? dim("(unresolved — run install)");
      const decl = result.scope === "root" ? ` ${dim(`[${dep.declaredBy.join(", ")}]`)}` : "";
      log.info(
        `  ${dep.name}  ${dim(`declared: ${dep.declaredVersion}`)}  ${dim(`resolved:`)} ${resolved}  ${dim(describeSource(dep.source))}${decl}`,
      );
    }
  }
  log.info("");
  log.info(bold("registries:"));
  if (result.registries.length === 0) {
    log.info(dim("  (none declared; Modrinth is implicit)"));
  } else {
    for (const reg of result.registries) {
      const auth = reg.authenticated ? dim(" [authenticated]") : "";
      log.info(`  ${reg.url}${auth}`);
    }
  }
}

function describeSource(source: ResolvedSource): string {
  switch (source.kind) {
    case "modrinth":
      return `modrinth:${source.slug}`;
    case "maven":
      return `maven:${source.groupId}:${source.artifactId}`;
    case "file":
      return `file:${source.path}`;
    case "workspace":
      return `workspace:${source.name}`;
  }
}

export function listCommand(): Command {
  return new Command("list")
    .alias("ls")
    .description("List all installed plugins, dependencies and registries.")
    .option("--tree", "Render as dependency tree (with transitive deps).")
    .option("--outdated", "Only list deps with newer versions available.")
    .option("--workspace <name>", "Show a specific workspace.")
    .option("--workspaces", "Aggregated view across all workspaces.")
    .action(async function action(this: Command, options) {
      const globalOpts = this.optsWithGlobals();
      await doList({
        tree: options.tree,
        outdated: options.outdated,
        workspace: options.workspace,
        workspaces: options.workspaces,
        json: globalOpts.json,
        project: globalOpts.project,
      });
    });
}
