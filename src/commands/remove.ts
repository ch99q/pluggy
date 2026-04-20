import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";

import { Command } from "commander";

import { writeFileLF } from "../portable.ts";
import { getCachePath, type Project } from "../project.ts";
import { type Lockfile, type LockfileEntry, readLock, writeLock } from "../lockfile.ts";

import { resolveScope, type ScopeTarget } from "./context.ts";

export interface RemoveOptions {
  plugin: string;
  keepFile?: boolean;
  workspace?: string;
  workspaces?: boolean;
  json?: boolean;
  project?: string;
  cwd?: string;
}

export interface RemoveResult {
  /** Workspace names that had the dep removed. */
  removed: string[];
  /** Workspace names where the dep was not present (only populated under --workspaces). */
  missing: string[];
  /** True if the lockfile entry was also dropped. */
  lockEntryRemoved: boolean;
  /** True if the cached jar was deleted. */
  fileRemoved: boolean;
}

export async function doRemove(opts: RemoveOptions): Promise<RemoveResult> {
  if (typeof opts.plugin !== "string" || opts.plugin.length === 0) {
    throw new Error("remove: plugin name is required");
  }

  const scope = resolveScope({
    cwd: opts.cwd,
    workspace: opts.workspace,
    workspaces: opts.workspaces,
    requireExplicitAtRoot: true,
    commandName: "remove",
  });

  const removed: string[] = [];
  const missing: string[] = [];

  for (const target of scope.targets) {
    const present = await removeFromProject(target, opts.plugin, {
      // When we span all workspaces, missing deps are informational, not errors.
      errorIfMissing: !scope.spansAllWorkspaces,
    });
    if (present) {
      removed.push(target.name);
    } else {
      missing.push(target.name);
    }
  }

  // Lockfile: drop the entry if no workspace still declares it.
  let lockEntryRemoved = false;
  const rootDir = scope.context.root.rootDir;
  const lock: Lockfile | null = readLock(rootDir);
  if (lock !== null && lock.entries[opts.plugin] !== undefined) {
    // A dep is "still declared" when an untouched workspace (or the root, if
    // standalone) still has it in its `dependencies` map. `removed` names the
    // targets we just edited — everything outside that list is untouched.
    const touched = new Set(removed);
    const stillDeclaredSomewhere = declaresDepOutside(scope.context, opts.plugin, touched);
    if (!stillDeclaredSomewhere) {
      const nextEntries = { ...lock.entries };
      delete nextEntries[opts.plugin];
      await writeLock(rootDir, { version: 1, entries: nextEntries });
      lockEntryRemoved = true;
    } else {
      // Trim declaredBy to match the new reality so the lockfile stays honest.
      const entry = lock.entries[opts.plugin];
      const nextDeclaredBy = entry.declaredBy.filter((w) => !touched.has(w));
      if (nextDeclaredBy.length !== entry.declaredBy.length) {
        const nextEntries = {
          ...lock.entries,
          [opts.plugin]: { ...entry, declaredBy: nextDeclaredBy },
        };
        await writeLock(rootDir, { version: 1, entries: nextEntries });
      }
    }
  }

  // Best-effort cached jar deletion. Failures are logged, not fatal —
  // the dep is already out of project.json and pluggy.lock at this point.
  //
  // We drop the *cached* copy (under `<cache>/dependencies/`), never the
  // user's own source file. The cached copy is content-addressed by the
  // integrity hash.
  let fileRemoved = false;
  if (opts.keepFile !== true && lockEntryRemoved) {
    const priorEntry = lock?.entries[opts.plugin];
    if (priorEntry !== undefined) {
      const cachePath = cachedJarPathFor(priorEntry);
      if (cachePath !== undefined) {
        try {
          await unlink(cachePath);
          fileRemoved = true;
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code !== "ENOENT") {
            // Warn but don't fail — §2.5 is explicit that this is best-effort.
            console.warn(`remove: could not delete ${cachePath}: ${(err as Error).message}`);
          }
        }
      }
    }
  }

  const result: RemoveResult = { removed, missing, lockEntryRemoved, fileRemoved };
  emitRemoveResult(opts, result);
  return result;
}

/**
 * Remove the named dep from a single project's `project.json`. Returns true
 * if the dep was present (and removed); false if absent. When `errorIfMissing`
 * is set, an absent dep throws instead.
 */
