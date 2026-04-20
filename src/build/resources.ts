import type { ResolvedProject } from "../project.ts";

/**
 * Copy `project.resources` into the staging directory, applying template
 * substitution where the extension is on the allowlist (see docs/SPEC.md §1.7).
 */
export function stageResources(_project: ResolvedProject, _stagingDir: string): Promise<void> {
  throw new Error("not implemented: stageResources");
}
