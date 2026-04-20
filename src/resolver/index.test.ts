/** Contract tests for the resolver dispatcher. */

import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import type { ResolvedSource } from "../source.ts";

vi.mock("./modrinth.ts", () => ({
  resolveModrinth: vi.fn(),
}));
vi.mock("./maven.ts", () => ({
  resolveMaven: vi.fn(),
}));
vi.mock("./file.ts", () => ({
  resolveFile: vi.fn(),
}));
vi.mock("./workspace.ts", () => ({
  resolveWorkspace: vi.fn(),
  PENDING_BUILD_INTEGRITY: "sha256-pending-build",
}));

import { resolveDependency, type ResolveContext, type ResolvedDependency } from "./index.ts";
import { resolveFile } from "./file.ts";
import { resolveMaven } from "./maven.ts";
import { resolveModrinth } from "./modrinth.ts";
import { resolveWorkspace } from "./workspace.ts";

const ctx: ResolveContext = {
  rootDir: "/tmp/project",
  includePrerelease: false,
  force: false,
  registries: [],
};

function makeDependency(source: ResolvedSource): ResolvedDependency {
  return {
    source,
    jarPath: "/cache/fake.jar",
    integrity: "sha256-aaa",
    transitiveDeps: [],
  };
}

describe("resolveDependency dispatcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("dispatches modrinth sources to resolveModrinth", async () => {
    const source: ResolvedSource = { kind: "modrinth", slug: "worldedit", version: "1.2.3" };
    const expected = makeDependency(source);
    vi.mocked(resolveModrinth).mockResolvedValue(expected);

    const got = await resolveDependency(source, ctx);

    expect(resolveModrinth).toHaveBeenCalledOnce();
    expect(resolveModrinth).toHaveBeenCalledWith("worldedit", "1.2.3", ctx);
    expect(resolveMaven).not.toHaveBeenCalled();
    expect(resolveFile).not.toHaveBeenCalled();
    expect(resolveWorkspace).not.toHaveBeenCalled();
    expect(got).toBe(expected);
  });

  test("dispatches maven sources to resolveMaven", async () => {
    const source: ResolvedSource = {
      kind: "maven",
      groupId: "com.foo",
      artifactId: "bar",
      version: "1.0.0",
    };
    const expected = makeDependency(source);
    vi.mocked(resolveMaven).mockResolvedValue(expected);

    const got = await resolveDependency(source, ctx);

    expect(resolveMaven).toHaveBeenCalledOnce();
    expect(resolveMaven).toHaveBeenCalledWith("com.foo", "bar", "1.0.0", ctx);
    expect(got).toBe(expected);
  });

  test("dispatches file sources to resolveFile", async () => {
    const source: ResolvedSource = { kind: "file", path: "./libs/foo.jar", version: "*" };
    const expected = makeDependency(source);
    vi.mocked(resolveFile).mockResolvedValue(expected);

    const got = await resolveDependency(source, ctx);

    expect(resolveFile).toHaveBeenCalledOnce();
    expect(resolveFile).toHaveBeenCalledWith("./libs/foo.jar", "*", ctx);
    expect(got).toBe(expected);
  });

  test("dispatches workspace sources to resolveWorkspace", async () => {
    const source: ResolvedSource = { kind: "workspace", name: "api", version: "*" };
    const expected = makeDependency(source);
    vi.mocked(resolveWorkspace).mockResolvedValue(expected);

    const got = await resolveDependency(source, ctx);

    expect(resolveWorkspace).toHaveBeenCalledOnce();
    expect(resolveWorkspace).toHaveBeenCalledWith("api", "*", ctx);
    expect(got).toBe(expected);
  });

  test("propagates errors from per-kind resolvers", async () => {
    const source: ResolvedSource = { kind: "modrinth", slug: "nope", version: "*" };
    vi.mocked(resolveModrinth).mockRejectedValue(new Error("boom"));
    await expect(resolveDependency(source, ctx)).rejects.toThrow("boom");
  });
});
