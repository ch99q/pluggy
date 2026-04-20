import { Command } from "commander";

export function removeCommand(): Command {
  return new Command("remove")
    .alias("rm")
    .description("Remove a plugin from the project config and optionally delete its jar.")
    .argument("<plugin>", "Plugin identifier.")
    .option("--keep-file", "Leave the local/cached jar on disk.")
    .option("--workspace <name>", "Target a specific workspace.")
    .option("--workspaces", "Remove from every workspace that declares it.")
    .action(() => {
      throw new Error("not implemented: remove");
    });
}
