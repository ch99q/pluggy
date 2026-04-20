import type { ResolvedDependency, ResolveContext } from "./index.ts";

export function resolveModrinth(
  _slug: string,
  _version: string,
  _ctx: ResolveContext,
): Promise<ResolvedDependency> {
  throw new Error("not implemented: resolveModrinth");
}
