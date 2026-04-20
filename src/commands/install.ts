import { readFile } from "node:fs/promises";
import process from "node:process";

import { Command } from "commander";

import { writeFileLF } from "../portable.ts";
import type { Project } from "../project.ts";
import { resolveDependency } from "../resolver/index.ts";
import type { ResolvedDependency } from "../resolver/index.ts";
import {
  type Lockfile,
  type LockfileEntry,
  type TransitiveEntry,
  readLock,
  verifyLock,
  writeLock,
} from "../lockfile.ts";
import { parseIdentifier, parseSource, stringifySource } from "../source.ts";

import {
  buildResolveContext,
  canonicalizeDeclared,
  collectDeclared,
  resolveScope,
  type ResolvedScope,
  type ScopeTarget,
} from "./context.ts";

/** Flattened per-command + global options consumed by `doInstall`. */
export interface InstallOptions {
  plugin?: string;
  force?: boolean;
  beta?: boolean;
  workspace?: string;
  workspaces?: boolean;
  json?: boolean;
  project?: string;
  cwd?: string;
}

export interface InstallResult {
  installed: string[];
  skipped: string[];
  added?: { name: string; workspace: string };
}

/**
 * Run `pluggy install`. If `opts.plugin` is set, adds the single identifier
 * to the target workspace's `project.json` and folds it into the lockfile;
 * otherwise resolves every declared dependency across the scope and rewrites
 * `pluggy.lock`.
 */
export async function doInstall(opts: InstallOptions): Promise<InstallResult> {
  const scope = resolveScope({
    cwd: opts.cwd,
    workspace: opts.workspace,
    workspaces: opts.workspaces,
    requireExplicitAtRoot: false,
    commandName: "install",
  });

  if (opts.plugin !== undefined && opts.plugin.length > 0) {
    return installSingle(opts, scope);
  }

  return installAll(opts, scope);
}

async function installAll(opts: InstallOptions, scope: ResolvedScope): Promise<InstallResult> {
  const declared = collectDeclared(scope.targets);

  // The lockfile is flat: two workspaces declaring the same dep share one
  // entry with a merged `declaredBy`. Conflicting source/version between
  // workspaces is fatal — we can't pick a winner.
  const byName = new Map<
    string,
    { source: ReturnType<typeof parseSource>; declaredBy: string[] }
  >();
  for (const { name, value, declaredBy } of declared) {
    const canonical = canonicalizeDeclared(name, value);
    const resolvedSource = parseSource(canonical.source, canonical.version);
    const existing = byName.get(name);
    if (existing === undefined) {
      byName.set(name, { source: resolvedSource, declaredBy: [declaredBy] });
      continue;
    }
    if (
      stringifySource(existing.source) !== stringifySource(resolvedSource) ||
      existing.source.version !== resolvedSource.version
    ) {
      throw new Error(
        `install: conflicting declarations of "${name}" across workspaces — ${stringifySource(existing.source)}@${existing.source.version} vs ${stringifySource(resolvedSource)}@${resolvedSource.version}`,
      );
    }
    if (!existing.declaredBy.includes(declaredBy)) {
      existing.declaredBy.push(declaredBy);
    }
  }

  const existingLock: Lockfile = readLock(scope.context.root.rootDir) ?? {
    version: 1,
    entries: {},
  };
  const declaredMap: Record<string, { source: ReturnType<typeof parseSource> }> = {};
  for (const [name, info] of byName) {
    declaredMap[name] = { source: info.source };
  }
  const drift = verifyLock(existingLock, declaredMap);

  if (drift.length === 0 && opts.force !== true) {
    const result: InstallResult = { installed: [], skipped: [...byName.keys()] };
    emitInstallResult(opts, result, { message: "lockfile is fresh; nothing to install." });
    return result;
  }

  const toResolve = opts.force === true ? [...byName.keys()] : drift;
  const skipped = [...byName.keys()].filter((n) => !toResolve.includes(n));

  const resolveCtx = buildResolveContext(scope.context, { beta: opts.beta, force: opts.force });
  const nextEntries: Record<string, LockfileEntry> = { ...existingLock.entries };

  for (const name of toResolve) {
    const info = byName.get(name);
    if (info === undefined) continue;
    const resolved = await resolveDependency(info.source, resolveCtx);
    nextEntries[name] = toLockEntry(resolved, info.declaredBy);
  }

  // Drop orphan lockfile entries: after a full-resolve run the lock should
  // only contain what's declared across the repo.
  for (const key of Object.keys(nextEntries)) {
    if (!byName.has(key)) {
      delete nextEntries[key];
    }
  }

  await writeLock(scope.context.root.rootDir, { version: 1, entries: nextEntries });

  const result: InstallResult = { installed: toResolve, skipped };
  emitInstallResult(opts, result);
  return result;
}

