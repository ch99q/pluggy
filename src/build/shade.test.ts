/** Tests for src/build/shade.ts. Uses tiny `yazl`-built jar fixtures. */

import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import yazl from "yazl";

import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";

import type { ResolvedDependency } from "../resolver/index.ts";
import { PENDING_BUILD_INTEGRITY } from "../resolver/workspace.ts";

import { applyShading, matches } from "./shade.ts";

async function makeJar(path: string, entries: Record<string, Buffer | string>): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const zip = new yazl.ZipFile();
    const ws = createWriteStream(path);
    ws.once("error", rejectPromise);
    ws.once("close", () => resolvePromise());
    zip.outputStream.pipe(ws);
    for (const [name, content] of Object.entries(entries)) {
      const buf = typeof content === "string" ? Buffer.from(content, "utf8") : content;
      zip.addBuffer(buf, name);
    }
    zip.end();
  });
}

function fakeDep(
  name: string,
  jarPath: string,
  integrity = "sha256-aaa",
  kind: "modrinth" | "maven" | "file" | "workspace" = "modrinth",
): ResolvedDependency {
  switch (kind) {
    case "modrinth":
      return {
        source: { kind: "modrinth", slug: name, version: "1.0.0" },
        jarPath,
        integrity,
        transitiveDeps: [],
      };
    case "maven":
      return {
        source: { kind: "maven", groupId: "com.foo", artifactId: name, version: "1.0.0" },
        jarPath,
        integrity,
        transitiveDeps: [],
      };
    case "file":
      return {
        source: { kind: "file", path: `./libs/${name}.jar`, version: "1.0.0" },
        jarPath,
        integrity,
        transitiveDeps: [],
      };
    case "workspace":
      return {
        source: { kind: "workspace", name, version: "1.0.0" },
        jarPath,
        integrity,
        transitiveDeps: [],
      };
  }
}

describe("matches (glob)", () => {
  test("`**` matches any depth", () => {
    expect(matches("com/library/api/Foo.class", ["com/library/api/**"])).toBe(true);
    expect(matches("com/library/api/sub/Bar.class", ["com/library/api/**"])).toBe(true);
    expect(matches("com/library/other/Bar.class", ["com/library/api/**"])).toBe(false);
  });

  test("`*` matches a single path segment", () => {
    expect(matches("com/library/Foo.class", ["com/library/*.class"])).toBe(true);
    expect(matches("com/library/sub/Foo.class", ["com/library/*.class"])).toBe(false);
  });

  test("returns false when no patterns are provided", () => {
    expect(matches("anything", [])).toBe(false);
  });

  test("literal and `**/` combinations", () => {
    expect(matches("META-INF/MANIFEST.MF", ["META-INF/**"])).toBe(true);
    expect(matches("META-INF/MANIFEST.MF", ["**/MANIFEST.MF"])).toBe(true);
    expect(matches("deep/nested/META-INF/MANIFEST.MF", ["**/MANIFEST.MF"])).toBe(true);
  });
});

describe("applyShading", () => {
  let workDir: string;
  let stagingDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "pluggy-shade-work-"));
    stagingDir = await mkdtemp(join(tmpdir(), "pluggy-shade-stage-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
    await rm(stagingDir, { recursive: true, force: true });
  });

  test("dep without a rule is skipped entirely", async () => {
    const jar = join(workDir, "lib.jar");
    await makeJar(jar, {
      "com/library/api/Foo.class": "foo",
      "com/library/internal/Bar.class": "bar",
    });
    const dep = fakeDep("lib", jar);
    await applyShading([dep], {}, stagingDir);

    await expect(readFile(join(stagingDir, "com/library/api/Foo.class"))).rejects.toThrow();
  });

  test("include patterns pull in matching entries", async () => {
    const jar = join(workDir, "lib.jar");
    await makeJar(jar, {
      "com/library/api/Foo.class": "foo",
      "com/library/api/util/Bar.class": "bar",
      "com/library/internal/Hidden.class": "hidden",
    });
    const dep = fakeDep("lib", jar);

    await applyShading([dep], { lib: { include: ["com/library/api/**"] } }, stagingDir);

    const foo = await readFile(join(stagingDir, "com/library/api/Foo.class"), "utf8");
    const bar = await readFile(join(stagingDir, "com/library/api/util/Bar.class"), "utf8");
    expect(foo).toBe("foo");
    expect(bar).toBe("bar");
    await expect(readFile(join(stagingDir, "com/library/internal/Hidden.class"))).rejects.toThrow();
  });

  test("exclude patterns subtract from includes", async () => {
    const jar = join(workDir, "lib.jar");
    await makeJar(jar, {
      "com/library/api/Foo.class": "foo",
      "com/library/api/internal/Bar.class": "bar",
    });
    const dep = fakeDep("lib", jar);

    await applyShading(
      [dep],
      {
        lib: {
          include: ["com/library/api/**"],
          exclude: ["com/library/api/internal/**"],
        },
      },
      stagingDir,
    );

    const foo = await readFile(join(stagingDir, "com/library/api/Foo.class"), "utf8");
    expect(foo).toBe("foo");
    await expect(
      readFile(join(stagingDir, "com/library/api/internal/Bar.class")),
    ).rejects.toThrow();
  });

  test("looks up rules by source-kind-specific name", async () => {
    const jar = join(workDir, "adventure.jar");
    await makeJar(jar, { "net/kyori/adventure/Foo.class": "foo" });

    const mavenDep = fakeDep("adventure-api", jar, "sha256-x", "maven");
    await applyShading([mavenDep], { "adventure-api": { include: ["**"] } }, stagingDir);
    const foo = await readFile(join(stagingDir, "net/kyori/adventure/Foo.class"), "utf8");
    expect(foo).toBe("foo");
  });

  test("workspace sentinel integrity throws if jar is not yet built", async () => {
    const missing = join(workDir, "not-built.jar");
    const dep = fakeDep("suite-api", missing, PENDING_BUILD_INTEGRITY, "workspace");

    await expect(
      applyShading([dep], { "suite-api": { include: ["**"] } }, stagingDir),
    ).rejects.toThrow(/not been built yet/);
  });

  test("throws cleanly when a non-sentinel dep jar is missing", async () => {
    const missing = join(workDir, "gone.jar");
    const dep = fakeDep("gone", missing);
    await expect(applyShading([dep], { gone: { include: ["**"] } }, stagingDir)).rejects.toThrow(
      /jar not found/,
    );
  });
});
