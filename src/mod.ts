#!/usr/bin/env bun
import { readdir } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import process from "node:process";

import { Command, InvalidArgumentError } from "commander";
import { confirm } from "@inquirer/prompts";

import { generateProject } from "./commands/init.ts";
import { bold, red } from "./logging.ts";
import { getPlatform, getRegisteredPlatforms } from "./platform/mod.ts";
import { getCurrentProject, type Project, resolveProjectFile } from "./project.ts";
import { UpgradeCommand } from "./upgrade.ts";

const CLI_VERSION = "0.0.0";

function parseVersion(value: string): string {
  if (/^\d+\.\d+\.\d+?$/.test(value)) return value;
  if (/^.+\.jar$/.test(value)) return value;
  if (/^maven:[\w.-]+:[\w.-]+@.+$/.test(value)) return value;
  throw new InvalidArgumentError(
    `Invalid version format: ${value} - expected semver, file jar, or maven format`,
  );
}

function parseSemver(value: string): string {
  if (/^\d+\.\d+\.\d+(-[a-zA-Z0-9]+)?$/.test(value)) return value;
  throw new InvalidArgumentError(
    `Invalid semver version: ${value} - expected format like 1.0.0 or 1.0.0-alpha`,
  );
}

function parsePlatform(value: string): string {
  const platforms = getRegisteredPlatforms();
  const id = value.toLowerCase();
  if (!platforms.includes(id)) {
    throw new InvalidArgumentError(
      `Invalid platform: "${value}". Available platforms: ${platforms.join(", ")}`,
    );
  }
  return id;
}

function parseInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) throw new InvalidArgumentError(`Invalid integer: ${value}`);
  return parsed;
}

let currentProject = getCurrentProject();

const program = new Command();

program
  .name("pluggy")
  .description("A CLI for developing Minecraft plugins.")
  .version(CLI_VERSION)
  .option("-v, --verbose", "Enable verbose output.")
  .option("-p, --project <path>", "Path to a custom project file.")
  .option("--json", "Output results as JSON.")
  .option("--workspace", "Use the workspace scope for commands.")
  .addHelpText("after", `\nExamples:\n  $ pluggy init --help     Get help for a command`);

