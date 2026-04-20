/** Tests for src/build/resources.ts. */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";

import type { ResolvedProject } from "../project.ts";

import { stageResources } from "./resources.ts";

function makeProject(rootDir: string, resources?: Record<string, string>): ResolvedProject {
  return {
    name: "testplugin",
    version: "1.2.3",
    description: "A test plugin",
    main: "com.example.test.Main",
    authors: ["Alice", "Bob"],
    compatibility: { versions: ["1.21.8"], platforms: ["paper"] },
    rootDir,
    projectFile: join(rootDir, "project.json"),
    resources,
  };
}

describe("stageResources", () => {
  let workDir: string;
  let stagingDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "pluggy-resources-work-"));
    stagingDir = await mkdtemp(join(tmpdir(), "pluggy-resources-stage-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
    await rm(stagingDir, { recursive: true, force: true });
  });

  test("no-op when project.resources is undefined", async () => {
    const project = makeProject(workDir);
    await expect(stageResources(project, stagingDir)).resolves.toBeUndefined();
  });

  test("copies a simple file entry without template substitution on non-allowlisted extension", async () => {
    await writeFile(join(workDir, "icon.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const project = makeProject(workDir, { "assets/icon.png": "./icon.png" });

    await stageResources(project, stagingDir);

    const raw = await readFile(join(stagingDir, "assets/icon.png"));
    expect(raw.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(true);
  });

  test("applies template substitution on allowlisted extensions", async () => {
    await writeFile(
      join(workDir, "plugin.yml"),
      "name: ${project.name}\nversion: ${project.version}\nmain: ${project.main}\n",
    );
    const project = makeProject(workDir, { "plugin.yml": "./plugin.yml" });

    await stageResources(project, stagingDir);

    const written = await readFile(join(stagingDir, "plugin.yml"), "utf8");
    expect(written).toContain("name: testplugin");
    expect(written).toContain("version: 1.2.3");
    expect(written).toContain("main: com.example.test.Main");
    expect(written).not.toContain("${");
  });

  test("exposes project.className and packageName to templates", async () => {
    await writeFile(
      join(workDir, "config.yml"),
      "class: ${project.className}\npackage: ${project.packageName}\n",
    );
    const project = makeProject(workDir, { "config.yml": "./config.yml" });

    await stageResources(project, stagingDir);

    const written = await readFile(join(stagingDir, "config.yml"), "utf8");
    expect(written).toContain("class: Main");
    expect(written).toContain("package: com.example.test");
  });

  test("recursively copies directory entries preserving structure", async () => {
    await mkdir(join(workDir, "i18n", "deep"), { recursive: true });
    await writeFile(join(workDir, "i18n", "en.yml"), "hello: ${project.name}\n");
    await writeFile(join(workDir, "i18n", "deep", "fr.yml"), "hi: ${project.name}\n");
    await writeFile(join(workDir, "i18n", "bin.dat"), Buffer.from([0x00, 0xff, 0x42]));
    const project = makeProject(workDir, { "lang/": "./i18n/" });

    await stageResources(project, stagingDir);

    const en = await readFile(join(stagingDir, "lang", "en.yml"), "utf8");
    const fr = await readFile(join(stagingDir, "lang", "deep", "fr.yml"), "utf8");
    const bin = await readFile(join(stagingDir, "lang", "bin.dat"));
    expect(en).toContain("hello: testplugin");
    expect(fr).toContain("hi: testplugin");
    expect(bin.equals(Buffer.from([0x00, 0xff, 0x42]))).toBe(true);
  });

  test("first-declared entry wins on conflict (subsequent skipped with warning)", async () => {
    await writeFile(join(workDir, "first.yml"), "source: first\n");
    await writeFile(join(workDir, "second.yml"), "source: second\n");
    const project = makeProject(workDir, {
      "plugin.yml": "./first.yml",
    });
    // `./plugin.yml` and `plugin.yml` collide after posix.normalize.
    project.resources = {
      "plugin.yml": "./first.yml",
      "./plugin.yml": "./second.yml",
    };

    await stageResources(project, stagingDir);

    const written = await readFile(join(stagingDir, "plugin.yml"), "utf8");
    expect(written).toContain("source: first");
  });

  test("boundary: .md is allowlisted; .class is not", async () => {
    await writeFile(join(workDir, "README.md"), "# ${project.name}\n");
    await writeFile(join(workDir, "X.class"), "${project.name}");
    const project = makeProject(workDir, {
      "README.md": "./README.md",
      "X.class": "./X.class",
    });

    await stageResources(project, stagingDir);

    const md = await readFile(join(stagingDir, "README.md"), "utf8");
    const cls = await readFile(join(stagingDir, "X.class"), "utf8");
    expect(md).toBe("# testplugin\n");
    expect(cls).toBe("${project.name}");
  });

  test("throws if the source path does not exist", async () => {
    const project = makeProject(workDir, { "plugin.yml": "./does-not-exist.yml" });
    await expect(stageResources(project, stagingDir)).rejects.toThrow(/does not exist/);
  });
});
