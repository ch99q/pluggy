import { Command } from "commander";

import { parseInteger, parsePlatform, parseSemver } from "./parsers.ts";

export function searchCommand(): Command {
  return new Command("search")
    .description("Search Modrinth for plugins by keyword.")
    .argument("<query>", "Search query.")
    .option("--size <size>", "Page size (default: 10).", parseInteger, 10)
    .option("--page <page>", "Page number (default: 0).", parseInteger, 0)
    .option("--platform <name>", "Filter by platform.", parsePlatform)
    .option("--version <semver>", "Filter by Minecraft version.", parseSemver)
    .option("--beta", "Include pre-releases.")
    .action(() => {
      throw new Error("not implemented: search");
    });
}