program
  .command("init")
  .description(
    "Initialize a new project with interactive prompts.\n\nIf you want to skip prompts and use defaults, use the -y option.\nIt's recommended to use --main <main> to specify the main class name.",
  )
  .argument("[path]", "Target directory for the new project.")
  .option("--name <name>", "Project name.")
  .option("--version <version>", "Project version.", parseSemver)
  .option("--description <description>", "Project description.")
  .option("--main <main>", "Main class name.", "com.example.Main")
  .option("--platform <platform>", "Target platform.", parsePlatform, "paper")
  .option("-y, --yes", "Skip prompts and use defaults.")
  .addHelpText(
    "after",
    `\nExamples:\n  $ pluggy init --platform spigot --version 1.21.8\n  $ pluggy init --platform paper --version 1.21.8`,
  )
  .action(async (path: string | undefined, options) => {
    const globalOpts = program.opts();

    if (globalOpts.project) {
      currentProject = resolveProjectFile(globalOpts.project);
      if (!currentProject) throw new Error(`Project file not found at ${globalOpts.project}`);
    }

    const TARGET_PATH = resolve(process.cwd(), path || ".");

    try {
      const entries = await readdir(TARGET_PATH);
      if (entries.length > 0 && !options.yes) {
        const ok = await confirm({
          message: `The directory "${TARGET_PATH}" is not empty. Do you want to continue and potentially overwrite its contents?`,
          default: false,
        });
        if (!ok) {
          console.log("Aborting project initialization.");
          return;
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }

    if (currentProject && !options.yes) {
      const same = dirname(currentProject.projectFile) === TARGET_PATH;
      const ok = await confirm({
        message: `You are in an existing project at "${relative(process.cwd(), currentProject.projectFile)}". ${
          same ? "Do you want to overwrite it?" : "Do you want to create a new project inside?"
        }`,
        default: false,
      });
      if (!ok) {
        console.log("Aborting project initialization.");
        return;
      }
    }

    const platform = options.platform || "paper";

    const latestVersion = await getPlatform(platform).getLatestVersion();

    const INITIAL_PROJECT: Project = {
      name: options.name || basename(TARGET_PATH),
      version: options.version || "1.0.0",
      description: options.description || "A simple Minecraft plugin",
      main: options.main || "com.example.Main",
      compability: {
        versions: [latestVersion.version],
        platforms: [platform],
      },
    };

    if (!/^[a-zA-Z0-9_]+$/.test(INITIAL_PROJECT.name)) {
      throw new InvalidArgumentError(
        `Invalid project name: "${INITIAL_PROJECT.name}". Only alphanumeric characters and underscores are allowed.`,
      );
    }

    if (!/^[a-zA-Z0-9_.]+$/.test(INITIAL_PROJECT.main) || !INITIAL_PROJECT.main.includes(".")) {
      throw new InvalidArgumentError(
        `Invalid main class: "${INITIAL_PROJECT.main}". It must be a valid Java classpath (e.g., com.example.Main).`,
      );
    }

    await generateProject(TARGET_PATH, INITIAL_PROJECT);

    if (globalOpts.json) {
      console.log(
        JSON.stringify({ status: "success", project: INITIAL_PROJECT, dir: TARGET_PATH }, null, 2),
      );
      return;
    }

    console.log(`Project "${INITIAL_PROJECT.name}" initialized successfully at ${TARGET_PATH}`);
  });

program
  .command("install")
  .alias("i")
  .description("Install project dependencies or a specific plugin.")
  .argument(
    "[plugin]",
    "Plugin identifier. Can be a Modrinth slug, local .jar, or maven: coordinate.",
    parseVersion,
  )
  .option("--force", "Force dependency install (override compatibility checks).")
  .addHelpText(
    "after",
    `\nExamples:\n  $ pluggy install\n  $ pluggy install EssentialsX@2.21.1\n  $ pluggy install ./libs/essentialsx-2.21.1.jar\n  $ pluggy install maven:com.example:my-plugin@1.0.0`,
  )
  .action(() => {
    /* TODO */
  });

program
  .command("remove")
  .alias("rm")
  .description("Remove a plugin from the project config and optionally delete its jar.")
  .argument("<plugin>", "Plugin identifier.")
  .action(() => {
    /* TODO */
  });

program
  .command("info")
  .alias("show")
  .description("Show information about a plugin, including available versions and compatibility.")
  .argument("<plugin>", "Plugin identifier.", parseVersion)
  .action(() => {
    /* TODO */
  });

program
  .command("search")
  .description("Search Modrinth for plugins by keyword.")
  .argument("<query>", "Search query.")
  .option("--size <size>", "Page size (default: 10).", parseInteger, 10)
  .option("--page <page>", "Page number (default: 0).", parseInteger, 0)
  .action(() => {
    /* TODO */
  });

program
  .command("list")
  .alias("ls")
  .description("List all installed plugins, dependencies and registries.")
  .action(() => {
    /* TODO */
  });

program
  .command("build")
  .alias("b")
  .description("Build the project and output a plugin jar.")
  .action(async () => {
    if (!currentProject) {
      console.error("No project found.");
      return;
    }

    let provider = currentProject.compability?.platforms?.[0];
    if (!provider) {
      console.log("Unable to determine project platform. Defaulting to 'paper'.");
      provider = "paper";
    }

    const platform = getPlatform(provider);
    console.log(platform);
  });

program
  .command("doctor")
  .description("Check your environment and project for common issues.")
  .action(() => {
    /* TODO */
  });

program
  .command("dev")
  .description("Start a development server for the project.")
  .action(() => {
    /* TODO */
  });

program.addCommand(UpgradeCommand({ repository: "ch99q/pluggy" }));

program.exitOverride();

try {
  await program.parseAsync(process.argv);
} catch (err) {
  const error = err as Error & { code?: string; exitCode?: number };

  if (
    error.code === "commander.help" ||
    error.code === "commander.helpDisplayed" ||
    error.code === "commander.version"
  ) {
    process.exit(0);
  }

  const globalOpts = program.opts();
  const exitCode = error.exitCode ?? 1;

  if (globalOpts.json) {
    console.error(JSON.stringify({ status: "error", message: error.message, exitCode }, null, 2));
    process.exit(exitCode);
  }

  if (error.code?.startsWith("commander.")) {
    process.exit(exitCode);
  }

  console.error(red(`  ${bold("error")}: ${error.message}\n`));
  process.exit(exitCode);
}
