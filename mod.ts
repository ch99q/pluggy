#!/usr/bin/env -S deno run --unstable-net --allow-net --allow-env --allow-read --allow-write --allow-run --unstable-raw-imports
// deno-lint-ignore-file no-explicit-any

import { parseArgs } from "jsr:@std/cli/parse-args";
import { basename, join, resolve, relative, dirname, normalize, globToRegExp } from "jsr:@std/path";
import { levenshteinDistance } from "jsr:@std/text";
import { deepMerge } from "jsr:@std/collections";
import { walk } from "jsr:@std/fs/walk";

import { bold, dim, green, italic, log } from "./logging.ts";
import { checkPlatform, downloadSnapshot, getPlatformRepository, Platform, PLATFORMS, resolveRepository } from "./platform.ts";

import { parse as parseYaml, stringify as stringifyYaml } from "jsr:@std/yaml";

// @deno-types="npm:@types/yauzl"
import { open as openZip, Entry } from 'npm:yauzl';

const CLI_NAME = "pluggy";
const CLI_VERSION = "0.0.0";

const MODRINTH_API = "https://api.modrinth.com/v2";

let ROOT_DIR = Deno.cwd();
let CONFIG_FILE = join(ROOT_DIR, "plugin.json");
let DIST_DIR = join(ROOT_DIR, "dist");
let LIBS_DIR = join(ROOT_DIR, "libs");
let BUILD_DIR = join(ROOT_DIR, "bin");
let SOURCE_DIR = join(ROOT_DIR, "src");

const rootArgs = parseArgs(Deno.args, {
  boolean: ["no-color", "verbose", "help", "version"],
  string: ["config-file"],
  alias: {
    v: "verbose",
    V: "version",
  }
});

// ––––––––––––––––––––––––––––––––––––––––
//                Helpers
// ––––––––––––––––––––––––––––––––––––––––

const getLatestVersion = (platform: Platform): Promise<string> => {
  return resolveRepository(getPlatformRepository(platform)).then(metadata => {
    return metadata.target;
  });
}

function trimObject(value: Record<string, any> | any[]): any {
  if (Array.isArray(value)) {
    return value
      .map(trimObject)
      .filter((v) => v !== undefined);
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([_, v]) => v !== undefined)
        .map(([k, v]) => [k, trimObject(v)])
    );
  }
  return value;
}

const getActivePlatform = (project: Project): {
  platform: Platform;
  version: string;
} => {
  const activePlatform = project.compatibility.platforms.find(platform => PLATFORMS.includes(checkPlatform(platform)));
  if (!activePlatform) throw new Error("No active platform found in project compatibility settings. Please ensure your project is compatible with at least one platform.");
  const latestVersion = project.compatibility.versions.sort((a, b) => {
    return levenshteinDistance(a, b);
  })[0];
  return {
    platform: activePlatform as Platform,
    version: latestVersion,
  }
}

// ––––––––––––––––––––––––––––––––––––––––
//           Project Management
// ––––––––––––––––––––––––––––––––––––––––

import defaultPackage from "./static/package.java" with { type: "text" };
import defaultConfig from "./static/config.yml" with { type: "text" };
import { parse, stringify } from "jsr:@libs/xml";
import { Buffer } from "node:buffer";
import { ReadStream } from "node:fs";

interface Shading {
  exclude?: string[];
  include?: string[];
}

interface Project {
  name: string;
  version: string;
  main: string;
  description: string;
  authors?: string[];
  resources: Record<string, string>;
  dependencies: Record<string, string>;
  shading?: Record<string, Shading>;
  compatibility: {
    versions: string[];
    platforms: string[];
  };
  registries?: Array<string>;
}

const DEFAULT_PROJECT: Project = {
  name: basename(ROOT_DIR),
  version: "0.1.0",
  main: "com.example.Main",
  description: "A Minecraft plugin project using Modrinth.",
  resources: {
    "config.yml": "./resources/config.yml",
  },
  dependencies: {},
  compatibility: {
    versions: [],
    platforms: ["paper", "bukkit"]
  },
}

const getClassName = (project: Project): string => {
  const mainClass = project.main;
  if (!mainClass) return "Main";
  const parts = mainClass.split(".");
  return parts[parts.length - 1];
}

const getPackageName = (project: Project): string => {
  const mainClass = project.main;
  if (!mainClass) return "com.example";
  return mainClass.split(".").slice(0, -1).join(".");
}

function renameContent(content: string, project: Project): string {
  return content
    .replace(/\$__PROJECT_NAME__\$/g, project.name)
    .replace(/\$__PROJECT_VERSION__\$/g, project.version)
    .replace(/\$__PROJECT_MAIN_CLASS__\$/g, getClassName(project))
    .replace(/\$__PROJECT_DESCRIPTION__\$/g, project.description)
    .replace(/\$__PROJECT_PACKAGE_NAME__\$/g, getPackageName(project));
}

async function initProject(args: Partial<Project> = {}): Promise<void> {
  const latestSnapshot = await getLatestVersion("paper").catch(() => "1.21.7");

  DEFAULT_PROJECT.compatibility.versions = [latestSnapshot];

  const project: Project = deepMerge<any>(structuredClone(DEFAULT_PROJECT), trimObject(args));

  // Validate the main class name using regex.
  if (!project.main || !/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(project.main) || !project.main.includes("."))
    throw new Error("Invalid main class name. It must be a valid Java class name (e.g., com.example.Main).");

  const projectFilePath = CONFIG_FILE;
  const projectFileContent = JSON.stringify(project, null, 2);
  await Deno.writeTextFile(projectFilePath, projectFileContent);

  // Write the initial package.java file
  const packageFilePath = join(ROOT_DIR, "src", getPackageName(project).replace(/\./g, "/"), getClassName(project) + ".java");
  const packageFileContent = renameContent(defaultPackage, project);
  await Deno.mkdir(dirname(packageFilePath), { recursive: true });
  await Deno.writeTextFile(packageFilePath, packageFileContent);

  // Write the initial config.yml file
  await Deno.mkdir(join(ROOT_DIR, "resources"), { recursive: true });
  const configFilePath = join(ROOT_DIR, "resources", "config.yml");
  const configFileContent = renameContent(defaultConfig, project);
  await Deno.writeTextFile(configFilePath, configFileContent);

  // Refresh Eclipse project files
  await refreshEclipse(project)

  log.success(`Project "${project.name}" initialized successfully!`);
}

