import { Command } from "commander";

export function buildCommand(): Command {
  return new Command("build")
    .alias("b")
    .description("Build the project and output a plugin jar.")
    .option("--output <path>", "Output jar path.")
    .option("--clean", "Wipe build cache before building.")
    .option("--skip-classpath", "Don't regenerate .classpath.")
    .option("--workspace <name>", "Build a single workspace.")
    .option("--workspaces", "Explicit all-workspaces build.")
    .action(() => {
      throw new Error("not implemented: build");
    });
}