async function installSingle(opts: InstallOptions, scope: ResolvedScope): Promise<InstallResult> {
  if (scope.context.atRoot && scope.context.workspaces.length > 0 && opts.workspace === undefined) {
    throw new Error(
      `install: at the workspace root — pass --workspace <name> to pick a target for "${opts.plugin}"`,
    );
  }

  if (scope.targets.length !== 1) {
    throw new Error(
      `install: --workspaces and a specific [plugin] are mutually exclusive — pick one workspace with --workspace <name>`,
    );
  }

  const target = scope.targets[0];
  const identifier = parseIdentifier(opts.plugin as string);

  const resolveCtx = buildResolveContext(scope.context, { beta: opts.beta, force: opts.force });
  const resolved = await resolveDependency(identifier, resolveCtx);

  const depName = pickDepName(identifier);
  await writeDependencyToProject(target, depName, {
    source: stringifySource(resolved.source),
    version: resolved.source.version,
  });

  const existingLock: Lockfile = readLock(scope.context.root.rootDir) ?? {
    version: 1,
    entries: {},
  };
  const nextEntries: Record<string, LockfileEntry> = { ...existingLock.entries };
  const prior = nextEntries[depName];
  const declaredBy =
    prior !== undefined && prior.declaredBy.includes(target.name)
      ? prior.declaredBy
      : [...(prior?.declaredBy ?? []), target.name];
  nextEntries[depName] = toLockEntry(resolved, declaredBy);
  await writeLock(scope.context.root.rootDir, { version: 1, entries: nextEntries });

  const result: InstallResult = {
    installed: [depName],
    skipped: [],
    added: { name: depName, workspace: target.name },
  };
  emitInstallResult(opts, result);
  return result;
}

function toLockEntry(resolved: ResolvedDependency, declaredBy: string[]): LockfileEntry {
  const entry: LockfileEntry = {
    source: resolved.source,
    resolvedVersion: resolved.source.version,
    integrity: resolved.integrity,
    declaredBy,
  };
  if (resolved.transitiveDeps.length > 0) {
    entry.transitives = resolved.transitiveDeps.map(toTransitiveEntry);
  }
  return entry;
}

/**
 * Recursively project a resolved transitive dependency into a lockfile
 * `TransitiveEntry`. `declaredBy` is intentionally omitted — only
 * user-declared top-level deps carry that field. Empty transitive arrays
 * are omitted to keep lockfile diffs clean.
 */
function toTransitiveEntry(resolved: ResolvedDependency): TransitiveEntry {
  const entry: TransitiveEntry = {
    source: resolved.source,
    resolvedVersion: resolved.source.version,
    integrity: resolved.integrity,
  };
  if (resolved.transitiveDeps.length > 0) {
    entry.transitives = resolved.transitiveDeps.map(toTransitiveEntry);
  }
  return entry;
}

/**
 * Pick the human-readable dependency key for a CLI-parsed identifier —
 * slug, artifactId, workspace name, or file basename. Prefer these over the
 * raw source string so `project.json` stays legible.
 */
function pickDepName(source: ReturnType<typeof parseIdentifier>): string {
  switch (source.kind) {
    case "modrinth":
      return source.slug;
    case "maven":
      return source.artifactId;
    case "workspace":
      return source.name;
    case "file": {
      const base = source.path.replace(/\\/g, "/").split("/").pop() ?? source.path;
      return base.replace(/\.jar$/i, "") || source.path;
    }
  }
}

async function writeDependencyToProject(
  target: ScopeTarget,
  name: string,
  entry: { source: string; version: string },
): Promise<void> {
  const path = target.project.projectFile;
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    throw new Error(`install: failed to read ${path}: ${(err as Error).message}`);
  }
  let parsed: Project;
  try {
    parsed = JSON.parse(raw) as Project;
  } catch (err) {
    throw new Error(`install: failed to parse ${path}: ${(err as Error).message}`);
  }

  const deps: Record<string, string | { source: string; version: string }> = {
    ...parsed.dependencies,
  };
  deps[name] = entry;
  parsed.dependencies = deps;

  await writeFileLF(path, `${JSON.stringify(parsed, null, 2)}\n`);
}

function emitInstallResult(
  opts: InstallOptions,
  result: InstallResult,
  human?: { message?: string },
): void {
  if (opts.json === true) {
    process.stdout.write(
      `${JSON.stringify(
        { status: "success", installed: result.installed, skipped: result.skipped },
        null,
        2,
      )}\n`,
    );
    return;
  }
  if (human?.message !== undefined) {
    console.log(human.message);
    return;
  }
  if (result.added !== undefined) {
    console.log(
      `Installed ${result.added.name} into ${result.added.workspace} (${result.installed.length} resolved).`,
    );
    return;
  }
  if (result.installed.length === 0) {
    console.log(`Nothing to install. ${result.skipped.length} dependencies already locked.`);
    return;
  }
  console.log(
    `Installed ${result.installed.length} dependencies${
      result.skipped.length > 0 ? ` (${result.skipped.length} already fresh)` : ""
    }.`,
  );
}

/** Factory for the `pluggy install` commander command. */
export function installCommand(): Command {
  return new Command("install")
    .alias("i")
    .description("Install project dependencies or a specific plugin.")
    .argument("[plugin]", "Plugin identifier. Modrinth slug, local .jar, or maven: coordinate.")
    .option("--force", "Force dependency install (override compatibility checks).")
    .option("--beta", "Include pre-release versions during Modrinth resolution.")
    .option("--workspace <name>", "Target a specific workspace.")
    .option("--workspaces", "Run across all workspaces explicitly.")
    .addHelpText(
      "after",
      `\nExamples:\n  $ pluggy install\n  $ pluggy install EssentialsX@2.21.1\n  $ pluggy install ./libs/essentialsx-2.21.1.jar\n  $ pluggy install maven:com.example:my-plugin@1.0.0`,
    )
    .action(async function action(this: Command, plugin: string | undefined, options) {
      const globalOpts = this.optsWithGlobals();
      await doInstall({
        plugin,
        force: options.force,
        beta: options.beta,
        workspace: options.workspace,
        workspaces: options.workspaces,
        json: globalOpts.json,
        project: globalOpts.project,
      });
    });
}
