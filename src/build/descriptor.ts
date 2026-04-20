import type { DescriptorSpec } from "../platform/platform.ts";
import type { ResolvedProject } from "../project.ts";

/**
 * Pick the descriptor spec for the project's primary platform, verifying
 * that all declared platforms share the same descriptor family. Rejects
 * cross-family compatibility arrays (see docs/SPEC.md §5.2).
 */
export function pickDescriptor(_project: ResolvedProject): DescriptorSpec {
  throw new Error("not implemented: pickDescriptor");
}
