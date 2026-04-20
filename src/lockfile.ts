/**
 * `pluggy.lock` read / write / verify. The lockfile lives at the repo root
 * and is shared across workspaces. See docs/SPEC.md §3.5.
 */

import { readFileSync } from "node:fs";
import { rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { stringifySource } from "./source.ts";
import type { ResolvedSource } from "./source.ts";

export interface LockfileEntry {
  source: ResolvedSource;
  /** Concrete version resolved by `install` (never a range). */
  resolvedVersion: string;
  /** SHA-256 of the resolved jar, as `"sha256-<base64>"`. */
  integrity: string;
  /** Workspace names that declared this dependency. */
  declaredBy: string[];
}

export interface Lockfile {
  version: 1;
  entries: Record<string, LockfileEntry>;
}

const LOCKFILE_NAME = "pluggy.lock";

/**
 * Read `<rootDir>/pluggy.lock`. Returns `null` if missing. Throws on parse
 * or schema errors; messages always include the offending path (and entry
 * key, where applicable).
 */
export function readLock(rootDir: string): Lockfile | null {
  const path = join(rootDir, LOCKFILE_NAME);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return null;
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = (err as Error).message;
    throw new Error(`Failed to parse lockfile at ${path}: ${msg}`);
  }

  return validateLockfile(parsed, path);
}

/**
 * Write `<rootDir>/pluggy.lock` atomically: same-dir temp file then `rename`
 * over the target. Entries are sorted by key so diffs stay deterministic.
 * Output is 2-space-indented JSON with a trailing LF.
 */
export async function writeLock(rootDir: string, lock: Lockfile): Promise<void> {
  const path = join(rootDir, LOCKFILE_NAME);

  const sortedEntries: Record<string, LockfileEntry> = {};
  for (const key of Object.keys(lock.entries).sort()) {
    sortedEntries[key] = lock.entries[key];
  }

  const serialized = `${JSON.stringify({ version: lock.version, entries: sortedEntries }, null, 2)}\n`;

  // Same-dir temp guarantees rename is same-filesystem; pid+random avoids collisions.
  const tempName = `${LOCKFILE_NAME}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  const tempPath = join(rootDir, tempName);

  try {
    await writeFile(tempPath, serialized, "utf8");
    await rename(tempPath, path);
  } catch (err) {
    try {
      await unlink(tempPath);
    } catch {
      // Temp may not exist (writeFile itself failed).
    }
    throw err;
  }
}

/**
 * Return dependency names that are missing from the lock or stale against
 * what's declared. Empty means the lockfile is fresh.
 *
 * "Stale" = lockfile entry exists but its source string or version diverges
 * from the declaration. Orphaned entries (locked but not declared) are
 * ignored. Does not refetch or recompute integrity — the resolver does that.
 */
export function verifyLock(
  lock: Lockfile,
  declared: Record<string, { source: ResolvedSource }>,
): string[] {
  const drift: string[] = [];
  for (const name of Object.keys(declared)) {
    const declaredSource = declared[name].source;
    const entry = lock.entries[name];
    if (entry === undefined) {
      drift.push(name);
      continue;
    }
    if (
      stringifySource(entry.source) !== stringifySource(declaredSource) ||
      entry.source.version !== declaredSource.version
    ) {
      drift.push(name);
    }
  }
  return drift;
}

function validateLockfile(parsed: unknown, path: string): Lockfile {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid lockfile at ${path}: expected a JSON object`);
  }
  const obj = parsed as Record<string, unknown>;

  if (obj.version !== 1) {
    throw new Error(
      `Unsupported lockfile version: ${String(obj.version)} (at ${path}; expected 1)`,
    );
  }

  if (obj.entries === null || typeof obj.entries !== "object" || Array.isArray(obj.entries)) {
    throw new Error(`Invalid lockfile at ${path}: "entries" must be an object`);
  }
  const rawEntries = obj.entries as Record<string, unknown>;

  const entries: Record<string, LockfileEntry> = {};
  for (const key of Object.keys(rawEntries)) {
    entries[key] = validateEntry(rawEntries[key], key, path);
  }

  return { version: 1, entries };
}

function validateEntry(raw: unknown, key: string, path: string): LockfileEntry {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Invalid lockfile entry "${key}" at ${path}: expected an object`);
  }
  const entry = raw as Record<string, unknown>;

  if (entry.source === undefined) {
    throw new Error(`Invalid lockfile entry "${key}" at ${path}: missing "source"`);
  }
  if (typeof entry.resolvedVersion !== "string") {
    throw new Error(
      `Invalid lockfile entry "${key}" at ${path}: "resolvedVersion" must be a string`,
    );
  }
  if (typeof entry.integrity !== "string") {
    throw new Error(`Invalid lockfile entry "${key}" at ${path}: "integrity" must be a string`);
  }
  if (!Array.isArray(entry.declaredBy) || !entry.declaredBy.every((d) => typeof d === "string")) {
    throw new Error(
      `Invalid lockfile entry "${key}" at ${path}: "declaredBy" must be an array of strings`,
    );
  }

  const source = validateResolvedSource(entry.source, key, path);

  return {
    source,
    resolvedVersion: entry.resolvedVersion,
    integrity: entry.integrity,
    declaredBy: entry.declaredBy as string[],
  };
}

/**
 * Validate an arbitrary `unknown` against the `ResolvedSource` tagged union.
 * Centralized so the on-disk form stays in lock-step with `src/source.ts`.
 */
function validateResolvedSource(raw: unknown, key: string, path: string): ResolvedSource {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Invalid lockfile entry "${key}" at ${path}: "source" must be an object`);
  }
  const src = raw as Record<string, unknown>;
  if (typeof src.version !== "string" || src.version.length === 0) {
    throw new Error(
      `Invalid lockfile entry "${key}" at ${path}: "source.version" must be a non-empty string`,
    );
  }

  switch (src.kind) {
    case "modrinth": {
      if (typeof src.slug !== "string" || src.slug.length === 0) {
        throw new Error(
          `Invalid lockfile entry "${key}" at ${path}: modrinth source requires a non-empty "slug"`,
        );
      }
      return { kind: "modrinth", slug: src.slug, version: src.version };
    }
    case "maven": {
      if (typeof src.groupId !== "string" || src.groupId.length === 0) {
        throw new Error(
          `Invalid lockfile entry "${key}" at ${path}: maven source requires a non-empty "groupId"`,
        );
      }
      if (typeof src.artifactId !== "string" || src.artifactId.length === 0) {
        throw new Error(
          `Invalid lockfile entry "${key}" at ${path}: maven source requires a non-empty "artifactId"`,
        );
      }
      return {
        kind: "maven",
        groupId: src.groupId,
        artifactId: src.artifactId,
        version: src.version,
      };
    }
    case "file": {
      if (typeof src.path !== "string" || src.path.length === 0) {
        throw new Error(
          `Invalid lockfile entry "${key}" at ${path}: file source requires a non-empty "path"`,
        );
      }
      return { kind: "file", path: src.path, version: src.version };
    }
    case "workspace": {
      if (typeof src.name !== "string" || src.name.length === 0) {
        throw new Error(
          `Invalid lockfile entry "${key}" at ${path}: workspace source requires a non-empty "name"`,
        );
      }
      return { kind: "workspace", name: src.name, version: src.version };
    }
    default:
      throw new Error(
        `Invalid lockfile entry "${key}" at ${path}: unknown source kind "${String(src.kind)}" (expected "modrinth", "maven", "file", or "workspace")`,
      );
  }
}
