/**
 * Contract tests for src/workspace.ts.
 *
 * See docs/SPEC.md §1.8. `describe.skip` keeps these dormant while the
 * module is stubbed — remove the `.skip` when implementing.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";

import { resolveWorkspaceContext, topologicalOrder } from "./workspace.ts";

describe.skip("resolveWorkspaceContext", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "pluggy-ws-"));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  test("standalone project: atRoot=true, no workspaces", async () => {
    await writeFile(
      join(rootDir, "project.json"),
      JSON.stringify({
        name: "standalone",
        version: "1.0.0",
        main: "com.example.Plugin",
        compatibility: { versions: ["1.21.8"], platforms: ["paper"] },
      }),
    );

    const ctx = resolveWorkspaceContext(rootDir);
    expect(ctx).toBeDefined();
    expect(ctx!.atRoot).toBe(true);
    expect(ctx!.workspaces).toEqual([]);
    expect(ctx!.current).toBeUndefined();
  });

  test("root with workspaces: atRoot=true at root, current set inside a workspace", async () => {
    await mkdir(join(rootDir, "modules", "api"), { recursive: true });
    await writeFile(
      join(rootDir, "project.json"),
      JSON.stringify({
        name: "suite",
        version: "1.0.0",
        compatibility: { versions: ["1.21.8"], platforms: ["paper"] },
        workspaces: ["./modules/api"],
      }),
    );
    await writeFile(
      join(rootDir, "modules", "api", "project.json"),
      JSON.stringify({
        name: "suite-api",
        version: "0.1.0",
        main: "com.example.api.Plugin",
      }),
    );

    const atRoot = resolveWorkspaceContext(rootDir);
    expect(atRoot!.atRoot).toBe(true);
    expect(atRoot!.workspaces).toHaveLength(1);
    expect(atRoot!.workspaces[0].name).toBe("suite-api");

    const inside = resolveWorkspaceContext(join(rootDir, "modules", "api"));
    expect(inside!.atRoot).toBe(false);
    expect(inside!.current?.name).toBe("suite-api");
  });

  test("workspace inherits compatibility from root when missing", async () => {
    await mkdir(join(rootDir, "modules", "api"), { recursive: true });
    await writeFile(
      join(rootDir, "project.json"),
      JSON.stringify({
        name: "suite",
        version: "1.0.0",
        compatibility: { versions: ["1.21.8"], platforms: ["paper"] },
        workspaces: ["./modules/api"],
      }),
    );
    await writeFile(
      join(rootDir, "modules", "api", "project.json"),
      JSON.stringify({
        name: "suite-api",
        version: "0.1.0",
        main: "com.example.api.Plugin",
      }),
    );

    const ctx = resolveWorkspaceContext(rootDir);
    expect(ctx!.workspaces[0].project.compatibility).toEqual({
      versions: ["1.21.8"],
      platforms: ["paper"],
    });
  });

  test("returns undefined when cwd is not inside any project", async () => {
    expect(resolveWorkspaceContext(rootDir)).toBeUndefined();
  });
});

describe.skip("topologicalOrder", () => {
  test("orders dependent workspaces after their dependencies", () => {
    // Minimal shape: api has no deps; impl depends on api.
    // Implementation should return [api, impl].
    expect(() =>
      topologicalOrder([
        /* shape TBD by implementation */
      ]),
    ).not.toThrow();
  });

  test("throws on cycles", () => {
    expect(() => topologicalOrder([])).toBeDefined();
  });
});
