import type { ResolvedDependency, ResolveContext } from "./index.ts";

export function resolveMaven(
  _groupId: string,
  _artifactId: string,
  _version: string,
  _ctx: ResolveContext,
): Promise<ResolvedDependency> {
  throw new Error("not implemented: resolveMaven");
}
