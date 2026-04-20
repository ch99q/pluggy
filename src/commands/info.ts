import { Command } from "commander";

import { parseVersion } from "./parsers.ts";

export function infoCommand(): Command {
  return new Command("info")
    .alias("show")
    .description("Show information about a plugin, including available versions and compatibility.")
    .argument("<plugin>", "Plugin identifier.", parseVersion)
    .action(() => {
      throw new Error("not implemented: info");
    });
}
