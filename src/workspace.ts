/**
 * Workspace discovery, inheritance, and graph operations.
 *
 * See docs/SPEC.md §1.8 for the workspace model.
 */

import type { ResolvedProject } from "./project.ts";

export interface WorkspaceNode {
  /** The `name` field from the workspace's `project.json`. */
  name: string;
  /** Absolute path to the workspace's root directory. */
  root: string;
  /** The workspace's merged project config (after inheritance from root). */
  project: ResolvedProject;
}

export interface WorkspaceContext {
  /** The repo-root project (always present when inside any pluggy project). */
  root: ResolvedProject;
  /** True when cwd resolves to the root `project.json` (not inside a workspace). */
  atRoot: boolean;
  /** The workspace cwd is inside, if any. Undefined when `atRoot`. */
  current?: WorkspaceNode;
  /** All declared workspaces, in declaration order. Empty for standalone projects. */
  workspaces: WorkspaceNode[];
}

/**
 * Walk up from `cwd` to find the repo root and determine which workspace
 * (if any) `cwd` belongs to. Merges each workspace's `project.json` with
 * inherited fields from the root per §1.8 inheritance rules.
 *
 * Returns `undefined` if cwd is not inside any pluggy project.
 */
export function resolveWorkspaceContext(_cwd: string): WorkspaceContext | undefined {
  throw new Error("not implemented: resolveWorkspaceContext");
}

/**
 * Topologically sort workspaces by their `workspace:` inter-dependencies.
 * Throws on cycles.
 */
export function topologicalOrder(_workspaces: WorkspaceNode[]): WorkspaceNode[] {
  throw new Error("not implemented: topologicalOrder");
}

/**
 * Look up a workspace by name within a context. Throws if not found.
 */
export function findWorkspace(_context: WorkspaceContext, _name: string): WorkspaceNode {
  throw new Error("not implemented: findWorkspace");
}
