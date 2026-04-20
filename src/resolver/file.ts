import type { ResolvedDependency, ResolveContext } from "./index.ts";

export function resolveFile(
  _path: string,
  _version: string,
  _ctx: ResolveContext,
): Promise<ResolvedDependency> {
  throw new Error("not implemented: resolveFile");
}
