/**
 * IDE integration — writes editor-specific project files so the user's
 * editor sees pluggy's resolved classpath.
 *
 * Support matrix:
 *   - vscode  → `.vscode/settings.json` (redhat.java's `referencedLibraries`)
 *   - eclipse → `.classpath` + `.project` at the project root
 *   - intellij → not implemented yet; caller should warn when requested
 */

import { mkdir } from "node:fs/promises";
import { join, relative } from "node:path";

import { writeFileLF } from "../portable.ts";
import type { ResolvedProject } from "../project.ts";

export type IdeKind = "vscode" | "eclipse" | "intellij";

/**
 * Write IDE integration files for `project.ide`. No-op when `ide` is unset
 * or set to a value we don't yet support (intellij). Never throws — IDE
 * scaffolding is convenience, not a build-blocker.
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
      // 🎯 not implemented; caller (doctor / build) surfaces the notice.
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
