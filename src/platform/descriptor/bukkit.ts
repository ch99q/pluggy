import type { DescriptorSpec } from "../platform.ts";

/**
 * Bukkit-family descriptor (paper, folia, spigot, bukkit).
 * Written to `plugin.yml` at the jar root.
 */
export const bukkitDescriptor: DescriptorSpec = {
  path: "plugin.yml",
  format: "yaml",
  generate(_project) {
    throw new Error("not implemented: bukkitDescriptor.generate");
  },
};
