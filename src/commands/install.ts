import { readFile } from "node:fs/promises";
import process from "node:process";

import { Command } from "commander";

import { writeFileLF } from "../portable.ts";
import type { Project } from "../project.ts";
import { resolveDependency } from "../resolver/index.ts";
import type { ResolvedDependency } from "../resolver/index.ts";
import { type Lockfile, type LockfileEntry, readLock, verifyLock, writeLock } from "../lockfile.ts";
import { parseIdentifier, parseSource, stringifySource } from "../source.ts";

import {
  buildResolveContext,
  canonicalizeDeclared,
  collectDeclared,
  resolveScope,
  type ResolvedScope,
  type ScopeTarget,
} from "./context.ts";

/**
 * Parameters for the non-action install helper. Flattens both per-command
 * options and the subset of global options the command cares about, so tests
 * can invoke it with a plain object.
 */
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
 * The actual install action, split out from the commander wrapper so tests
 * can exercise it without routing through `program.parseAsync`.
 *
 * Returns a summary for the caller (the wrapper converts it to stdout).
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

/**
 * `install` with no plugin argument — resolve everything already declared
 * across the targeted scope, writing a fresh lockfile if drift is present.
 */
async function installAll(opts: InstallOptions, scope: ResolvedScope): Promise<InstallResult> {
  const declared = collectDeclared(scope.targets);

  // Collapse per-target declarations by name. The lockfile is flat and shared
  // across the repo, so two workspaces declaring the same dep share a single
  // entry — we just extend its `declaredBy` list.
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
    // If two workspaces disagree on the source/version, that's a real conflict
    // the resolver can't silently paper over. Surface it rather than pick one.
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
    // Nothing to do. Still write back with updated declaredBy if it has drifted?
    // Spec §3.5 doesn't require that — treat "fresh" as a no-op.
    const result: InstallResult = { installed: [], skipped: [...byName.keys()] };
    emitInstallResult(opts, result, { message: "lockfile is fresh; nothing to install." });
    return result;
  }

  // Anything not in drift but already locked is effectively a skip; the rest
  // we (re-)resolve. `--force` re-resolves every declaration.
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

  // Drop lock entries that aren't declared anywhere (orphans are user-visible
  // clutter — and §3.5 ranges across all declarations, so after a full resolve
  // run the lock should only contain what's declared).
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

/**
 * `install <plugin>` — add a single new dependency to the target workspace's
 * `project.json`, then fold it into the lockfile.
 */
async function installSingle(opts: InstallOptions, scope: ResolvedScope): Promise<InstallResult> {
  // At a root with workspaces, installing a single plugin without a target
  // is ambiguous (same reasoning as `remove`).
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

  // Write the long-form dependency entry into the target `project.json`.
  const depName = pickDepName(identifier);
  await writeDependencyToProject(target, depName, {
    source: stringifySource(resolved.source),
    version: resolved.source.version,
  });

  // Merge into existing lockfile (add/replace one entry, keep the rest).
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

/** Produce a LockfileEntry from a resolver result + declaredBy list. */
function toLockEntry(resolved: ResolvedDependency, declaredBy: string[]): LockfileEntry {
  return {
    source: resolved.source,
    resolvedVersion: resolved.source.version,
    integrity: resolved.integrity,
    declaredBy,
  };
}

/**
 * Choose the dependency key under which a CLI-parsed identifier lands in
 * `project.json`. We prefer a human-readable name (slug, artifactId, workspace
 * name, or file basename) over the full source string.
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
      // Use the jar's basename minus `.jar` to produce a legible key.
      const base = source.path.replace(/\\/g, "/").split("/").pop() ?? source.path;
      return base.replace(/\.jar$/i, "") || source.path;
    }
  }
}

/**
 * Add (or replace) one dependency in a project's `project.json`. Rewrites the
 * file with 2-space-indented JSON and a trailing LF so diffs stay clean.
 */
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