function generateClassPath(project: Project): string {
  const classPath: string[] = [];
  if (project.dependencies) {
    for (const [id, dep] of Object.entries(project.dependencies)) {
      if (dep.startsWith("file:")) {
        classPath.push(relative(ROOT_DIR, dep.slice(5)));
      } else if (dep.startsWith("maven:")) {
        const [groupId, artifactId, versionId] = dep.slice("maven:".length).split(":").flatMap(part => part.split("@"));
        if (!groupId || !artifactId || !versionId) {
          throw new Error(`Invalid Maven dependency format: ${dep}. Expected format: "maven:groupId:artifactId:versionId".`);
        }
        const jarPath = join(LIBS_DIR, `${artifactId}-${versionId}.jar`);
        classPath.push(relative(ROOT_DIR, jarPath));
      } else {
        classPath.push(relative(ROOT_DIR, join(LIBS_DIR, `${id}-${dep}.jar`)));
      }
    }
  }
  const { platform, version } = getActivePlatform(project);
  return stringify({
    "@version": "1.0",
    "@encoding": "UTF-8",
    classpath: {
      classpathentry: [
        { "@kind": "src", "@path": relative(ROOT_DIR, SOURCE_DIR) },
        { "@kind": "output", "@path": relative(ROOT_DIR, BUILD_DIR) },
        { "@kind": "con", "@path": "org.eclipse.jdt.launching.JRE_CONTAINER" },
        { "@kind": "lib", "@path": relative(ROOT_DIR, join(LIBS_DIR, `${platform}-${version}.jar`)) },
        ...classPath.map((path) => ({
          "@kind": "lib",
          "@path": path,
        })),
      ]
    }
  })
}

function generateProjectFile(project: Project): string {
  return stringify({
    "@version": "1.0",
    "@encoding": "UTF-8",
    projectDescription: {
      name: project.name,
      comment: project.description,
      projects: [],
      natures: {
        nature: "org.eclipse.jdt.core.javanature"
      },
      buildSpec: {
        buildCommand: {
          name: "org.eclipse.jdt.core.javabuilder",
          arguments: {}
        }
      }
    }
  });
}

async function refreshEclipse(project: Project): Promise<void> {
  const eclipseProjectFile = join(ROOT_DIR, ".project");
  const eclipseClassPathFile = join(ROOT_DIR, ".classpath");
  await Deno.writeTextFile(eclipseProjectFile, generateProjectFile(project));
  await Deno.writeTextFile(eclipseClassPathFile, generateClassPath(project));
}


// ––––––––––––––––––––––––––––––––––––––––
//            Build System
// ––––––––––––––––––––––––––––––––––––––––

export function jarToObject(jarPath: string, exclude?: string[], include?: string[]): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    openZip(jarPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);

      const result: Record<string, string> = {};

      zipfile.readEntry();

      zipfile.on('entry', (entry: Entry) => {
        const name = entry.fileName;

        // skip directories
        if (name.endsWith('/')) {
          zipfile.readEntry();
          return;
        }

        // exclude patterns
        if (exclude?.some(pat => globToRegExp(pat).test(name))) {
          zipfile.readEntry();
          return;
        }

        // include patterns
        if (include && !include.some(pat => globToRegExp(pat).test(name))) {
          zipfile.readEntry();
          return;
        }

        zipfile.openReadStream(entry, (errStream, stream) => {
          if (errStream) return reject(errStream);

          const chunks: Buffer[] = [];
          stream.on('data', chunk => {
            if (Buffer.isBuffer(chunk)) chunks.push(chunk);
          });
          stream.once('error', reject);
          stream.once('end', () => {
            const key = basename(name);
            result[key] = Buffer.concat(chunks).toString('utf-8');
            zipfile.readEntry();
          });
        });
      });

      zipfile.once('end', () => resolve(result));
      zipfile.on('error', reject);
    });
  });
}

