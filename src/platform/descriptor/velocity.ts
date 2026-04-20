import type { DescriptorSpec } from "../platform.ts";

/**
 * Velocity descriptor.
 * Written to `velocity-plugin.json` at the jar root.
 */
export const velocityDescriptor: DescriptorSpec = {
  path: "velocity-plugin.json",
  format: "json",
  generate(_project) {
    throw new Error("not implemented: velocityDescriptor.generate");
  },
};
