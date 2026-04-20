import { readdir } from "node:fs/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import process from "node:process";

import { Command, InvalidArgumentError } from "commander";
import { confirm } from "@inquirer/prompts";

import defaultConfig from "../defaults/config.yml" with { type: "text" };
import defaultPackage from "../defaults/package.java" with { type: "text" };

import { getPlatform, getRegisteredPlatforms } from "../platform/index.ts";
import { getCurrentProject, type Project, resolveProjectFile } from "../project.ts";
import { replace } from "../template.ts";

import { parsePlatform, parseSemver } from "./parsers.ts";

/**
 * Scaffold a new project at `distDir` from the given `Project` config.
 *
 * Writes `project.json`, `src/config.yml`, and `src/<package>/<Class>.java`.
 * Throws if `project.main` is unset or any of the writes fail.
 */
export async function generateProject(distDir: string, project: Project): Promise<void> {
  const main = project.main;
  if (!main) {
    throw new Error("generateProject requires project.main to be set");
  }

  try {
    await mkdir(distDir, { recursive: true });
  } catch (e) {
    throw new Error(`Failed to create project directory: ${(e as Error).message}`);
  }

  const projectFilePath = join(distDir, "project.json");
  try {
    await writeFile(projectFilePath, JSON.stringify(project, null, 2));
  } catch (e) {
    throw new Error(`Failed to write project file: ${(e as Error).message}`);
  }

  const replacementProject = {
    project: {
      ...project,
      className: main.split(".").pop() || "Main",
      packageName: main.split(".").slice(0, -1).join("."),
    },
  };

  const configFilePath = join(distDir, "src", "config.yml");
  try {
    await mkdir(join(distDir, "src"), { recursive: true });
    await writeFile(configFilePath, replace(defaultConfig, replacementProject));
  } catch (e) {
    throw new Error(`Failed to write config file: ${(e as Error).message}`);
  }

  const mainClassPath = join(distDir, "src", main.replace(/\./g, "/") + ".java");
  try {
    await mkdir(join(distDir, "src", ...main.split(".").slice(0, -1)), { recursive: true });
    await writeFile(mainClassPath, replace(defaultPackage, replacementProject));
  } catch (e) {
    throw new Error(`Failed to write main class file: ${(e as Error).message}`);
  }
}

/** Factory for the `pluggy init` commander command. */
export function initCommand(): Command {
  return new Command("init")
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
    .action(async function action(this: Command, path: string | undefined, options) {
      const globalOpts = this.optsWithGlobals();

      let currentProject = getCurrentProject();
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

      if (!getRegisteredPlatforms().includes(platform)) {
        throw new InvalidArgumentError(
          `Invalid platform: "${platform}". Available platforms: ${getRegisteredPlatforms().join(", ")}`,
        );
      }

      const latestVersion = await getPlatform(platform).getLatestVersion();

      const INITIAL_PROJECT: Project = {
        name: options.name || basename(TARGET_PATH),
        version: options.version || "1.0.0",
        description: options.description || "A simple Minecraft plugin",
        main: options.main || "com.example.Main",
        compatibility: {
          versions: [latestVersion.version],
          platforms: [platform],
        },
      };

      if (!/^[a-zA-Z0-9_]+$/.test(INITIAL_PROJECT.name)) {
        throw new InvalidArgumentError(
          `Invalid project name: "${INITIAL_PROJECT.name}". Only alphanumeric characters and underscores are allowed.`,
        );
      }

      if (
        !INITIAL_PROJECT.main ||
        !/^[a-zA-Z0-9_.]+$/.test(INITIAL_PROJECT.main) ||
        !INITIAL_PROJECT.main.includes(".")
      ) {
        throw new InvalidArgumentError(
          `Invalid main class: "${INITIAL_PROJECT.main}". It must be a valid Java classpath (e.g., com.example.Main).`,
        );
      }

      await generateProject(TARGET_PATH, INITIAL_PROJECT);

      if (globalOpts.json) {
        console.log(
          JSON.stringify(
            { status: "success", project: INITIAL_PROJECT, dir: TARGET_PATH },
            null,
            2,
          ),
        );
        return;
      }

      console.log(`Project "${INITIAL_PROJECT.name}" initialized successfully at ${TARGET_PATH}`);
    });
}
