/** Contract tests for src/resolver/workspace.ts. */

import { join } from "node:path";

import { describe, expect, test } from "vite-plus/test";

import type { ResolvedProject } from "../project.ts";
import type { WorkspaceContext, WorkspaceNode } from "../workspace.ts";

import type { ResolveContext } from "./index.ts";
import { PENDING_BUILD_INTEGRITY, resolveWorkspace } from "./workspace.ts";

function makeNode(name: string, root: string, version: string): WorkspaceNode {
  const project: ResolvedProject = {
    name,
    version,
    main: `com.example.${name}.Plugin`,
    compatibility: { versions: ["1.21.8"], platforms: ["paper"] },
    rootDir: root,
    projectFile: join(root, "project.json"),
  };
  return { name, root, project };
}

function makeContext(workspaces: WorkspaceNode[]): WorkspaceContext {
  const rootProject: ResolvedProject = {
    name: "suite",
    version: "1.0.0",
    compatibility: { versions: ["1.21.8"], platforms: ["paper"] },
    rootDir: "/repo",
    projectFile: "/repo/project.json",
    workspaces: workspaces.map((w) => w.root),
  };
  return {
    root: rootProject,
    atRoot: true,
    current: undefined,
    workspaces,
  };
}

describe("resolveWorkspace", () => {
  test("returns pending-build sentinel and the expected jar path", async () => {
    const node = makeNode("suite-api", "/repo/modules/api", "0.1.0");
    const wsCtx = makeContext([node]);
    const ctx: ResolveContext = {
      rootDir: "/repo",
      includePrerelease: false,
      force: false,
      registries: [],
      workspaceContext: wsCtx,
    };

    const got = await resolveWorkspace("suite-api", "*", ctx);

    expect(got.source).toEqual({ kind: "workspace", name: "suite-api", version: "0.1.0" });
    expect(got.jarPath).toBe(join("/repo/modules/api", "bin", "suite-api-0.1.0.jar"));
    expect(got.integrity).toBe(PENDING_BUILD_INTEGRITY);
    expect(got.transitiveDeps).toEqual([]);
  });

  test("throws when workspaceContext is absent", async () => {
    const ctx: ResolveContext = {
      rootDir: "/repo",
      includePrerelease: false,
      force: false,
      registries: [],
    };

    await expect(resolveWorkspace("any", "*", ctx)).rejects.toThrow(
      /workspace sources require a WorkspaceContext/,
    );
  });

  test("throws when the named workspace is not declared", async () => {
    const node = makeNode("suite-api", "/repo/modules/api", "0.1.0");
    const wsCtx = makeContext([node]);
    const ctx: ResolveContext = {
      rootDir: "/repo",
      includePrerelease: false,
      force: false,
      registries: [],
      workspaceContext: wsCtx,
    };

    await expect(resolveWorkspace("missing", "*", ctx)).rejects.toThrow(
      /workspace not found.*missing/,
    );
  });
});
