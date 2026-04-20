/**
 * Dependency resolver — takes a ResolvedSource, produces a ResolvedDependency
 * (with a cache path and integrity hash). Dispatches to per-kind resolvers.
 *
 * See docs/SPEC.md §2.4 (install pipeline).
 */

import type { ResolvedSource } from "../source.ts";

export interface ResolvedDependency {
  source: ResolvedSource;
  /** Absolute path to the resolved jar in the user cache. */
  jarPath: string;
  /** SHA-256 of the jar as `"sha256-<base64>"`. */
  integrity: string;
  /** Transitive dependencies declared by this jar. */
  transitiveDeps: ResolvedDependency[];
}

export interface ResolveContext {
  /** Repo root (where pluggy.lock lives). */
  rootDir: string;
  /** Include pre-release versions when resolving from registries. */
  includePrerelease: boolean;
  /** Bypass compatibility checks. */
  force: boolean;
}

export function resolveDependency(
  _source: ResolvedSource,
  _ctx: ResolveContext,
): Promise<ResolvedDependency> {
  throw new Error("not implemented: resolveDependency");
}
