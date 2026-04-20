import type { DescriptorSpec } from "../platform.ts";

/**
 * Velocity descriptor.
 * Written to `velocity-plugin.json` at the jar root.
 */
export const velocityDescriptor: DescriptorSpec = {
  path: "velocity-plugin.json",
  format: "json",
  generate(project) {
    if (!project.main) {
      throw new Error("Velocity descriptor requires project.main");
    }

    const descriptor: Record<string, unknown> = {
      id: deriveVelocityId(project.name),
      name: project.name,
      version: project.version,
      main: project.main,
    };

    if (project.description && project.description.length > 0) {
      descriptor.description = project.description;
    }

    if (project.authors && project.authors.length > 0) {
      descriptor.authors = project.authors;
    }

    // 2-space-indented JSON with trailing LF, to match the project's LF
    // line-ending convention for generated build outputs.
    return `${JSON.stringify(descriptor, null, 2)}\n`;
  },
};

/**
 * Derive a Velocity plugin `id` from `project.name`.
 *
 * Velocity requires `id` to match `[a-z][a-z0-9-_]*` (lowercase letter/digit,
 * hyphen, underscore, starting with a letter). The `project.name` field is
 * already validated `^[a-zA-Z0-9_]+$` per SPEC §1.2, so the derivation is
 * conservative:
 *
 *   1. Lowercase.
 *   2. Replace any character outside `[a-z0-9_-]` with `-`.
 *   3. If the result doesn't start with a lowercase letter, prepend `p-` so the
 *      output is always a valid Velocity id.
 *
 * The extra (2) covers future-proofing in case `name` ever accepts a wider set
 * (the SPEC validator is a project-level concern and could loosen).
 */
export function deriveVelocityId(name: string): string {
  const lowered = name.toLowerCase();
  const normalized = lowered.replace(/[^a-z0-9_-]/g, "-");
  if (!/^[a-z]/.test(normalized)) {
    return `p-${normalized}`;
  }
  return normalized;
}
