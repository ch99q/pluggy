import { Command } from "commander";

export function listCommand(): Command {
  return new Command("list")
    .alias("ls")
    .description("List all installed plugins, dependencies and registries.")
    .option("--tree", "Render as dependency tree (with transitive deps).")
    .option("--outdated", "Only list deps with newer versions available.")
    .option("--workspace <name>", "Show a specific workspace.")
    .option("--workspaces", "Aggregated view across all workspaces.")
    .action(() => {
      throw new Error("not implemented: list");
    });
}
