import type { ResolvedDependency } from "../resolver/index.ts";
import type { Shading } from "../project.ts";

/**
 * Apply per-dependency `shading` rules (include/exclude globs) and extract
 * the matching classes from each dep jar into the staging directory.
 */
export function applyShading(
  _deps: ResolvedDependency[],
  _rules: Record<string, Shading>,
  _stagingDir: string,
): Promise<void> {
  throw new Error("not implemented: applyShading");
}
