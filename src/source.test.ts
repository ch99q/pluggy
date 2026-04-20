/**
 * Contract tests for src/source.ts.
 *
 * Grammar is frozen by docs/SPEC.md §6. These tests are the contract; the
 * implementation must make them pass. `describe.skip(...)` keeps them green
 * while the module is still stubbed — remove the `.skip` when implementing.
 */

import { describe, expect, test } from "vite-plus/test";

import { parseIdentifier, parseSource, stringifySource } from "./source.ts";

describe.skip("parseSource (project.json long form)", () => {
  test("parses modrinth source", () => {
    expect(parseSource("modrinth:worldedit", "7.3.15")).toEqual({
      kind: "modrinth",
      slug: "worldedit",
      version: "7.3.15",
    });
  });

  test("parses maven source", () => {
    expect(parseSource("maven:net.kyori:adventure-api", "4.22.0")).toEqual({
      kind: "maven",
      groupId: "net.kyori",
      artifactId: "adventure-api",
      version: "4.22.0",
    });
  });

  test("parses file source", () => {
    expect(parseSource("file:./libs/foo.jar", "1.0.0")).toEqual({
      kind: "file",
      path: "./libs/foo.jar",
      version: "1.0.0",
    });
  });

  test("parses workspace source", () => {
    expect(parseSource("workspace:my-api", "*")).toEqual({
      kind: "workspace",
      name: "my-api",
      version: "*",
    });
  });

  test("rejects malformed source", () => {
    expect(() => parseSource("bogus", "1.0.0")).toThrow();
    expect(() => parseSource("maven:onlyonecolon", "1.0.0")).toThrow();
  });
});

describe.skip("parseIdentifier (CLI form)", () => {
  test("parses bare modrinth slug (latest)", () => {
    expect(parseIdentifier("worldedit")).toEqual({
      kind: "modrinth",
      slug: "worldedit",
      version: "*",
    });
  });

  test("parses modrinth slug@version", () => {
    expect(parseIdentifier("worldedit@7.3.15")).toEqual({
      kind: "modrinth",
      slug: "worldedit",
      version: "7.3.15",
    });
  });

  test("parses maven CLI form", () => {
    expect(parseIdentifier("maven:net.kyori:adventure-api@4.22.0")).toEqual({
      kind: "maven",
      groupId: "net.kyori",
      artifactId: "adventure-api",
      version: "4.22.0",
    });
  });

  test("parses local .jar path as file source", () => {
    expect(parseIdentifier("./libs/foo.jar")).toEqual({
      kind: "file",
      path: "./libs/foo.jar",
      version: expect.any(String),
    });
  });

  test("parses workspace:<name>", () => {
    expect(parseIdentifier("workspace:my-api")).toEqual({
      kind: "workspace",
      name: "my-api",
      version: "*",
    });
  });
});

describe.skip("stringifySource (round trip)", () => {
  test("round-trips modrinth", () => {
    const input = "modrinth:worldedit";
    expect(stringifySource(parseSource(input, "7.3.15"))).toBe(input);
  });

  test("round-trips maven", () => {
    const input = "maven:net.kyori:adventure-api";
    expect(stringifySource(parseSource(input, "4.22.0"))).toBe(input);
  });

  test("round-trips file", () => {
    const input = "file:./libs/foo.jar";
    expect(stringifySource(parseSource(input, "1.0.0"))).toBe(input);
  });

  test("round-trips workspace", () => {
    const input = "workspace:my-api";
    expect(stringifySource(parseSource(input, "*"))).toBe(input);
  });
});
