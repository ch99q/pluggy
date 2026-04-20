/**
 * IDE integration — writes editor-specific project files so the user's
 * editor sees pluggy's resolved classpath.
 *
 * Support matrix:
 *   - vscode   → `.vscode/settings.json` (redhat.java's `referencedLibraries`)
 *   - eclipse  → `.classpath` + `.project` at the project root
 *   - intellij → `.idea/` directory plus `<name>.iml` at the project root
 */

import { mkdir } from "node:fs/promises";
import { basename, join, relative } from "node:path";

import { writeFileLF } from "../portable.ts";
import type { ResolvedProject } from "../project.ts";

export type IdeKind = "vscode" | "eclipse" | "intellij";

/**
 * Write IDE integration files for `project.ide`. No-op when `ide` is unset.
 * Throws on real failures; the caller wraps in try/catch and logs at debug,
 * so IDE scaffolding never blocks a build.
 */
export async function writeIdeFiles(
  project: ResolvedProject,
  classpath: string[],
  stagingOutputDir: string,
): Promise<void> {
  const ide = project.ide;
  if (ide === undefined) return;

  switch (ide) {
    case "vscode":
      await writeVscodeSettings(project, classpath);
      return;
    case "eclipse":
      await writeEclipseFiles(project, classpath, stagingOutputDir);
      return;
    case "intellij":
      await writeIntellijFiles(project, classpath);
      return;
  }
}