async function buildProject(project: Project): Promise<string> {
  const { version } = getActivePlatform(project);

  // Delete existing build directories.
  await Deno.remove(BUILD_DIR, { recursive: true }).catch(() => { });
  await Deno.mkdir(BUILD_DIR, { recursive: true });

  // Copy the resources to the build directory.
  if (project.resources && Object.keys(project.resources).length > 0) {
    for (const [resource, relPath] of Object.entries(project.resources)) {
      try {
        const sourcePath = resolve(ROOT_DIR, relPath);
        const destPath = join(BUILD_DIR, normalize(resource));

        // Read the file content and apply template variables
        const content = await Deno.readTextFile(sourcePath);
        const processedContent = renameContent(content, project);

        // Ensure the destination directory exists
        await Deno.mkdir(dirname(destPath), { recursive: true });

        // Write the processed content
        await Deno.writeTextFile(destPath, processedContent);
        log.debug(`Copied and processed resource ${resource} to ${destPath}`);
      } catch (e) {
        const error = e as Error;
        throw new Error(`Failed to copy resource ${resource} from ${relPath}: ${error.message.split(":")[0]}`);
      }
    }
  }

  // See if project has defined a plugin.yml file.
  const pluginYaml = Object.entries(project.resources)
    .map(([path, rel]) => [normalize(path), resolve(ROOT_DIR, rel)])
    .find(([resource]) => resource === "plugin.yml");

  const parsedYaml: any = pluginYaml ? parseYaml(await Deno.readTextFile(pluginYaml[1])) : {};

  const DEFAULT_PLUGIN_YML = {
    name: project.name,
    version: project.version,
    main: project.main,
    description: project.description,
    authors: project.authors,
    registries: project.registries || [],
  }

  const singleAuthor = parsedYaml?.author;
  delete parsedYaml.author;

  parsedYaml.authors = parsedYaml.authors || [];
  if (singleAuthor) parsedYaml.authors.unshift(singleAuthor);

  const pluginYamlObject = deepMerge<any>(parsedYaml, trimObject(DEFAULT_PLUGIN_YML), {
    arrays: "merge",
  });

  // Find dependencies and extract their names from their jars.
  const dependencies: Array<[string, string, Record<string, string>]> = await Promise.all(Object.entries(project.dependencies).map(async ([key, version]) => {
    const shading = project.shading?.[key] ?? { include: ['plugin.yml'] };
    if (version.startsWith("file:")) {
      return [
        key,
        resolve(ROOT_DIR, version.slice(5)),
        await jarToObject(
          resolve(ROOT_DIR, version.slice(5)),
          ["META-INF/**/*"].concat(shading?.exclude ?? []),
          shading?.include ? ["plugin.yml"].concat(shading?.include) : ["plugin.yml", "**/*"]
        )
      ];
    }
    if (version.startsWith("maven:")) {
      const [groupId, artifactId, versionId] = version.slice("maven:".length).split(":").flatMap(part => part.split("@"));
      if (!groupId || !artifactId || !versionId) {
        throw new Error(`Invalid Maven dependency format: ${version}. Expected format: "maven:groupId:artifactId@versionId".`);
      }
      return [
        key,
        version,
        await jarToObject(
          join(LIBS_DIR, `${artifactId}-${versionId}.jar`),
          ["META-INF/**/*"].concat(shading?.exclude ?? []),
          shading?.include ? ["plugin.yml"].concat(shading?.include) : ["plugin.yml", "**/*"]
        )
      ];
    }
    return [
      key,
      join(LIBS_DIR, `${key}-${version}.jar`),
      await jarToObject(
        join(LIBS_DIR, `${key}-${version}.jar`),
        ["META-INF/**/*"].concat(shading?.exclude ?? []),
        shading?.include ? ["plugin.yml"].concat(shading?.include) : ["plugin.yml", "**/*"]
      )
    ];
  }));

  const dependencyNames = new Set<string>(pluginYamlObject.dependencies?.split(",").map((v: string) => v.trim()) || []);
  for (const [key, jar, jarObject] of dependencies) {
    const yaml = parseYaml(jarObject?.["plugin.yml"] ?? "") as any;
    const shading = project.shading?.[key];
    log.debug(`Processing dependency ${key} from ${jar}`);
    if (shading) {
      log.debug(`Shading dependency ${key} with settings: ${JSON.stringify(shading)}`);
      // Write the shading files to the build directory.
      for (const [file, content] of Object.entries(jarObject)) {
        const destPath = join(BUILD_DIR, file);
        log.debug(`Shading file ${file} to ${destPath}`);
        await Deno.mkdir(dirname(destPath), { recursive: true });
        await Deno.writeTextFile(destPath, content);
        log.debug(`Shaded file ${file} to ${destPath}`);
      }
    }
    if (yaml?.name) {
      dependencyNames.add(yaml.name.trim());
    } else {
      if (project.shading?.[key]) continue;
      if (jar.startsWith("maven:")) continue;
      log.warn(`Dependency ${key} does not have a valid plugin.yml file, will not be included in plugin.yml dependencies.`);
    }
  }

  pluginYamlObject.dependencies = Array.from(dependencyNames);
  pluginYamlObject.api_version = version

  // Serialize the plugin.yml content and write it to the build directory.
  const pluginYamlContent = stringifyYaml(pluginYamlObject);
  await Deno.writeTextFile(join(BUILD_DIR, "plugin.yml"), pluginYamlContent);

  const classPath = parse(generateClassPath(project)) as any;
  const cp = classPath.classpath.classpathentry.filter((entry: any) => entry["@kind"] === "lib").map((entry: any) => entry["@path"]);
  const files = await Array.fromAsync(walk(join(ROOT_DIR, "src"), { exts: ["java"] }));
  const javacArgs = [
    "-d", BUILD_DIR,
    "-encoding", "UTF-8",
    "-Xlint:deprecation",
    "-Xlint:unchecked",
    "-cp", cp.join(Deno.build.os === "windows" ? ";" : ":"),
  ];
  if (files.length === 0) throw new Error("No Java source files found in src/ directory");
  javacArgs.push(...files.map(file => file.path));

  log.debug(`Executing javac ${javacArgs.join(" ")}`);

  const process = new Deno.Command("javac", { args: javacArgs, cwd: ROOT_DIR, stdout: "piped", stderr: "piped" });
  const result = await process.output();
  if (!result.success)
    throw new Error(`Failed to compile Java sources: ${new TextDecoder().decode(result.stderr)}`);

  const stdout = new TextDecoder().decode(result.stdout);
  if (stdout) log.debug(stdout);

  // Create the jar file.
  await Deno.remove(DIST_DIR, { recursive: true }).catch(() => { });
  await Deno.mkdir(DIST_DIR, { recursive: true });

  const jarArgs = ["cf", join(DIST_DIR, `${project.name}-${project.version}.jar`), "-C", BUILD_DIR, "."];
  log.debug(`Evaluating jar ${jarArgs.join(" ")}`);

  const jarProcess = new Deno.Command("jar", { args: jarArgs, cwd: ROOT_DIR, stdout: "piped", stderr: "piped" });
  const jarResult = await jarProcess.output();

  if (!jarResult.success) {
    const stderr = new TextDecoder().decode(jarResult.stderr);
    throw new Error(`Failed to create JAR file: ${stderr}`);
  }

  const jarStdout = new TextDecoder().decode(jarResult.stdout);
  if (jarStdout) log.debug(jarStdout);

  log.success(`Project "${project.name}" built successfully! Plugin file created at ${relative(ROOT_DIR, join(DIST_DIR, `${project.name}-${project.version}.jar`))}`);
  return join(DIST_DIR, `${project.name}-${project.version}.jar`);
}


// ––––––––––––––––––––––––––––––––––––––––
//         Dependency Management
// ––––––––––––––––––––––––––––––––––––––––

interface ModrinthProject {
  id: string;
  title: string;
  description: string;
  game_versions: string[];
  downloads: number;
  versions: ModrinthVersion[];
}

interface ModrinthVersion {
  id: string;
  version_number: string;
  version_type: "beta" | "release" | "alpha";
  loaders: Platform[];
  files: Array<{
    filename: string;
    url: string;
    primary: boolean;
    size: number;
  }>;
  game_versions: string[];
}

interface ModrinthSearchHit {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  downloads: number;
  follows: number;
  categories: string[];
  versions: string[];
  author: string;
  icon_url?: string;
  date_modified: string;
}

interface ModrinthSearchResponse {
  hits: ModrinthSearchHit[];
  offset: number;
  limit: number;
  total_hits: number;
}

async function getModrinthProject(id: string): Promise<ModrinthProject> {
  const response = await fetch(`${MODRINTH_API}/project/${id}`)
  if (!response.ok) throw new Error(`Failed to fetch project ${id} from Modrinth: ${response.statusText}`);
  const project = await response.json() as ModrinthProject;
  if (!project) throw new Error(`Project ${id} not found on Modrinth`);

  const versionsResponse = await fetch(`${MODRINTH_API}/project/${id}/version`);
  if (!versionsResponse.ok) throw new Error(`Failed to fetch versions for project ${id} from Modrinth: ${versionsResponse.statusText}`);
  const versions = await versionsResponse.json() as ModrinthVersion[];
  if (!versions || versions.length === 0) throw new Error(`No versions found for project ${id} on Modrinth`);
  project.versions = versions;

  return project;
}

