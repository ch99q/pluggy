import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";

export interface Project {
  name: string;
  version: string;
  description?: string;
  authors?: string[];
  /**
   * Fully-qualified main class. Required for plugin workspaces; not required
   * on a root `project.json` that declares `workspaces`.
   */
  main?: string;
  ide?: "vscode" | "eclipse" | "intellij";
  compatibility: {
    versions: string[];
    platforms: string[];
  };
  dependencies?: Record<string, string | Dependency>;
  registries?: (string | Registry)[];
  shading?: Record<string, Shading>;
  resources?: Record<string, string>;
  workspaces?: string[];
  dev?: DevConfig;
}

export type ResolvedProject = Project & {
  rootDir: string;
  projectFile: string;
};

export interface Dependency {
  source: string;
  version: string;
}

export interface Shading {
  exclude?: string[];
  include?: string[];
}

export interface Registry {
  url: string;
  credentials?: {
    username: string;
    password: string;
  };
}

export interface DevConfig {
  port?: number;
  memory?: string;
  onlineMode?: boolean;
  jvmArgs?: string[];
  serverProperties?: Record<string, string | number | boolean>;
  extraPlugins?: string[];
}

export function getCachePath(): string {
  const home = homedir();
  if (process.platform === "darwin") {
    return join(home, "Library", "Caches", "pluggy");
  }
  if (process.platform === "win32") {
    return join(process.env.LOCALAPPDATA || join(home, "AppData", "Local"), "pluggy", "cache");
  }
  return join(process.env.XDG_CACHE_HOME || join(home, ".cache"), "pluggy");
}

const PROJECT_FILE_NAME = "project.json";

export function resolveProject(path: string): ResolvedProject | undefined {
  let currentPath = path;
  while (currentPath !== dirname(currentPath)) {
    const projectFilePath = join(currentPath, PROJECT_FILE_NAME);
    if (existsSync(projectFilePath)) {
      const projectFileContent = readFileSync(projectFilePath, "utf8");
      const project: ResolvedProject = JSON.parse(projectFileContent);
      project.rootDir = dirname(projectFilePath);
      project.projectFile = projectFilePath;
      return project;
    }
    currentPath = dirname(currentPath);
  }
  return undefined;
}

export function resolveProjectFile(path: string): ResolvedProject | undefined {
  if (existsSync(path)) {
    const projectFileContent = readFileSync(path, "utf8");
    const project: ResolvedProject = JSON.parse(projectFileContent);
    project.projectFile = path;
    return project;
  }
  return undefined;
}

export function getCurrentProject(cwd?: string): ResolvedProject | undefined {
  const path = cwd || process.cwd();
  return resolveProject(path);
}
