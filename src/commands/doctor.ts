import { Command } from "commander";

export function doctorCommand(): Command {
  return new Command("doctor")
    .description("Check your environment and project for common issues.")
    .action(() => {
      throw new Error("not implemented: doctor");
    });
}
