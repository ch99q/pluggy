import type { DescriptorSpec } from "../platform.ts";

/**
 * BungeeCord-family descriptor (waterfall, travertine).
 * Written to `bungee.yml` at the jar root.
 */
export const bungeeDescriptor: DescriptorSpec = {
  path: "bungee.yml",
  format: "yaml",
  generate(_project) {
    throw new Error("not implemented: bungeeDescriptor.generate");
  },
};