async function writeVscodeSettings(project: ResolvedProject, classpath: string[]): Promise<void> {
  const dir = join(project.rootDir, ".vscode");
  await mkdir(dir, { recursive: true });
  const settings = {
    "java.project.referencedLibraries": classpath,
    "java.project.sourcePaths": ["src"],
    "java.project.outputPath": ".pluggy-build/classes",
  };
  await writeFileLF(join(dir, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`);
}

async function writeEclipseFiles(
  project: ResolvedProject,
  classpath: string[],
  stagingOutputDir: string,
): Promise<void> {
  const out = relative(project.rootDir, stagingOutputDir) || ".pluggy-build";
  await writeFileLF(join(project.rootDir, ".classpath"), renderEclipseClasspath(classpath, out));
  await writeFileLF(join(project.rootDir, ".project"), renderEclipseProject(project.name));
}

function renderEclipseClasspath(classpath: string[], outputPath: string): string {
  const entries = [
    `  <classpathentry kind="src" path="src"/>`,
    `  <classpathentry kind="con" path="org.eclipse.jdt.launching.JRE_CONTAINER"/>`,
    ...classpath.map((jar) => `  <classpathentry kind="lib" path="${escapeXml(jar)}"/>`),
    `  <classpathentry kind="output" path="${escapeXml(outputPath)}"/>`,
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<classpath>
${entries.join("\n")}
</classpath>
`;
}

function renderEclipseProject(name: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<projectDescription>
  <name>${escapeXml(name)}</name>
  <comment></comment>
  <projects></projects>
  <buildSpec>
    <buildCommand>
      <name>org.eclipse.jdt.core.javabuilder</name>
      <arguments></arguments>
    </buildCommand>
  </buildSpec>
  <natures>
    <nature>org.eclipse.jdt.core.javanature</nature>
  </natures>
</projectDescription>
`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ────────────────────────────────────────────────────────────────────────────
// IntelliJ
// ────────────────────────────────────────────────────────────────────────────

/**
 * Write a minimal-but-working IntelliJ project layout at `project.rootDir`:
 *
 *   .idea/.gitignore
 *   .idea/modules.xml
 *   .idea/misc.xml
 *   .idea/libraries/<lib>.xml         (one per resolved classpath entry)
 *   <name>.iml
 *
 * The `.iml` lists every library as an `orderEntry` with names matching the
 * library file basenames, so IntelliJ's project model stays internally
 * consistent on first open.
 */
async function writeIntellijFiles(project: ResolvedProject, classpath: string[]): Promise<void> {
  const ideaDir = join(project.rootDir, ".idea");
  const librariesDir = join(ideaDir, "libraries");
  await mkdir(librariesDir, { recursive: true });

  // De-dupe library names defensively in case two jar paths collide post-
  // sanitization (unlikely with the maven scheme, but cheap insurance).
  const libraries = assignUniqueLibraryNames(classpath);

  // .idea/.gitignore — keep workspace-local noise out of git.
  await writeFileLF(join(ideaDir, ".gitignore"), `workspace.xml\nshelf/\nusage.statistics.xml\n`);

  // .idea/modules.xml — registers the single `<name>.iml` module.
  await writeFileLF(join(ideaDir, "modules.xml"), renderIntellijModulesXml(project.name));

  // .idea/misc.xml — JDK + language level. See pickIntellijJdk() for the
  // version → JDK rule.
  const jdk = pickIntellijJdk(project);
  await writeFileLF(join(ideaDir, "misc.xml"), renderIntellijMiscXml(jdk));

  // .idea/libraries/*.xml — one library per resolved classpath entry.
  for (const lib of libraries) {
    await writeFileLF(
      join(librariesDir, `${lib.name}.xml`),
      renderIntellijLibraryXml(lib.name, lib.jarPath),
    );
  }

  // <name>.iml — module descriptor at the project root.
  await writeFileLF(
    join(project.rootDir, `${project.name}.iml`),
    renderIntellijIml(libraries.map((l) => l.name)),
  );
}

interface IntellijLibrary {
  /** Filesystem-safe library name; also the .xml basename and orderEntry name. */
  name: string;
  /** Absolute path to the jar on disk. */
  jarPath: string;
}

/**
 * Naming rule for libraries derived from a jar path:
 *
 *   1. If the path lives under a `.../maven/<groupId>/<artifactId>/<version>.jar`
 *      layout (pluggy's resolver cache), encode it as
 *      `maven__<groupId>__<artifactId>__<version>` with dots in segments
 *      replaced by underscores.
 *   2. Otherwise, fall back to the jar basename (sans `.jar`).
 *
 * In both cases the result is run through `sanitizeLibName` so the value is
 * safe for both filesystems and IntelliJ's library-name attribute (alnum,
 * `_`, `-`, `.` only).
 */
function libraryNameForJar(jarPath: string): string {
  const segments = jarPath.split(/[/\\]/);
  const mavenIdx = segments.lastIndexOf("maven");
  // Need at least: maven, group, artifact, version.jar
  if (mavenIdx !== -1 && segments.length - mavenIdx >= 4) {
    const groupId = segments[mavenIdx + 1];
    const artifactId = segments[mavenIdx + 2];
    const versionJar = segments[mavenIdx + 3];
    const version = versionJar.endsWith(".jar") ? versionJar.slice(0, -".jar".length) : versionJar;
    if (groupId && artifactId && version) {
      return sanitizeLibName(
        `maven__${groupId.replace(/\./g, "_")}__${artifactId}__${version.replace(/\./g, "_")}`,
      );
    }
  }
  const base = basename(jarPath);
  const stem = base.endsWith(".jar") ? base.slice(0, -".jar".length) : base;
  return sanitizeLibName(stem);
}

/** Replace every char outside `[A-Za-z0-9_.-]` with `_`. */
function sanitizeLibName(name: string): string {
  return name.replace(/[^A-Za-z0-9_.-]/g, "_");
}

/**
 * Map jar paths → library descriptors with unique names. Collisions are
 * resolved by appending `__2`, `__3`, ... in classpath order so the first
 * occurrence keeps the clean name.
 */
function assignUniqueLibraryNames(classpath: string[]): IntellijLibrary[] {
  const seen = new Map<string, number>();
  const out: IntellijLibrary[] = [];
  for (const jarPath of classpath) {
    const base = libraryNameForJar(jarPath);
    const count = seen.get(base) ?? 0;
    const name = count === 0 ? base : `${base}__${count + 1}`;
    seen.set(base, count + 1);
    out.push({ name, jarPath });
  }
  return out;
}

/**
 * Pick a JDK / language level from `project.compatibility.versions[0]`.
 *
 * Mojang's published Minecraft → JDK requirements:
 *   - 1.21.x → Java 21
 *   - 1.20.5+ → Java 21
 *   - 1.18.x – 1.20.4 → Java 17
 *   - 1.17.x → Java 16
 *   - ≤ 1.16 → Java 8
 *
 * Anything we can't parse falls back to Java 21 (current Paper baseline).
 */
function pickIntellijJdk(project: ResolvedProject): { major: number; languageLevel: string } {
  const primary = project.compatibility?.versions?.[0];
  const major = primary !== undefined ? jdkMajorForMcVersion(primary) : 21;
  return { major, languageLevel: `JDK_${major}` };
}

function jdkMajorForMcVersion(version: string): number {
  const m = version.match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
  if (m === null) return 21;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = m[3] !== undefined ? Number(m[3]) : 0;
  if (major !== 1) return 21; // Future-proof: unknown majors → newest known.
  if (minor >= 21) return 21;
  if (minor === 20 && patch >= 5) return 21;
  if (minor >= 18) return 17;
  if (minor === 17) return 16;
  return 8;
}

function renderIntellijModulesXml(name: string): string {
  const imlPath = `$PROJECT_DIR$/${name}.iml`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<project version="4">
  <component name="ProjectModuleManager">
    <modules>
      <module fileurl="file://${escapeXml(imlPath)}" filepath="${escapeXml(imlPath)}" />
    </modules>
  </component>
</project>
`;
}

function renderIntellijMiscXml(jdk: { major: number; languageLevel: string }): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<project version="4">
  <component name="ProjectRootManager" version="2" languageLevel="${escapeXml(jdk.languageLevel)}" project-jdk-name="${escapeXml(String(jdk.major))}" project-jdk-type="JavaSDK">
    <output url="file://$PROJECT_DIR$/.pluggy-build/classes" />
  </component>
</project>
`;
}

function renderIntellijLibraryXml(name: string, jarPath: string): string {
  // jar://<absolute-path>!/  is IntelliJ's URL form for "the root of this jar".
  return `<component name="libraryTable">
  <library name="${escapeXml(name)}">
    <CLASSES>
      <root url="jar://${escapeXml(jarPath)}!/" />
    </CLASSES>
    <JAVADOC />
    <SOURCES />
  </library>
</component>
`;
}

function renderIntellijIml(libraryNames: string[]): string {
  const orderEntries = [
    `    <orderEntry type="inheritedJdk" />`,
    `    <orderEntry type="sourceFolder" forTests="false" />`,
    ...libraryNames.map(
      (n) => `    <orderEntry type="library" name="${escapeXml(n)}" level="project" />`,
    ),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<module type="JAVA_MODULE" version="4">
  <component name="NewModuleRootManager" inherit-compiler-output="false">
    <output url="file://$MODULE_DIR$/.pluggy-build/classes" />
    <exclude-output />
    <content url="file://$MODULE_DIR$">
      <sourceFolder url="file://$MODULE_DIR$/src" isTestSource="false" />
      <excludeFolder url="file://$MODULE_DIR$/.pluggy-build" />
      <excludeFolder url="file://$MODULE_DIR$/dev" />
    </content>
${orderEntries.join("\n")}
  </component>
</module>
`;
}
