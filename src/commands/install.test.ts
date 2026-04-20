/**
 * Tests for src/commands/install.ts.
 *
 * Approach: the resolver is network-dependent, so every test mocks
 * `resolveDependency`. Workspace discovery, project parsing, and the lockfile
 * are real (tmpdir-backed).
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

vi.mock("../resolver/index.ts", () => ({
  resolveDependency: vi.fn(),
}));

import { readLock } from "../lockfile.ts";
import { resolveDependency } from "../resolver/index.ts";

import { doInstall } from "./install.ts";

const mockedResolveDependency = vi.mocked(resolveDependency);

type MinimalResolved = Awaited<ReturnType<typeof resolveDependency>>;

function makeResolved(overrides: Partial<MinimalResolved>): MinimalResolved {
  return {
    source: { kind: "modrinth", slug: "worldedit", version: "7.3.15" },
    jarPath: "/tmp/fake.jar",
    integrity: "sha256-abc",
    transitiveDeps: [],
    ...overrides,
  } as MinimalResolved;
}

describe("doInstall: no plugin argument", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pluggy-install-test-"));
    mockedResolveDependency.mockReset();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("standalone, no lockfile → resolves every declared dep and writes the lockfile", async () => {
    await writeFile(
      join(dir, "project.json"),
      JSON.stringify({
        name: "demo",
        version: "1.0.0",
        main: "com.example.Main",
        compatibility: { versions: ["1.21.8"], platforms: ["paper"] },
        dependencies: { worldedit: "7.3.15" },
      }),
    );

    mockedResolveDependency.mockImplementation(async (source) =>
      makeResolved({ source, integrity: "sha256-abc" }),
    );

    const result = await doInstall({ cwd: dir });
    expect(result.installed).toEqual(["worldedit"]);
    expect(mockedResolveDependency).toHaveBeenCalledTimes(1);

    const lock = readLock(dir);
    expect(lock?.entries.worldedit).toBeDefined();
    expect(lock?.entries.worldedit.integrity).toBe("sha256-abc");
    expect(lock?.entries.worldedit.declaredBy).toEqual(["demo"]);
  });

  test("standalone, fresh lockfile, no --force → no-op skip", async () => {
    await writeFile(
      join(dir, "project.json"),
      JSON.stringify({
        name: "demo",
        version: "1.0.0",
        main: "com.example.Main",
        compatibility: { versions: ["1.21.8"], platforms: ["paper"] },
        dependencies: { worldedit: "7.3.15" },
      }),
    );
    await writeFile(
      join(dir, "pluggy.lock"),
      `${JSON.stringify(
        {
          version: 1,
          entries: {
            worldedit: {
              source: { kind: "modrinth", slug: "worldedit", version: "7.3.15" },
              resolvedVersion: "7.3.15",
              integrity: "sha256-abc",
              declaredBy: ["demo"],
            },
          },
        },
        null,
        2,
      )}\n`,
    );

    const result = await doInstall({ cwd: dir });
    expect(result.installed).toEqual([]);
    expect(result.skipped).toEqual(["worldedit"]);
    expect(mockedResolveDependency).not.toHaveBeenCalled();
  });

  test("dirty lockfile → resolver runs for drifted names only", async () => {
    await writeFile(
      join(dir, "project.json"),
      JSON.stringify({
        name: "demo",
        version: "1.0.0",
        main: "com.example.Main",
        compatibility: { versions: ["1.21.8"], platforms: ["paper"] },
        dependencies: { worldedit: "7.3.15", otherdep: "1.0.0" },
      }),
    );
    // Lock matches one dep but not the other.
    await writeFile(
      join(dir, "pluggy.lock"),
      `${JSON.stringify(
        {
          version: 1,
          entries: {
            worldedit: {
              source: { kind: "modrinth", slug: "worldedit", version: "7.3.15" },
              resolvedVersion: "7.3.15",
              integrity: "sha256-abc",
              declaredBy: ["demo"],
            },
          },
        },
        null,
        2,
      )}\n`,
    );

    mockedResolveDependency.mockImplementation(async (source) =>
      makeResolved({ source, integrity: "sha256-new" }),
    );

    const result = await doInstall({ cwd: dir });
    expect(result.installed).toEqual(["otherdep"]);
    expect(result.skipped).toEqual(["worldedit"]);
    expect(mockedResolveDependency).toHaveBeenCalledTimes(1);

    const lock = readLock(dir);
    expect(lock?.entries.otherdep).toBeDefined();
    expect(lock?.entries.worldedit.integrity).toBe("sha256-abc");
  });

  test("--force re-resolves even when fresh", async () => {
    await writeFile(
      join(dir, "project.json"),
      JSON.stringify({
        name: "demo",
        version: "1.0.0",
        main: "com.example.Main",
        compatibility: { versions: ["1.21.8"], platforms: ["paper"] },
        dependencies: { worldedit: "7.3.15" },
      }),
    );
    await writeFile(
      join(dir, "pluggy.lock"),
      `${JSON.stringify(
        {
          version: 1,
          entries: {
            worldedit: {
              source: { kind: "modrinth", slug: "worldedit", version: "7.3.15" },
              resolvedVersion: "7.3.15",
              integrity: "sha256-abc",
              declaredBy: ["demo"],
            },
          },
        },
        null,
        2,
      )}\n`,
    );

    mockedResolveDependency.mockImplementation(async (source) =>
      makeResolved({ source, integrity: "sha256-fresh" }),
    );

    const result = await doInstall({ cwd: dir, force: true });
    expect(result.installed).toEqual(["worldedit"]);
    expect(mockedResolveDependency).toHaveBeenCalledTimes(1);
    const lock = readLock(dir);
    expect(lock?.entries.worldedit.integrity).toBe("sha256-fresh");
  });

  test("errors when no project is found at or above cwd", async () => {
    // `dir` is a bare tmpdir with no project.json, no ancestor project.
    await expect(doInstall({ cwd: dir })).rejects.toThrow(/no pluggy project found/);
  });
});

describe("doInstall: with a plugin argument", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pluggy-install-single-"));
    mockedResolveDependency.mockReset();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("parses identifier, resolves, writes project.json and lockfile", async () => {
    await writeFile(
      join(dir, "project.json"),
      JSON.stringify({
        name: "demo",
        version: "1.0.0",
        main: "com.example.Main",
        compatibility: { versions: ["1.21.8"], platforms: ["paper"] },
      }),
    );

    mockedResolveDependency.mockImplementation(async () =>
      makeResolved({ source: { kind: "modrinth", slug: "worldedit", version: "7.3.15" } }),
    );

    const result = await doInstall({ cwd: dir, plugin: "worldedit@7.3.15" });
    expect(result.added).toEqual({ name: "worldedit", workspace: "demo" });

    const project = JSON.parse(await readFile(join(dir, "project.json"), "utf8"));
    expect(project.dependencies.worldedit).toEqual({
      source: "modrinth:worldedit",
      version: "7.3.15",
    });

    const lock = readLock(dir);
    expect(lock?.entries.worldedit).toBeDefined();
    expect(lock?.entries.worldedit.declaredBy).toContain("demo");
  });

  test("throws InvalidArgumentError for a malformed identifier", async () => {
    await writeFile(
      join(dir, "project.json"),
      JSON.stringify({
        name: "demo",
        version: "1.0.0",
        main: "com.example.Main",
        compatibility: { versions: ["1.21.8"], platforms: ["paper"] },
      }),
    );
    await expect(doInstall({ cwd: dir, plugin: "worldedit@@broken" })).rejects.toThrow(
      /multiple "@"|Invalid identifier/,
    );
  });
});
