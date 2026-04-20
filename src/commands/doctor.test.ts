/**
 * Tests for src/commands/doctor.ts. External-effect checks (java spawn,
 * HEAD requests, cache stat) are replaced via the `checks` hook.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import type { ResolvedProject } from "../project.ts";

import {
  checkDescriptors,
  checkProjectValid,
  checkWorkspaceGraph,
  type CheckResult,
  type DoctorCommandOptions,
  runDoctorCommand,
} from "./doctor.ts";
import { resolveWorkspaceContext } from "../workspace.ts";

function passingHooks(): DoctorCommandOptions["checks"] {
  const pass = (id: string, label: string): CheckResult => ({
    id,
    label,
    status: "pass",
    detail: "ok",
  });
  return {
    java: async () => pass("java", "Java toolchain"),
    cache: async () => pass("cache", "Cache reachability"),
    registries: async () => [pass("registry", "Registries")],
    project: () => pass("project", "project.json"),
    workspace: () => pass("workspace", "Workspace graph"),
    descriptor: () => [pass("descriptor", "Descriptor family")],
    outdated: async () => pass("outdated", "Outdated dependencies"),
  };
}

describe("runDoctorCommand", () => {
  let rootDir: string;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "pluggy-doctor-"));
    stdoutSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await writeFile(
      join(rootDir, "project.json"),
      JSON.stringify({
        name: "valid",
        version: "1.0.0",
        main: "com.example.Main",
        compatibility: { versions: ["1.21.8"], platforms: ["paper"] },
      }),
    );
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    vi.restoreAllMocks();
  });

  test("all checks pass → exitCode 0, ok=true", async () => {
    const res = await runDoctorCommand({ cwd: rootDir, checks: passingHooks() });
    expect(res.ok).toBe(true);
    expect(res.exitCode).toBe(0);
    expect(res.checks.length).toBeGreaterThan(0);
    for (const c of res.checks) {
      expect(c.status).toBe("pass");
    }
  });

  test("one fail → exitCode 1, result contains the failure", async () => {
    const hooks = passingHooks()!;
    hooks.java = async () => ({
      id: "java",
      label: "Java toolchain",
      status: "fail",
      detail: "not found",
    });

    const res = await runDoctorCommand({ cwd: rootDir, checks: hooks });
    expect(res.ok).toBe(false);
    expect(res.exitCode).toBe(1);
    const fails = res.checks.filter((c) => c.status === "fail");
    expect(fails).toHaveLength(1);
    expect(fails[0].id).toBe("java");
  });

  test("warn does not fail the overall result", async () => {
    const hooks = passingHooks()!;
    hooks.outdated = async () => ({
      id: "outdated",
      label: "Outdated deps",
      status: "warn",
      detail: "(not yet implemented)",
    });
    const res = await runDoctorCommand({ cwd: rootDir, checks: hooks });
    expect(res.ok).toBe(true);
    expect(res.exitCode).toBe(0);
  });

  test("JSON mode, success: single JSON blob on stdout", async () => {
    await runDoctorCommand({ cwd: rootDir, json: true, checks: passingHooks() });
    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
    expect(parsed.ok).toBe(true);
    expect(Array.isArray(parsed.checks)).toBe(true);
    expect(parsed.failures).toEqual([]);
  });

  test("JSON mode, failure: JSON blob on stderr with failures[]", async () => {
    const hooks = passingHooks()!;
    hooks.java = async () => ({
      id: "java",
      label: "Java toolchain",
      status: "fail",
      detail: "not found",
    });
    const res = await runDoctorCommand({ cwd: rootDir, json: true, checks: hooks });
    expect(res.ok).toBe(false);
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(stderrSpy.mock.calls[0][0] as string);
    expect(parsed.ok).toBe(false);
    expect(parsed.failures).toHaveLength(1);
    expect(parsed.failures[0].id).toBe("java");
  });

  test("throws if not inside a pluggy project", async () => {
    const empty = await mkdtemp(join(tmpdir(), "pluggy-doctor-empty-"));
    try {
      await expect(runDoctorCommand({ cwd: empty })).rejects.toThrow(/No pluggy project found/);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});

describe("checkProjectValid", () => {
  function makeProject(overrides: Partial<ResolvedProject> = {}): ResolvedProject {
    return {
      name: "goodname",
      version: "1.0.0",
      main: "com.example.Main",
      compatibility: { versions: ["1.21.8"], platforms: ["paper"] },
      rootDir: "/tmp/x",
      projectFile: "/tmp/x/project.json",
      ...overrides,
    };
  }

  test("valid project passes", () => {
    const r = checkProjectValid(makeProject());
    expect(r.status).toBe("pass");
  });

  test("missing name → fail, names the field", () => {
    const r = checkProjectValid(makeProject({ name: undefined as unknown as string }));
    expect(r.status).toBe("fail");
    expect(r.detail).toMatch(/name/);
  });

  test("bad version → fail, names the field", () => {
    const r = checkProjectValid(makeProject({ version: "not-semver" }));
    expect(r.status).toBe("fail");
    expect(r.detail).toMatch(/version/);
  });

  test("unknown platform → fail, names the platform", () => {
    const r = checkProjectValid(
      makeProject({ compatibility: { versions: ["1.21.8"], platforms: ["not-a-platform"] } }),
    );
    expect(r.status).toBe("fail");
    expect(r.detail).toMatch(/not-a-platform/);
  });
});

describe("checkWorkspaceGraph", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "pluggy-doctor-ws-"));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  test("standalone passes", async () => {
    await writeFile(
      join(rootDir, "project.json"),
      JSON.stringify({
        name: "solo",
        version: "1.0.0",
        main: "com.example.Main",
        compatibility: { versions: ["1.21.8"], platforms: ["paper"] },
      }),
    );
    const ctx = resolveWorkspaceContext(rootDir)!;
    expect(checkWorkspaceGraph(ctx).status).toBe("pass");
  });

  test("cycle is detected as a failure", async () => {
    await mkdir(join(rootDir, "modules", "a"), { recursive: true });
    await mkdir(join(rootDir, "modules", "b"), { recursive: true });
    await writeFile(
      join(rootDir, "project.json"),
      JSON.stringify({
        name: "r",
        version: "1.0.0",
        compatibility: { versions: ["1.21.8"], platforms: ["paper"] },
        workspaces: ["./modules/a", "./modules/b"],
      }),
    );
    await writeFile(
      join(rootDir, "modules", "a", "project.json"),
      JSON.stringify({
        name: "a",
        version: "0.1.0",
        main: "a.M",
        dependencies: { b: { source: "workspace:b", version: "*" } },
      }),
    );
    await writeFile(
      join(rootDir, "modules", "b", "project.json"),
      JSON.stringify({
        name: "b",
        version: "0.1.0",
        main: "b.M",
        dependencies: { a: { source: "workspace:a", version: "*" } },
      }),
    );
    const ctx = resolveWorkspaceContext(rootDir)!;
    const r = checkWorkspaceGraph(ctx);
    expect(r.status).toBe("fail");
    expect(r.detail).toMatch(/cycle/);
  });
});

describe("checkDescriptors", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "pluggy-doctor-desc-"));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  test("standalone with consistent platform family passes", async () => {
    await writeFile(
      join(rootDir, "project.json"),
      JSON.stringify({
        name: "solo",
        version: "1.0.0",
        main: "com.example.Main",
        compatibility: { versions: ["1.21.8"], platforms: ["paper"] },
      }),
    );
    const ctx = resolveWorkspaceContext(rootDir)!;
    const results = checkDescriptors(ctx);
    expect(results.every((r) => r.status === "pass")).toBe(true);
  });

  test("cross-family platform declaration → fail", async () => {
    await writeFile(
      join(rootDir, "project.json"),
      JSON.stringify({
        name: "solo",
        version: "1.0.0",
        main: "com.example.Main",
        compatibility: { versions: ["1.21.8"], platforms: ["paper", "velocity"] },
      }),
    );
    const ctx = resolveWorkspaceContext(rootDir)!;
    const results = checkDescriptors(ctx);
    const failing = results.filter((r) => r.status === "fail");
    expect(failing.length).toBeGreaterThan(0);
    expect(failing[0].detail).toMatch(/different descriptor families|family/);
  });
});