async function removeFromProject(
  target: ScopeTarget,
  name: string,
  flags: { errorIfMissing: boolean },
): Promise<boolean> {
  const path = target.project.projectFile;
  const raw = await readFile(path, "utf8");
  let parsed: Project;
  try {
    parsed = JSON.parse(raw) as Project;
  } catch (err) {
    throw new Error(`remove: failed to parse ${path}: ${(err as Error).message}`);
  }
  const deps = parsed.dependencies ?? {};
  if (!(name in deps)) {
    if (flags.errorIfMissing) {
      throw new Error(`remove: "${name}" is not declared in ${target.name} (${path})`);
    }
    return false;
  }

  const { [name]: _dropped, ...rest } = deps;
  parsed.dependencies = rest;
  if (Object.keys(rest).length === 0) {
    delete parsed.dependencies;
  }
  await writeFileLF(path, `${JSON.stringify(parsed, null, 2)}\n`);
  return true;
}

/**
 * Is `name` still declared by any project we did NOT just touch?
 *
 * `scope.context` reflects the pre-write state, so we answer by walking every
 * workspace (or the root, for standalones) and skipping anything in `touched`.
 */
function declaresDepOutside(
  context: {
    root: { name: string; dependencies?: Project["dependencies"] };
    workspaces: Array<{ name: string; project: { dependencies?: Project["dependencies"] } }>;
  },
  name: string,
  touched: Set<string>,
): boolean {
  if (context.workspaces.length === 0) {
    if (touched.has(context.root.name)) return false;
    return name in (context.root.dependencies ?? {});
  }
  for (const ws of context.workspaces) {
    if (touched.has(ws.name)) continue;
    if (name in (ws.project.dependencies ?? {})) return true;
  }
  return false;
}

/**
 * Locate the cached jar for a lockfile entry. Cache layout mirrors each
 * resolver (`<cache>/dependencies/<kind>/…`) — see `src/resolver/*.ts`.
 * `workspace:` deps aren't cached (they're built locally), so they return
 * undefined and skip jar-deletion.
 */
function cachedJarPathFor(entry: LockfileEntry): string | undefined {
  const base = join(getCachePath(), "dependencies");
  const src = entry.source;
  switch (src.kind) {
    case "modrinth":
      return join(base, "modrinth", src.slug, `${entry.resolvedVersion}.jar`);
    case "maven":
      return join(base, "maven", src.groupId, src.artifactId, `${entry.resolvedVersion}.jar`);
    case "file": {
      // file-kind resolver names the cached copy by the bytes' sha256 hex.
      // The lockfile integrity is `"sha256-<hex>"` — strip the prefix.
      const hex = entry.integrity.startsWith("sha256-")
        ? entry.integrity.slice("sha256-".length)
        : entry.integrity;
      return join(base, "file", `${hex}.jar`);
    }
    case "workspace":
      return undefined;
  }
}

function emitRemoveResult(opts: RemoveOptions, result: RemoveResult): void {
  if (opts.json === true) {
    process.stdout.write(
      `${JSON.stringify(
        {
          status: "success",
          removed: result.removed,
          lockEntryRemoved: result.lockEntryRemoved,
          fileRemoved: result.fileRemoved,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  if (result.removed.length === 0) {
    console.log(`"${opts.plugin}" was not declared in the targeted workspaces; nothing to do.`);
    return;
  }
  console.log(
    `Removed "${opts.plugin}" from ${result.removed.join(", ")}${
      result.lockEntryRemoved ? " (and pluggy.lock)" : ""
    }.`,
  );
}

export function removeCommand(): Command {
  return new Command("remove")
    .alias("rm")
    .description("Remove a plugin from the project config and optionally delete its jar.")
    .argument("<plugin>", "Plugin identifier.")
    .option("--keep-file", "Leave the local/cached jar on disk.")
    .option("--workspace <name>", "Target a specific workspace.")
    .option("--workspaces", "Remove from every workspace that declares it.")
    .action(async function action(this: Command, plugin: string, options) {
      const globalOpts = this.optsWithGlobals();
      await doRemove({
        plugin,
        keepFile: options.keepFile,
        workspace: options.workspace,
        workspaces: options.workspaces,
        json: globalOpts.json,
        project: globalOpts.project,
      });
    });
}
