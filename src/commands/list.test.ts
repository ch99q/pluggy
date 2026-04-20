/** Tests for src/commands/list.ts. Uses a tmpdir-backed project tree. */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { doList } from "./list.ts";

const origLog = console.log;
const origWarn = console.warn;
beforeEach(() => {
  console.log = () => {};
  console.warn = () => {};
});
afterEach(() => {
  console.log = origLog;
  console.warn = origWarn;
  vi.unstubAllGlobals();
});

describe("doList — standalone", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "pluggy-list-std-"));
  });
  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  test("lists deps from a standalone project with declared + resolved versions", async () => {
    await writeFile(
      join(rootDir, "project.json"),
      JSON.stringify({
        name: "my_plugin",
        version: "1.0.0",
        main: "com.example.Plugin",
        compatibility: { versions: ["1.21.8"], platforms: ["paper"] },
        dependencies: {
          worldedit: "7.3.15",
          customlib: { source: "file:./libs/custom.jar", version: "1.0.0" },
        },
        registries: [
          "https://repo1.maven.org/maven2/",
          {
            url: "https://private.example.com/maven",
            credentials: { username: "u", password: "p" },
          },
        ],
      }),
    );
    await writeFile(
      join(rootDir, "pluggy.lock"),
      JSON.stringify({
        version: 1,
        entries: {
          worldedit: {
            source: { kind: "modrinth", slug: "worldedit", version: "7.3.15" },
            resolvedVersion: "7.3.15",
            integrity: "sha256-abc",
            declaredBy: ["my_plugin"],
          },
        },
      }),
    );

    const result = await doList({ cwd: rootDir, json: true });
    expect(result.scope).toBe("standalone");
    expect(result.deps).toHaveLength(2);

    const byName = Object.fromEntries(result.deps.map((d) => [d.name, d]));
    expect(byName.worldedit.resolvedVersion).toBe("7.3.15");
    expect(byName.worldedit.source.kind).toBe("modrinth");
    expect(byName.customlib.resolvedVersion).toBeNull();
    expect(byName.customlib.source.kind).toBe("file");

    expect(result.registries).toHaveLength(2);
    const authRegistry = result.registries.find((r) => r.url.includes("private"))!;
    expect(authRegistry.authenticated).toBe(true);
    // Credentials must be elided — JSON output feeds CI logs.
    expect(JSON.stringify(result.registries)).not.toContain("password");
    expect(JSON.stringify(result.registries)).not.toContain("secret");
  });

  test("handles empty dependencies gracefully", async () => {
    await writeFile(
      join(rootDir, "project.json"),
      JSON.stringify({
        name: "my_plugin",
        version: "1.0.0",
        main: "com.example.Plugin",
        compatibility: { versions: ["1.21.8"], platforms: ["paper"] },
      }),
    );
    const result = await doList({ cwd: rootDir, json: true });
    expect(result.deps).toEqual([]);
  });
});

describe("doList — root with workspaces", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "pluggy-list-root-"));
    await mkdir(join(rootDir, "modules", "api"), { recursive: true });
    await mkdir(join(rootDir, "modules", "impl"), { recursive: true });
    await writeFile(
      join(rootDir, "project.json"),
      JSON.stringify({
        name: "suite",
        version: "1.0.0",
        compatibility: { versions: ["1.21.8"], platforms: ["paper"] },
        workspaces: ["./modules/api", "./modules/impl"],
      }),
    );
    await writeFile(
      join(rootDir, "modules", "api", "project.json"),
      JSON.stringify({
        name: "suite-api",
        version: "0.1.0",
        main: "com.example.api.Plugin",
        dependencies: { placeholderapi: "2.11.6" },
      }),
    );
    await writeFile(
      join(rootDir, "modules", "impl", "project.json"),
      JSON.stringify({
        name: "suite-impl",
        version: "0.1.0",
        main: "com.example.impl.Plugin",
        dependencies: { placeholderapi: "2.11.6", worldedit: "7.3.15" },
      }),
    );
  });
  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  test("at root: aggregates across all workspaces and tracks declaredBy", async () => {
    const result = await doList({ cwd: rootDir, json: true });
    expect(result.scope).toBe("root");
    expect(result.deps.map((d) => d.name).sort()).toEqual(["placeholderapi", "worldedit"]);

    const placeholder = result.deps.find((d) => d.name === "placeholderapi")!;
    expect(placeholder.declaredBy.sort()).toEqual(["suite-api", "suite-impl"]);
    const worldedit = result.deps.find((d) => d.name === "worldedit")!;
    expect(worldedit.declaredBy).toEqual(["suite-impl"]);
  });

  test("--workspace <name> narrows to a single workspace", async () => {
    const result = await doList({ cwd: rootDir, workspace: "suite-api", json: true });
    expect(result.scope).toBe("workspace");
    expect(result.deps.map((d) => d.name)).toEqual(["placeholderapi"]);
  });

  test("inside a workspace, defaults to that workspace's deps only", async () => {
    const insideCwd = join(rootDir, "modules", "impl");
    const result = await doList({ cwd: insideCwd, json: true });
    expect(result.scope).toBe("workspace");
    expect(result.deps.map((d) => d.name).sort()).toEqual(["placeholderapi", "worldedit"]);
  });
});

describe("doList — flag placeholders", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "pluggy-list-flags-"));
    await writeFile(
      join(rootDir, "project.json"),
      JSON.stringify({
        name: "my_plugin",
        version: "1.0.0",
        main: "com.example.Plugin",
        compatibility: { versions: ["1.21.8"], platforms: ["paper"] },
        dependencies: { worldedit: "7.3.15" },
      }),
    );
  });
  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  test("--outdated does not crash and returns the same deps", async () => {
    const result = await doList({ cwd: rootDir, outdated: true, json: true });
    expect(result.deps).toHaveLength(1);
  });

  test("--tree does not crash and returns the same deps", async () => {
    const result = await doList({ cwd: rootDir, tree: true, json: true });
    expect(result.deps).toHaveLength(1);
  });
});
