/**
 * Workspace discovery, inheritance, and graph operations.
 *
 * See docs/SPEC.md §1.8 for the workspace model.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import type { Project, Registry, ResolvedProject } from "./project.ts";

const PROJECT_FILE_NAME = "project.json";

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
export function resolveWorkspaceContext(cwd: string): WorkspaceContext | undefined {
  const startDir = resolve(cwd);
  const nearest = findNearestProject(startDir);
  if (nearest === undefined) return undefined;

  // Case 1: the nearest project is itself a root that declares workspaces.
  if (Array.isArray(nearest.workspaces) && nearest.workspaces.length > 0) {
    const workspaces = enumerateWorkspaces(nearest);
    const current = findCurrentWorkspace(workspaces, startDir);
    return {
      root: nearest,
      atRoot: current === undefined,
      current,
      workspaces,
    };
  }

  // Case 2: nearest project does not declare workspaces. Check if it's listed
  // as a workspace inside a parent project.
  const parentDir = dirname(nearest.rootDir);
  const parentProject = parentDir !== nearest.rootDir ? findNearestProject(parentDir) : undefined;

  if (
    parentProject !== undefined &&
    Array.isArray(parentProject.workspaces) &&
    parentProject.workspaces.some(
      (p) => resolveWorkspacePath(parentProject.rootDir, p) === nearest.rootDir,
    )
  ) {
    const workspaces = enumerateWorkspaces(parentProject);
    const current =
      findCurrentWorkspace(workspaces, startDir) ??
      workspaces.find((w) => w.root === nearest.rootDir);
    return {
      root: parentProject,
      atRoot: false,
      current,
      workspaces,
    };
  }

  // Case 3: standalone project.
  return {
    root: nearest,
    atRoot: true,
    current: undefined,
    workspaces: [],
  };
}

/**
 * Topologically sort workspaces by their `workspace:` inter-dependencies.
 * Throws on cycles.
 */
export function topologicalOrder(workspaces: WorkspaceNode[]): WorkspaceNode[] {
  const byName = new Map<string, WorkspaceNode>();
  for (const ws of workspaces) {
    byName.set(ws.name, ws);
  }

  const result: WorkspaceNode[] = [];
  const state = new Map<string, "visiting" | "done">();

  const visit = (node: WorkspaceNode, stack: string[]): void => {
    const current = state.get(node.name);
    if (current === "done") return;
    if (current === "visiting") {
      const cycle = [...stack.slice(stack.indexOf(node.name)), node.name].join(" -> ");
      throw new Error(`workspace dependency cycle detected: ${cycle}`);
    }

    state.set(node.name, "visiting");
    const deps = workspaceDependencyNames(node);
    for (const depName of deps) {
      const dep = byName.get(depName);
      if (dep === undefined) {
        // Unknown workspace dep — skip; resolver is responsible for reporting.
        continue;
      }
      visit(dep, [...stack, node.name]);
    }
    state.set(node.name, "done");
    result.push(node);
  };

  for (const ws of workspaces) {
    visit(ws, []);
  }
  return result;
}

/**
 * Look up a workspace by name within a context. Throws if not found.
 */