async function _getModrinthVersion(projectId: string, versionId: string): Promise<ModrinthVersion> {
  const response = await fetch(`${MODRINTH_API}/project/${projectId}/version/${versionId}`);
  if (!response.ok) throw new Error(`Failed to fetch version ${versionId} for project ${projectId} from Modrinth: ${response.statusText}`);
  const version = await response.json() as ModrinthVersion;
  if (!version) throw new Error(`Version ${versionId} not found for project ${projectId} on Modrinth`);
  return version;
}

async function searchModrinth(query: string, limit = 10, offset = 0): Promise<ModrinthSearchHit[]> {
  const response = await fetch(`${MODRINTH_API}/search?query=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}&index=relevance&facets=[["project_type:plugin"]]`);
  if (!response.ok) throw new Error(`Failed to search Modrinth: ${response.statusText}`);
  const data = await response.json() as ModrinthSearchResponse;
  return data.hits.sort((a, b) => b.downloads - a.downloads)
}

async function addDependency(project: Project, dependency: string, version: string, force = false, beta = false): Promise<void> {
  if (dependency && dependency.startsWith("maven:")) {
    dependency = dependency.slice(6); // Remove "maven:" prefix
    // Example dependency: "com.example:my-plugin@1.0.0"
    const [groupId, artifactId] = dependency.split(":");
    if (!groupId || !artifactId || !version) {
      throw new Error(`Invalid Maven dependency format: ${dependency}. Expected format: "groupId:artifactId@version".`);
    }

    const registries = new Set(project.registries || []);
    registries.add("https://repo1.maven.org/maven2/");

    log.debug(`Searching for Maven dependency "${artifactId}" version "${version}" in registries: ${Array.from(registries).join(", ")}`);

    // Check if the artifact exists in the specified registries.
    const artifactPath = `${groupId.replace(/\./g, "/")}/${artifactId}/${version}/${artifactId}-${version}.jar`;
    for (const registry of registries) {
      const url = new URL(artifactPath, registry);
      try {
        const response = await fetch(url);
        if (response.ok) {
          project.dependencies[artifactId] = `maven:${groupId}:${artifactId}@${version}`;
          log.success(`Added Maven dependency "${artifactId}" version "${version}" from ${url.href}.`);
          await Deno.writeTextFile(CONFIG_FILE, JSON.stringify(project, null, 2));
          return;
        }
      } catch (e) {
        const error = e as Error;
        log.debug(`Failed to fetch Maven dependency from ${url.href}: ${error.message}`);
      }
    }
    throw new Error(`Maven dependency "${artifactId}" version "${version}" not found in specified registries: ${Array.from(registries).join(", ")}.`);
  }

  if (dependency && (dependency.startsWith("file:") || dependency.startsWith("/") || dependency.startsWith("./") || dependency.startsWith("../"))) {
    if (dependency.startsWith("file:")) dependency = dependency.slice(5); // Remove "file:" prefix

    // Local file dependency, add reference to project
    const filePath = resolve(ROOT_DIR, dependency);
    if (!await Deno.stat(filePath).then(() => true).catch(() => false)) {
      throw new Error(`File ${filePath} does not exist.`);
    }

    // Resolve the plugin name from the jar's plugin.yml.
    const jarObject = await jarToObject(filePath, [], ["plugin.yml"]);
    const pluginYaml = jarObject["plugin.yml"];
    const pluginData = parseYaml(pluginYaml ?? "") as any;
    dependency = pluginData?.name || basename(filePath, ".jar");

    project.dependencies[dependency] = `file:${relative(ROOT_DIR, filePath)}`;
    log.success(`Added local dependency "${dependency}" from ${filePath}.`);
    await Deno.writeTextFile(CONFIG_FILE, JSON.stringify(project, null, 2));
    return;
  }

  const modrinthProject = await getModrinthProject(dependency).catch(() => null);
  if (!modrinthProject) throw new Error(`Unable to find ${dependency} on Modrinth, try manually adding the file and do ${CLI_NAME} install ${dependency}@file:./libs/${dependency}.jar`);

  // Check if the project has a version of the specified version.
  if (!modrinthProject.versions.some(v => v.version_number === version))
    throw new Error(`Version ${version} of project ${dependency} not found on Modrinth. Available versions: ${modrinthProject.versions.map(v => v.version_number).join(", ")}`);

  const compatibilityVersions = project.compatibility.versions;
  const compatibilityPlatforms = project.compatibility.platforms;
  // Find the latest compatible version.
  for (const versionInfo of modrinthProject.versions) {
    if (version && version !== versionInfo.version_number) continue; // User specified a specific version
    if (!versionInfo.loaders.some(loader => compatibilityPlatforms.includes(loader))) continue; // Not compatible with the project's platforms
    if (!force && !versionInfo.game_versions.some(gameVersion => compatibilityVersions.includes(gameVersion))) continue; // Not compatible with the project's game versions (skip if force is true)

    const file = versionInfo.files.find(f => f.primary);
    if (!file) continue;

    // Check if the version is a beta or alpha version
    if (versionInfo.version_type !== "release" && !beta) {
      log.warn(`Skipping ${dependency} version ${versionInfo.version_number} (${versionInfo.version_type}) due to compatibility settings. Use --beta to include beta versions.`);
      continue;
    }

    const latestVersion = versionInfo.game_versions.filter(v => compatibilityVersions.includes(v)).sort((a, b) => {
      return levenshteinDistance(a, b);
    })[0];

    log.debug(`Found compatible version ${versionInfo.version_number} for ${modrinthProject.title} (mc ${latestVersion})`);

    if (project.dependencies[dependency] && !force) {
      log.warn(`Dependency ${dependency} already exists in project. Use --force to overwrite.`);
      break;
    }

    project.dependencies[dependency] = versionInfo.version_number;
    return await Deno.writeTextFile(CONFIG_FILE, JSON.stringify(project, null, 2));
  }

  // If we reach here, no compatible version was found
  throw new Error(`No compatible version found for "${dependency}" that supports Minecraft ${compatibilityVersions.join(", ")} on platforms ${compatibilityPlatforms.join(", ")}. The plugin may not support these versions yet.`);
}

