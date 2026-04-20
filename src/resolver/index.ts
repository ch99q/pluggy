/**
 * Dependency resolver — takes a ResolvedSource, produces a ResolvedDependency
 * (with a cache path and integrity hash). Dispatches to per-kind resolvers.
 *
 * See docs/SPEC.md §2.4 (install pipeline) and §3.4 (cache layout).
 */

import type { ResolvedSource } from "../source.ts";
import type { WorkspaceContext } from "../workspace.ts";

import { resolveFile } from "./file.ts";
import { resolveMaven } from "./maven.ts";
import { resolveModrinth } from "./modrinth.ts";
import { resolveWorkspace } from "./workspace.ts";

export interface ResolvedDependency {
  source: ResolvedSource;
  /** Absolute path to the resolved jar in the user cache. */
  jarPath: string;
  /** SHA-256 of the jar as `"sha256-<hex>"`. */
  integrity: string;
  /** Transitive dependencies declared by this jar. */
  transitiveDeps: ResolvedDependency[];
}

export interface ResolveContext {
  /** Repo root (where pluggy.lock lives). Base for `file:` path resolution. */
  rootDir: string;
  /** Include pre-release versions when resolving from registries. */
  includePrerelease: boolean;
  /** Bypass compatibility checks. */
  force: boolean;
  /**
   * Maven registries to try, in order. Required for `maven:` sources;
   * ignored for other source kinds. Empty array means no registries configured.
   */
  registries: string[];
  /**
   * Workspace context. Required for `workspace:` sources. When a
   * `workspace:` source is resolved without this set, the resolver throws.
   */
  workspaceContext?: WorkspaceContext;
}

/**
 * Dispatch a ResolvedSource to the appropriate per-kind resolver.
 * Straight pass-through: no retries, no fallbacks.
 */
export function resolveDependency(
  source: ResolvedSource,
  ctx: ResolveContext,
): Promise<ResolvedDependency> {
  switch (source.kind) {
    case "modrinth":
      return resolveModrinth(source.slug, source.version, ctx);
    case "maven":
      return resolveMaven(source.groupId, source.artifactId, source.version, ctx);
    case "file":
      return resolveFile(source.path, source.version, ctx);
    case "workspace":
      return resolveWorkspace(source.name, source.version, ctx);
  }
}
