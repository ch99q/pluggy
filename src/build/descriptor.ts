import { getPlatform } from "../platform/mod.ts";
import type { DescriptorSpec } from "../platform/platform.ts";
import type { ResolvedProject } from "../project.ts";

/**
 * Pick the descriptor spec for the project's primary platform, verifying
 * that all declared platforms share the same descriptor family. Rejects
 * cross-family compatibility arrays (see docs/SPEC.md §5.2).
 *
 * Two platforms are "in the same family" iff their `descriptor.path` matches
 * (`plugin.yml`, `bungee.yml`, `velocity-plugin.json`). A declared
 * `compatibility.platforms` array spanning families is a user error and must
 * be split into separate workspaces — this function throws with that guidance.
 */
export function pickDescriptor(project: ResolvedProject): DescriptorSpec {
  const platforms = project.compatibility?.platforms;
  if (!Array.isArray(platforms) || platforms.length === 0) {
    throw new Error(
      `build: project "${project.name}" has no compatibility.platforms declared — at least one platform is required`,
    );
  }

  const primaryId = platforms[0];
  let primary;
  try {
    primary = getPlatform(primaryId);
  } catch {
    throw new Error(
      `build: project "${project.name}" declares unknown primary platform "${primaryId}"`,
    );
  }

  // Peek each additional platform to verify descriptor family match.
  for (let i = 1; i < platforms.length; i++) {
    const id = platforms[i];
    let other;
    try {
      other = getPlatform(id);
    } catch {
      throw new Error(
        `build: project "${project.name}" declares unknown platform "${id}" in compatibility.platforms`,
      );
    }
    if (other.descriptor.path !== primary.descriptor.path) {
      throw new Error(
        `build: project "${project.name}" declares platforms from different descriptor families ` +
          `("${primaryId}" uses "${primary.descriptor.path}", "${id}" uses "${other.descriptor.path}"). ` +
          `Split them into separate workspaces — one per family (see docs/SPEC.md §5.2).`,
      );
    }
  }

  return primary.descriptor;
}
