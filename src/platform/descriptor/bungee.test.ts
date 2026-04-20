/**
 * Contract tests for the BungeeCord-family descriptor generator. Shares
 * Bukkit's YAML flavor but emits a singular `author` string, not a list.
 */

import { describe, expect, test } from "vite-plus/test";

import type { ResolvedProject } from "../../project.ts";

import { bungeeDescriptor } from "./bungee.ts";

function project(overrides: Partial<ResolvedProject> = {}): ResolvedProject {
  return {
    name: "MyProxy",
    version: "1.0.0",
    main: "com.example.MyProxy",
    compatibility: { versions: ["1.21.8"], platforms: ["waterfall"] },
    rootDir: "/tmp/project",
    projectFile: "/tmp/project/project.json",
    ...overrides,
  };
}

function parseDescriptor(yaml: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of yaml.split("\n")) {
    if (line.length === 0) continue;
    const colonIdx = line.indexOf(":");
    const key = line.slice(0, colonIdx);
    const rest = line.slice(colonIdx + 1).trimStart();
    if (rest.startsWith('"') && rest.endsWith('"')) {
      result[key] = JSON.parse(rest);
    } else {
      result[key] = rest;
    }
  }
  return result;
}

describe("bungeeDescriptor.generate", () => {
  test("emits required fields for a minimal project", () => {
    const output = bungeeDescriptor.generate(project());
    const parsed = parseDescriptor(output);
    expect(parsed.name).toBe("MyProxy");
    expect(parsed.version).toBe("1.0.0");
    expect(parsed.main).toBe("com.example.MyProxy");
    expect(output.endsWith("\n")).toBe(true);
  });

  test("emits singular author as a string (single author)", () => {
    const output = bungeeDescriptor.generate(project({ authors: ["Alice"] }));
    const parsed = parseDescriptor(output);
    expect(parsed.author).toBe("Alice");
    expect(output).not.toContain("authors:");
  });

  test("joins multiple authors with a comma-space into a single string", () => {
    const output = bungeeDescriptor.generate(project({ authors: ["Alice", "Bob", "Carol"] }));
    const parsed = parseDescriptor(output);
    expect(parsed.author).toBe("Alice, Bob, Carol");
  });

  test("omits author when the list is empty or absent", () => {
    expect(bungeeDescriptor.generate(project())).not.toContain("author");
    expect(bungeeDescriptor.generate(project({ authors: [] }))).not.toContain("author");
  });

  test("emits description when present, omits when absent", () => {
    const withDesc = bungeeDescriptor.generate(project({ description: "a proxy plugin" }));
    expect(parseDescriptor(withDesc).description).toBe("a proxy plugin");
    expect(bungeeDescriptor.generate(project())).not.toContain("description:");
  });

  test("throws when main is missing", () => {
    expect(() => bungeeDescriptor.generate(project({ main: undefined }))).toThrow(
      "BungeeCord descriptor requires project.main",
    );
  });

  test("uses LF line endings only", () => {
    const output = bungeeDescriptor.generate(project({ description: "x", authors: ["A", "B"] }));
    expect(output.split("\r\n").length).toBe(1);
  });

  test("joined multi-author strings emit bare (no reserved chars, no colon)", () => {
    const output = bungeeDescriptor.generate(project({ authors: ["Alice", "Bob"] }));
    expect(output).toContain("author: Alice, Bob\n");
  });
});
