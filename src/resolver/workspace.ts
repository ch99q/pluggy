/**
 * Workspace-sibling resolver.
 *
 * Resolves `workspace:<name>` sources by looking up the named sibling in
 * `ctx.workspaceContext` and pointing at where its built jar _would_ live
 * (`<workspace.root>/bin/<name>-<version>.jar`). This resolver does NOT
 * build the sibling — the build pipeline is responsible for producing the
 * jar at that path. Until a build runs, the integrity hash is a sentinel
 * string (`"sha256-pending-build"`) that downstream consumers detect.
 *
 * See docs/SPEC.md §1.8.
 */

import { join } from "node:path";

import { findWorkspace } from "../workspace.ts";
import type { ResolvedSource } from "../source.ts";

import type { ResolveContext, ResolvedDependency } from "./index.ts";

/** Sentinel integrity value returned before the sibling has been built. */
export const PENDING_BUILD_INTEGRITY = "sha256-pending-build";

export function resolveWorkspace(
  name: string,
  version: string,
  ctx: ResolveContext,
): Promise<ResolvedDependency> {
  if (ctx.workspaceContext === undefined) {
    return Promise.reject(
      new Error(
        `workspace sources require a WorkspaceContext (workspace "${name}" cannot be resolved without one)`,
      ),
    );
  }

  let ws;
  try {
    ws = findWorkspace(ctx.workspaceContext, name);
  } catch (err) {
    return Promise.reject(err as Error);
  }

  const declaredVersion = ws.project.version ?? version;
  const jarPath = join(ws.root, "bin", `${ws.name}-${declaredVersion}.jar`);

  const source: ResolvedSource = {
    kind: "workspace",
    name,
    version: declaredVersion,
  };

  return Promise.resolve({
    source,
    jarPath,
    integrity: PENDING_BUILD_INTEGRITY,
    transitiveDeps: [],
  });
}
