/**
 * `pluggy.lock` read / write / verify.
 *
 * The lockfile lives at the repo root and is shared across all workspaces.
 * See docs/SPEC.md §3.5.
 */

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

/** Read `<rootDir>/pluggy.lock`. Returns null if the file does not exist. */
export function readLock(_rootDir: string): Lockfile | null {
  throw new Error("not implemented: readLock");
}

/** Write `<rootDir>/pluggy.lock` atomically. */
export function writeLock(_rootDir: string, _lock: Lockfile): Promise<void> {
  throw new Error("not implemented: writeLock");
}

/**
 * Verify that every dependency declared in the given project (across all
 * workspaces) has a matching entry in the lockfile. Returns the list of
 * declarations that are missing or stale; empty means the lockfile is fresh.
 */
export function verifyLock(
  _lock: Lockfile,
  _declared: Record<string, { source: ResolvedSource }>,
): string[] {
  throw new Error("not implemented: verifyLock");
}
