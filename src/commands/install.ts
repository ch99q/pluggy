import { Command } from "commander";

import { parseVersion } from "./parsers.ts";

export function installCommand(): Command {
  return new Command("install")
    .alias("i")
    .description("Install project dependencies or a specific plugin.")
    .argument(
      "[plugin]",
      "Plugin identifier. Modrinth slug, local .jar, or maven: coordinate.",
      parseVersion,
    )
    .option("--force", "Force dependency install (override compatibility checks).")
    .option("--beta", "Include pre-release versions during Modrinth resolution.")
    .option("--workspace <name>", "Target a specific workspace.")
    .option("--workspaces", "Run across all workspaces explicitly.")
    .addHelpText(
      "after",
      `\nExamples:\n  $ pluggy install\n  $ pluggy install EssentialsX@2.21.1\n  $ pluggy install ./libs/essentialsx-2.21.1.jar\n  $ pluggy install maven:com.example:my-plugin@1.0.0`,
    )
    .action(() => {
      throw new Error("not implemented: install");
    });
}