export function findWorkspace(context: WorkspaceContext, name: string): WorkspaceNode {
  const hit = context.workspaces.find((w) => w.name === name);
  if (hit !== undefined) return hit;
  const known = context.workspaces.map((w) => w.name);
  const list = known.length > 0 ? known.join(", ") : "(none)";
  throw new Error(`workspace not found: "${name}". known workspaces: ${list}`);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function findNearestProject(start: string): ResolvedProject | undefined {
  let current = start;
  while (true) {
    const candidate = join(current, PROJECT_FILE_NAME);
    if (existsSync(candidate)) {
      return readProjectFile(candidate);
    }
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function readProjectFile(projectFile: string): ResolvedProject {
  const raw = readFileSync(projectFile, "utf8");
  const parsed = JSON.parse(raw) as Project;
  return {
    ...parsed,
    rootDir: dirname(projectFile),
    projectFile,
  };
}

function resolveWorkspacePath(rootDir: string, rel: string): string {
  // Normalize backslashes to forward slashes so both platforms resolve alike.
  const normalized = rel.replace(/\\/g, "/");
  if (isAbsolute(normalized)) return resolve(normalized);
  return resolve(rootDir, normalized);
}

function enumerateWorkspaces(root: ResolvedProject): WorkspaceNode[] {
  const declared = root.workspaces ?? [];
  const nodes: WorkspaceNode[] = [];
  for (const rel of declared) {
    const wsDir = resolveWorkspacePath(root.rootDir, rel);
    const projectFile = join(wsDir, PROJECT_FILE_NAME);
    if (!existsSync(projectFile)) {
      throw new Error(
        `workspace declared in ${root.projectFile} is missing project.json: ${wsDir}`,
      );
    }
    const raw = readFileSync(projectFile, "utf8");
    const own = JSON.parse(raw) as Project;
    const merged = mergeInheritance(root, own);
    const resolved: ResolvedProject = {
      ...merged,
      rootDir: wsDir,
      projectFile,
    };
    nodes.push({ name: resolved.name, root: wsDir, project: resolved });
  }
  return nodes;
}

function mergeInheritance(root: ResolvedProject, own: Project): Project {
  // Start with the workspace's own fields. Apply inheritance only for the
  // fields §1.8 says are inherited.
  const merged: Project = { ...own };

  // compatibility: deep replace (workspace wins when declared).
  if (own.compatibility === undefined || own.compatibility === null) {
    merged.compatibility = root.compatibility;
  }

  // authors, description: inherited unless overridden.
  if (own.authors === undefined) {
    merged.authors = root.authors;
  }
  if (own.description === undefined) {
    merged.description = root.description;
  }

  // registries: merged (root + workspace), de-duplicated by URL.
  merged.registries = mergeRegistries(root.registries, own.registries);

  // version: NOT inherited — keep workspace's (or undefined if absent).
  // name, main, dependencies, shading, resources: workspace-only — keep own.
  // workspaces: workspace-only (a workspace cannot itself declare nested
  // workspaces); we leave it as whatever the workspace's project had.

  return merged;
}

function mergeRegistries(
  rootRegs: (string | Registry)[] | undefined,
  wsRegs: (string | Registry)[] | undefined,
): (string | Registry)[] | undefined {
  if (rootRegs === undefined && wsRegs === undefined) return undefined;
  const out: (string | Registry)[] = [];
  const seen = new Set<string>();
  const push = (entry: string | Registry): void => {
    const url = typeof entry === "string" ? entry : entry.url;
    if (seen.has(url)) return;
    seen.add(url);
    out.push(entry);
  };
  for (const entry of rootRegs ?? []) push(entry);
  for (const entry of wsRegs ?? []) push(entry);
  return out;
}

function findCurrentWorkspace(workspaces: WorkspaceNode[], cwd: string): WorkspaceNode | undefined {
  // Pick the workspace whose root directory is a prefix of cwd; if multiple
  // match (nested), prefer the longest prefix.
  let best: WorkspaceNode | undefined;
  for (const ws of workspaces) {
    if (cwd === ws.root || cwd.startsWith(ws.root + "/") || cwd.startsWith(ws.root + "\\")) {
      if (best === undefined || ws.root.length > best.root.length) {
        best = ws;
      }
    }
  }
  return best;
}

function workspaceDependencyNames(node: WorkspaceNode): string[] {
  const deps = node.project.dependencies;
  if (deps === undefined) return [];
  const names: string[] = [];
  for (const value of Object.values(deps)) {
    // Short-form strings are sugar for a Modrinth version — not a source
    // string — so they can never reference a workspace. Only long-form
    // objects with an explicit `workspace:<name>` source count.
    if (typeof value === "string") continue;
    const source = value.source;
    if (source.startsWith("workspace:")) {
      const name = source.slice("workspace:".length);
      if (name.length > 0) names.push(name);
    }
  }
  return names;
}
