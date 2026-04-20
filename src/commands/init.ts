import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import defaultConfig from "../defaults/config.yml" with { type: "text" };
import defaultPackage from "../defaults/package.java" with { type: "text" };

import type { Project } from "../project.ts";
import { replace } from "../template.ts";

export async function generateProject(distDir: string, project: Project): Promise<void> {
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
      className: project.main.split(".").pop() || "Main",
      packageName: project.main.split(".").slice(0, -1).join("."),
    },
  };

  const configFilePath = join(distDir, "src", "config.yml");
  try {
    await mkdir(join(distDir, "src"), { recursive: true });
    await writeFile(configFilePath, replace(defaultConfig, replacementProject));
  } catch (e) {
    throw new Error(`Failed to write config file: ${(e as Error).message}`);
  }

  const mainClassPath = join(distDir, "src", project.main.replace(/\./g, "/") + ".java");
  try {
    await mkdir(join(distDir, "src", ...project.main.split(".").slice(0, -1)), { recursive: true });
    await writeFile(mainClassPath, replace(defaultPackage, replacementProject));
  } catch (e) {
    throw new Error(`Failed to write main class file: ${(e as Error).message}`);
  }
}
