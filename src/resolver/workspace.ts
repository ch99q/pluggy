import type { ResolvedDependency, ResolveContext } from "./index.ts";

export function resolveWorkspace(
  _name: string,
  _version: string,
  _ctx: ResolveContext,
): Promise<ResolvedDependency> {
  throw new Error("not implemented: resolveWorkspace");
}
