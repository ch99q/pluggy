import { Command } from "commander";

import { parseInteger, parsePlatform, parseSemver } from "./parsers.ts";

export function devCommand(): Command {
  return new Command("dev")
    .description("Start a development server for the project.")
    .option("--workspace <name>", "Required when run at a root with workspaces.")
    .option("--platform <name>", "Override the primary platform.", parsePlatform)
    .option("--version <ver>", "Override the primary MC version.", parseSemver)
    .option("--port <n>", "Server listen port.", parseInteger)
    .option("--memory <x>", "JVM heap size (e.g. 2G, 512M).")
    .option("--clean", "Wipe dev/ before starting.")
    .option("--fresh-world", "Keep dev/ but delete dev/world*.")
    .option("--no-watch", "Run once, don't watch or rebuild.")
    .option("--reload", "Use /reload instead of full restart on change.")
    .option("--offline", "Set online-mode=false in server.properties.")
    .action(() => {
      throw new Error("not implemented: dev");
    });
}