async function removeDependency(project: Project, dependency: string): Promise<void> {
  if (!dependency) throw new Error("Dependency name cannot be empty");

  if (!project.dependencies || !project.dependencies[dependency]) {
    throw new Error(`Dependency "${dependency}" not found in project.`);
  }

  const version = project.dependencies[dependency];
  delete project.dependencies[dependency];

  // Update the project file
  await Deno.writeTextFile(CONFIG_FILE, JSON.stringify(project, null, 2));

  // Remove the JAR file from libs directory if it exists
  if (!version.startsWith("file:")) {
    const jarPath = join(LIBS_DIR, `${dependency}-${version}.jar`);
    try {
      await Deno.remove(jarPath);
      log.debug(`Removed JAR file: ${jarPath}`);
    } catch {
      // File might not exist, which is fine
      log.debug(`JAR file not found or already removed: ${jarPath}`);
    }
  }

  log.success(`Removed dependency "${dependency}" from project.`);
}

async function installDependencies(project: Project, force = false, forcePlatform = false): Promise<void> {
  // Find the platform based on the order of the platforms.
  const { platform, version } = getActivePlatform(project);

  const jars = new Set<string>();

  const platformPath = join(LIBS_DIR, `${platform}-${version}.jar`);
  jars.add(platformPath);
  if (forcePlatform || !await Deno.stat(platformPath).then(() => true).catch(() => false)) {
    const snapshot = await downloadSnapshot(getPlatformRepository(platform), version).catch(() => null);
    if (!snapshot) throw new Error(`Unable to resolve snapshot for ${platform} version ${version}. Please check your compatibility settings.`);
    log.debug(`Using ${platform} snapshot version ${snapshot.version} (${snapshot.target}) for project compatibility.`);
    // Save the file to the libs directory
    await Deno.mkdir(LIBS_DIR, { recursive: true });
    await Deno.writeFile(platformPath, snapshot.data);
    log.success(`Installed ${platform} snapshot version ${snapshot.version} (${snapshot.target}).`);
  } else {
    log.debug(`Already found ${platform} snapshot version ${version} already found, use '${CLI_NAME} install --force' to pull the latest version.`);
  }

  for (const [dependency, version] of Object.entries(project.dependencies)) {
    if (!dependency) continue; // Skip empty dependencies

    if (version.startsWith("maven:")) {
      // Check if the dependency is a Maven dependency
      const [groupId, artifactId, versionId] = version.slice(6).split(":").flatMap(part => part.split("@"));
      if (!groupId || !artifactId || !versionId)
        throw new Error(`Invalid Maven dependency format: ${version}. Expected format: "maven:groupId:artifactId@version".`);

      const registries = new Set(project.registries || []);
      registries.add("https://repo1.maven.org/maven2/");

      log.debug(`Searching for Maven dependency "${artifactId}" version "${versionId}" in registries: ${Array.from(registries).join(", ")}`);

      // Check if the artifact file exists in the libs directory
      const existingJarPath = join(LIBS_DIR, `${artifactId}-${versionId}.jar`);
      if (await Deno.stat(existingJarPath).then(() => true).catch(() => false)) {
        if (force) {
          log.debug(`Overwriting existing Maven dependency ${artifactId} version ${versionId} in project.`);
        } else {
          log.debug(`Maven dependency ${artifactId} version ${versionId} already exists in project. Use --force to overwrite.`);
          jars.add(existingJarPath);
          continue; // Skip if the file already exists and force is not set
        }
      }

      // Check if the artifact exists in the specified registries.
      const artifactPath = `${groupId.replace(/\./g, "/")}/${artifactId}/${versionId}/${artifactId}-${versionId}.jar`;
      let found = false;
      for (const registry of registries) {
        const url = new URL(artifactPath, registry);
        try {
          const response = await fetch(url);
          if (response.ok) {
            const payload = new Uint8Array(await response.arrayBuffer());
            const filePath = join(LIBS_DIR, `${artifactId}-${versionId}.jar`);
            jars.add(filePath);
            await Deno.mkdir(LIBS_DIR, { recursive: true });
            await Deno.writeFile(filePath, payload);
            found = true;
            break;
          }
        } catch (error) {
          log.error(`Failed to fetch ${url}: ${error}`);
        }
      }

      if (found) continue;

      throw new Error(`Maven dependency "${artifactId}" version "${versionId}" not found in specified registries: ${Array.from(registries).join(", ")}.`);
    }

    if (version.startsWith("file:")) {
      const filePath = resolve(ROOT_DIR, version.slice(5));
      if (!await Deno.stat(filePath).then(() => true).catch(() => false)) {
        throw new Error(`File ${filePath} does not exist.`);
      }
      jars.add(filePath);
      continue;
    }

    jars.add(join(LIBS_DIR, `${dependency}-${version}.jar`));
    const exists = await Deno.stat(join(LIBS_DIR, `${dependency}-${version}.jar`)).then(() => true).catch(() => false);
    if (force || !exists) {
      if (force && exists) log.debug(`Overwriting existing dependency ${dependency} version ${version} in project.`);
      const modrinthProject = await getModrinthProject(dependency);
      if (!modrinthProject) throw new Error(`Unable to find ${dependency} on Modrinth, try manually adding the file and do ${CLI_NAME} install ${dependency}@file:./libs/${dependency}.jar`);

      const compatibilityVersions = project.compatibility.versions;
      const compatibilityPlatforms = project.compatibility.platforms;

      // Find the latest compatible version.
      let file: {
        filename: string;
        url: string;
        primary: boolean;
        size: number;
      } | undefined;
      for (const versionInfo of modrinthProject.versions) {
        if (version && version !== versionInfo.version_number) continue; // User specified a specific version
        if (!versionInfo.loaders.some(loader => compatibilityPlatforms.includes(loader))) continue; // Not compatible with the project's platforms

        // When installing existing dependencies (not adding new ones), we want to install the exact version
        // even if it's not compatible with current game versions, but show a warning
        const gameVersionCompatible = versionInfo.game_versions.some(gameVersion => compatibilityVersions.includes(gameVersion));
        if (!force && !gameVersionCompatible) {
          if (version && version === versionInfo.version_number) {
            // This is the exact version we want, but it's not compatible - show warning but continue
            log.warn(`Warning: ${modrinthProject.title} version ${version} may not be compatible with Minecraft ${compatibilityVersions.join(", ")}. ${'\n'}  ${modrinthProject.title} supported game versions: ${versionInfo.game_versions.join(", ")}`);
          } else {
            continue; // Skip this version if we're looking for any compatible version
          }
        }

        file = versionInfo.files.find(f => f.primary);
        if (!file) continue;

        // If we found the exact version we wanted (even if incompatible), break here
        if (version && version === versionInfo.version_number) {
          break;
        }
      }

      if (!file) throw new Error(`No compatible version found for ${dependency} in Modrinth. Please check your compatibility settings.`);

      const response = await fetch(file.url);
      if (!response.ok) throw new Error(`Failed to download ${dependency} version ${version} from Modrinth: ${response.statusText}`);
      const payload = new Uint8Array(await response.arrayBuffer());
      const filePath = join(LIBS_DIR, `${dependency}-${version}.jar`);
      await Deno.mkdir(LIBS_DIR, { recursive: true });
      await Deno.writeFile(filePath, payload);

      log.success(`Installed dependency ${modrinthProject.title} version ${version} from Modrinth.`);
    } else {
      log.debug(`Dependency ${dependency} version ${version} already exists in project. Use --force to overwrite.`);
    }
  }

  for await (const entry of Deno.readDir(LIBS_DIR)) {
    if (entry.isFile && entry.name.endsWith('.jar') && !jars.has(join(LIBS_DIR, entry.name))) {
      const jarPath = join(LIBS_DIR, entry.name);
      try {
        await Deno.remove(jarPath);
        log.debug(`Detected unused dependency, removing '${entry.name}'.`);
      } catch (error) {
        log.debug(`Failed to remove ${entry.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }
}

// ––––––––––––––––––––––––––––––––––––––––
//         Command Line Interface
// ––––––––––––––––––––––––––––––––––––––––

if (import.meta.main) {
  const trimUntil = (args: string[], until: string): string[] => {
    const index = args.indexOf(until);
    if (index === -1) return args;
    return args.slice(index + 1);
  };

  try {
    // Handle version flag before other processing
    if (rootArgs.version) {
      log.info(CLI_VERSION);
      Deno.exit(0);
    }

    if (rootArgs._.length > 0) {
      switch (rootArgs._[0]) {
        case "init": {
          const args = parseArgs(trimUntil(Deno.args, "init"), {
            string: ["name", "version", "main", "description"],
            boolean: ["yes"],
            alias: {
              y: "yes",
            }
          });

          if (rootArgs.help) {
            log.info(`Pluggy (v${CLI_VERSION}) - A CLI for developing for Minecraft using Modrinth`);
            log.info("");
            log.info(dim("Usage:"));
            log.info(`  ${bold(CLI_NAME)} init [options]`);
            log.info("");
            log.info(dim("Options:"));
            log.info(`  --name <name> ${italic("- The name of the project.")}`);
            log.info(`  --version <version> ${italic("- The version of the project.")}`);
            log.info(`  --main <main> ${italic("- The main class of the project.")}`);
            log.info(`  --description <description> ${italic("- A description of the project.")}`);
            log.info("");
            log.info(`  -h, --help ${italic("- Show this help message.")}`);
            log.info(`  -y ${italic("- Automatically confirm prompts.")}`);
            log.info("");
            Deno.exit(0);
          }

          // Ensure the root directory exists
          const TARGET_DIR = args._?.[0] ? args._?.[0] as string : ROOT_DIR;

          log.debug(`Setting project root directory to ${TARGET_DIR}`);

          ROOT_DIR = TARGET_DIR;
          CONFIG_FILE = join(ROOT_DIR, "plugin.json");
          BUILD_DIR = join(ROOT_DIR, "build");
          DIST_DIR = join(ROOT_DIR, "dist");
          SOURCE_DIR = join(ROOT_DIR, "src");
          LIBS_DIR = join(ROOT_DIR, "libs");

          DEFAULT_PROJECT.name = basename(ROOT_DIR);

          if (!args.yes) {
            if (await Deno.stat(join(ROOT_DIR)).then(() => true).catch(() => false)) {
              if (!globalThis.confirm(green("?") + " A project already exists in this directory. Do you want to overwrite it?")) {
                log.info("Project initialization cancelled.");
                Deno.exit(0);
              }
            } else {
              if (!globalThis.confirm(green("?") + " Do you want to initialize a new project?")) {
                log.info("Project initialization cancelled.");
                Deno.exit(0);
              }
            }

            args.name = args.name || args._[1] as string || log.prompt("Enter the project name", DEFAULT_PROJECT.name);
            args.version = args.version || log.prompt("Enter the project version", DEFAULT_PROJECT.version);
            args.main = args.main || log.prompt("Enter the main class (e.g., com.example.Main)", DEFAULT_PROJECT.main);
            args.description = args.description || log.prompt("Enter the project description", DEFAULT_PROJECT.description);
          }


          if (args.name && !/^[a-zA-Z0-9_]+$/.test(args.name)) {
            log.error("Project name can only contain alphanumeric characters and underscores.");
            Deno.exit(1);
          }

          if (args.version && !/^\d+\.\d+\.\d+(-SNAPSHOT)?$/.test(args.version)) {
            log.error("Project version must be in the format X.Y.Z or X.Y.Z-SNAPSHOT.");
            Deno.exit(1);
          }

          if (args.main && !/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(args.main)) {
            log.error("Main class must be a valid Java class name (e.g., com.example.Main).");
            Deno.exit(1);
          }

          if (args.description && args.description.length > 200) {
            log.error("Project description cannot exceed 200 characters.");
            Deno.exit(1);
          }

          args.name = args.name || basename(ROOT_DIR);

          await Deno.mkdir(ROOT_DIR, { recursive: true });

          await initProject({
            name: args.name,
            version: args.version,
            main: args.main,
            description: args.description,
          });

          Deno.exit(0);
          break;
        }
        case "build": {
          const args = parseArgs(trimUntil(Deno.args, "build"), {
            boolean: ["force"],
            alias: {
              f: "force",
            }
          });

          if (rootArgs.help) {
            log.info(`Pluggy (v${CLI_VERSION}) - A CLI for developing for Minecraft using Modrinth`);
            log.info("");
            log.info(dim("Usage:"));
            log.info(`  ${bold(CLI_NAME)} build [options]`);
            log.info("");
            log.info(dim("Options:"));
            log.info(`  -h, --help ${italic("- Show this help message.")}`);
            log.info(`  -f, --force ${italic("- Force rebuild all dependencies.")}`);
            log.info("");
            Deno.exit(0);
          }

          const projectFilePath = CONFIG_FILE;
          if (!await Deno.stat(projectFilePath).then(() => true).catch(() => false)) {
            log.error(`Project file not found at ${projectFilePath}. Please run ${CLI_NAME} init first.`);
            Deno.exit(1);
          }

          const projectFileContent = await Deno.readTextFile(projectFilePath);
          const project: Project = JSON.parse(projectFileContent);

          log.info(`Building project "${project.name}"...`);

          await Deno.mkdir(BUILD_DIR, { recursive: true });
          await Deno.mkdir(DIST_DIR, { recursive: true });

          // Ensure dependencies are installed
          log.info("Installing dependencies...");
          await installDependencies(project, args.force, args.force);

          // Build the project
          await buildProject(project);

          log.success(`Build completed successfully!`);

          Deno.exit(0);
          break;
        }
        case "install": {
          const args = parseArgs(trimUntil(Deno.args, "install"), {
            boolean: ["force", "beta"],
            alias: {
              f: "force",
            }
          });

          if (rootArgs.help) {
            log.info(`Pluggy (v${CLI_VERSION}) - A CLI for developing for Minecraft using Modrinth`);
            log.info("");
            log.info(dim("Usage:"));
            log.info(`  ${bold(CLI_NAME)} install [plugin][@version] [options]`);
            log.info("");
            log.info(dim("Options:"));
            log.info(`  -h, --help ${italic("- Show this help message.")}`);
            log.info(`  -f, --force ${italic("- Force install dependencies, ignoring version and compability conflicts.")}`);
            log.info(`  --beta ${italic("- Include beta and alpha versions in the search.")}`);
            log.info("");
            log.info(dim("Examples:"));
            log.info(`  install worldedit ${italic("- Add the latest version of a plugin.")}`);
            log.info(`  install worldedit@7.2.6 ${italic("- Add a specific version of a plugin.")}`);
            log.info(`  install maven:net.kyori:adventure-api@4.10.0 ${italic("- Add a Maven dependency.")}`);
            log.info(`  install ./libs/worldedit.jar ${italic("- Reference a local JAR file.")}`);
            log.info("");
            Deno.exit(0);
          }

          const projectFilePath = CONFIG_FILE;
          if (!await Deno.stat(projectFilePath).then(() => true).catch(() => false)) {
            log.error(`Project file not found at ${projectFilePath}. Please run ${CLI_NAME} init first.`);
            Deno.exit(1);
          }

          const projectFileContent = await Deno.readTextFile(projectFilePath);
          const project: Project = JSON.parse(projectFileContent);

          if (args._ && args._.length > 0) {
            // User provided a specific plugin to install.
            const pluginArg = args._[0] as string;
            const [pluginName, pluginVersion] = pluginArg.split("@");
            if (!pluginName) {
              log.error("No plugin name provided. Please specify a plugin to install.");
              Deno.exit(1);
            }

            log.info(`Installing plugin ${pluginName} ${pluginVersion ? pluginVersion.startsWith("file:") ? `from ${pluginVersion.slice(5)}` : `version ${pluginVersion}` : "latest"}...`);
            await addDependency(project, pluginName, pluginVersion, args.force, args.beta);

            // When installing a specific plugin, don't force platform update
            log.info(`Installing project dependencies "${project.name}"...`);
            await installDependencies(project, args.force, false);
          } else {
            log.info(`Installing project dependencies "${project.name}"...`);
            await installDependencies(project, args.force, args.force); // Force platform when user uses --force without specific plugin
          }

          // Refresh Eclipse project files
          await refreshEclipse(project);

          log.success(`Successfully installed dependencies for project "${project.name}"!`);
          Deno.exit(0);
          break;
        }
        case "remove": {
          const args = parseArgs(trimUntil(Deno.args, "remove"), {
            boolean: ["yes"],
            alias: {
              y: "yes",
            }
          });

          if (rootArgs.help || rootArgs._.length === 1) {
            log.info(`Pluggy (v${CLI_VERSION}) - A CLI for developing for Minecraft using Modrinth`);
            log.info("");
            log.info(dim("Usage:"));
            log.info(`  ${bold(CLI_NAME)} remove <plugin> [options]`);
            log.info("");
            log.info(dim("Options:"));
            log.info(`  -h, --help ${italic("- Show this help message.")}`);
            log.info(`  -y, --yes ${italic("- Automatically confirm prompts.")}`);
            log.info("");
            log.info(dim("Examples:"));
            log.info(`  remove worldedit ${italic("- Remove WorldEdit from the project.")}`);
            log.info("");
            Deno.exit(0);
          }

          const projectFilePath = CONFIG_FILE;
          if (!await Deno.stat(projectFilePath).then(() => true).catch(() => false)) {
            log.error(`Project file not found at ${projectFilePath}. Please run ${CLI_NAME} init first.`);
            Deno.exit(1);
          }

          const projectFileContent = await Deno.readTextFile(projectFilePath);
          const project: Project = JSON.parse(projectFileContent);

          if (args._.length === 0) {
            log.error("No plugin name provided. Please specify a plugin to remove.");
            Deno.exit(1);
          }

          const pluginName = args._[0] as string;

          if (!project.dependencies || !project.dependencies[pluginName]) {
            log.error(`Plugin "${pluginName}" is not installed in this project.`);
            Deno.exit(1);
          }

          // Ask for confirmation unless --yes is provided
          if (!args.yes) {
            const version = project.dependencies[pluginName];
            const versionDisplay = version.startsWith("file:") ? `(${version})` : `v${version}`;
            if (!globalThis.confirm(green("?") + ` Are you sure you want to remove "${pluginName}" ${versionDisplay}?`)) {
              log.info("Plugin removal cancelled.");
              Deno.exit(0);
            }
          }

          log.info(`Removing plugin "${pluginName}" from project...`);
          await removeDependency(project, pluginName);

          // Refresh Eclipse project files
          await refreshEclipse(project);

          log.success(`Plugin "${pluginName}" has been removed from the project.`);
          Deno.exit(0);
          break;
        }
        case "info": {
          if (rootArgs.help || rootArgs._.length === 1) {
            log.info(`Pluggy (v${CLI_VERSION}) - A CLI for developing for Minecraft using Modrinth`);
            log.info("");
            log.info(dim("Usage:"));
            log.info(`  ${bold(CLI_NAME)} info <plugin>[@version] [options]`);
            log.info("");
            log.info(dim("Options:"));
            log.info(`  -h, --help ${italic("- Show this help message.")}`);
            log.info("");
            log.info(dim("Examples:"));
            log.info(`  info worldedit ${italic("- Show information about WorldEdit.")}`);
            log.info(`  info worldedit@7.2.6 ${italic("- Show information about WorldEdit version 7.2.6.")}`);
            log.info("");
            Deno.exit(0);
          }

          if (rootArgs._.length === 1) {
            log.error("No plugin name provided. Please specify a plugin to get information about.");
            Deno.exit(1);
          }

          const pluginArg = rootArgs._[1] as string;
          const [pluginName, pluginVersion] = pluginArg.split("@");

          const modrinthProject = await getModrinthProject(pluginName);

          log.info("");
          log.info(`${bold(modrinthProject.title)} (${pluginName})`);
          log.info(`${dim(modrinthProject.description)}`);
          log.info("");
          log.info(`Downloads: ${modrinthProject.downloads.toLocaleString()}`);
          log.info(`Game Versions: ${modrinthProject.game_versions.join(", ")}`);
          log.info(`Available Versions: ${modrinthProject.versions.length}`);

          if (pluginVersion) {
            const version = modrinthProject.versions.find(v => v.version_number === pluginVersion);
            if (version) {
              log.info("");
              log.info(`${bold(`Version ${pluginVersion}:`)}`);
              log.info(`  Type: ${version.version_type}`);
              log.info(`  Loaders: ${version.loaders.join(", ")}`);
              log.info(`  Game Versions: ${version.game_versions.join(", ")}`);
              log.info(`  Files: ${version.files.length}`);
              if (version.files.length > 0) {
                const primaryFile = version.files.find(f => f.primary) || version.files[0];
                log.info(`  Primary File: ${primaryFile.filename} (${(primaryFile.size / 1024 / 1024).toFixed(2)} MB)`);
              }
            } else {
              log.warn(`Version ${pluginVersion} not found for ${pluginName}`);
            }
          } else {
            log.info("");
            log.info(`${bold("Latest Versions:")}`);
            modrinthProject.versions.slice(0, 5).forEach(version => {
              log.info(`  ${version.version_number} (${version.version_type}) - MC ${version.game_versions.join(", ")}`);
            });
            if (modrinthProject.versions.length > 5) {
              log.info(`  ... and ${modrinthProject.versions.length - 5} more versions`);
            }
          }
          log.info("");

          Deno.exit(0);
          break;
        }
        case "search": {
          const args = parseArgs(rootArgs._.slice(1) as string[], {
            string: ["query", "limit", "offset"],
            default: {
              limit: "3",
              offset: "0",
            }
          });

          if (rootArgs.help || args._.length === 0) {
            log.info(`Pluggy (v${CLI_VERSION}) - A CLI for developing for Minecraft using Modrinth`);
            log.info("");
            log.info(dim("Usage:"));
            log.info(`  ${bold(CLI_NAME)} search <query> [options]`);
            log.info("");
            log.info(dim("Options:"));
            log.info(`  --query <query> ${italic("- The search query.")}`);
            log.info(`  --limit <limit> ${italic("- The number of results to return (default: 10).")}`);
            log.info(`  --offset <offset> ${italic("- The offset for pagination (default: 0).")}`);
            log.info(`  -h, --help ${italic("- Show this help message.")}`);
            log.info("");
            Deno.exit(0);
          }

          const query = args.query || args._[0] as string || "";
          const limit = parseInt(args.limit, 10) || 3;
          const offset = parseInt(args.offset, 10) || 0;

          const start = performance.now();
          const results = await searchModrinth(query, limit, offset);
          const end = performance.now();

          // Print results
          if (results.length === 0) {
            log.warn(`No results found for query "${query}"`);
            break;
          }

          log.info(dim(`Found ${results.length} results for query "${query}" in ${Math.round(end - start)}ms`));
          log.info("");
          for (const result of results) {
            const formattedDescription = result.description
              .split('\n')
              .map((line, index) => index === 0 ? line : `  ${line}`)
              .join('\n');
            log.info(`${bold(result.title)} (${result.project_id})`);
            log.info(`  ${dim(formattedDescription)}`);
            log.info(`  Author: ${result.author} | Downloads: ${result.downloads} | Follows: ${result.follows}`);
            log.info(`  Game Versions: ${result.versions.join(", ")}`);
            log.info("");
          }

          Deno.exit(0);
          break;
        }
        default: {
          const command = rootArgs._[0] as string;
          // Find closest match
          const commands = ["init", "dev", "build", "install", "add", "remove", "info", "search"];
          const closest = commands.reduce((prev, curr) => {
            const prevDistance = levenshteinDistance(command, prev);
            const currDistance = levenshteinDistance(command, curr);
            return currDistance < prevDistance ? curr : prev;
          }, commands[0]);
          log.error(`Unknown command: ${command}, did you mean "${closest}"?`);
          log.info("");
          break;
        }
      }
    }

    log.info(`Pluggy (v${CLI_VERSION}) - A CLI for developing for Minecraft using Modrinth`);
    log.info("");
    log.info(dim("Usage:"));
    log.info(`  ${bold(CLI_NAME)} [options] [command] [args]`);
    log.info("");
    log.info(dim("Commands:"));
    log.info(dim("  Project:"));
    log.info(`    init [options]`);
    log.info(`    build [options]`);
    log.info("");
    log.info(dim("  Dependencies:"));
    log.info(`    install [plugin][@version] [options] ${italic("- Install dependencies for the project.")}`);
    log.info(`    remove <plugin> [options] ${italic("- Remove a plugin from the project.")}`);
    log.info("");
    log.info(dim("  Information:"));
    log.info(`    info <plugin>[@version] [options] ${italic("- Show information about a plugin.")}`);
    log.info(`    search <query> [options] ${italic("- Search for plugins.")}`);
    log.info("");
    log.info(dim("Options:"));
    log.info(`  -v, --verbose ${italic("- Enable verbose output.")}`);
    log.info(`  --no-color ${italic("- Disable colored output.")}`);
    log.info(`  --version ${italic("- Show the version of the CLI.")}`);
    log.info(`  --help ${italic("- Show this help message.")}`);
    log.info("");
  } catch (e) {
    const error = e instanceof Error ? e : new Error("An unknown error occurred");
    log.error(error.message);
    if (rootArgs.verbose) {
      log.debug(error.stack ? error.stack : "No stack trace available");
    }
    Deno.exit(1);
  }
}