/**
 * Contract tests for src/source.ts.
 *
 * Grammar is frozen by docs/SPEC.md §6. These tests are the contract; the
 * implementation must make them pass.
 */

import { describe, expect, test } from "vite-plus/test";

import { parseIdentifier, parseSource, stringifySource } from "./source.ts";

describe("parseSource (project.json long form)", () => {
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

  // Edge case: whitespace anywhere in a long-form source is never legal per
  // §6.1 — none of the grammar productions admit a space. A leading space
  // after the colon is a common copy-paste mistake and must be rejected, not
  // silently accepted as a slug/path with a leading space.
  test("rejects sources containing whitespace", () => {
    expect(() => parseSource("modrinth: worldedit", "7.3.15")).toThrow();
    expect(() => parseSource(" modrinth:worldedit", "7.3.15")).toThrow();
    expect(() => parseSource("modrinth:world edit", "7.3.15")).toThrow();
  });
});

describe("parseIdentifier (CLI form)", () => {
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

  // Edge case: the CLI grammar is "<slug>[@<version>]" — exactly one "@".
  // Choice: reject (do not take-the-last). Reasoning: a version string like
  // "1.0.0@beta" is not part of the spec grammar and silently splitting on
  // the last "@" would hide typos (e.g. "foo@@1.0.0"). Rejecting yields a
  // clearer error message and keeps the grammar unambiguous.
  test("rejects identifiers with multiple @ separators", () => {
    expect(() => parseIdentifier("foo@1.0.0@beta")).toThrow();
  });
});

describe("stringifySource (round trip)", () => {
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

  // Edge case: `file:` paths are the most fragile kind — the <path> production
  // admits essentially anything (absolute, relative, with dots, slashes,
  // spaces if quoted by a caller) and must round-trip byte-for-byte. A naive
  // implementation that e.g. normalizes the path or strips a leading "./"
  // would break persistence. Pin the exact round-trip for a windows-style
  // absolute path and a nested relative path.
  test("file sources round-trip exactly, including awkward paths", () => {
    const absolute = "file:/opt/plugins/lib.jar";
    expect(stringifySource(parseSource(absolute, "1.0.0"))).toBe(absolute);

    const nested = "file:./vendor/a/b/c/lib.jar";
    expect(stringifySource(parseSource(nested, "1.0.0"))).toBe(nested);
  });
});
