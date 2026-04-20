/**
 * Contract tests for the Velocity descriptor generator. Output is JSON, so
 * tests parse with `JSON.parse` and assert on shape.
 */

import { describe, expect, test } from "vite-plus/test";

import type { ResolvedProject } from "../../project.ts";

import { deriveVelocityId, velocityDescriptor } from "./velocity.ts";

function project(overrides: Partial<ResolvedProject> = {}): ResolvedProject {
  return {
    name: "myproxy",
    version: "1.0.0",
    main: "com.example.MyProxy",
    compatibility: { versions: ["1.21.8"], platforms: ["velocity"] },
    rootDir: "/tmp/project",
    projectFile: "/tmp/project/project.json",
    ...overrides,
  };
}

describe("velocityDescriptor.generate", () => {
  test("emits required fields for a minimal project", () => {
    const output = velocityDescriptor.generate(project());
    const parsed = JSON.parse(output);
    expect(parsed).toMatchObject({
      id: "myproxy",
      name: "myproxy",
      version: "1.0.0",
      main: "com.example.MyProxy",
    });
    expect(parsed.description).toBeUndefined();
    expect(parsed.authors).toBeUndefined();
    expect(output.endsWith("\n")).toBe(true);
  });

  test("emits all optional fields when present", () => {
    const output = velocityDescriptor.generate(
      project({
        description: "A velocity plugin.",
        authors: ["Alice", "Bob"],
      }),
    );
    const parsed = JSON.parse(output);
    expect(parsed.description).toBe("A velocity plugin.");
    expect(parsed.authors).toEqual(["Alice", "Bob"]);
  });

  test("throws when main is missing", () => {
    expect(() => velocityDescriptor.generate(project({ main: undefined }))).toThrow(
      "Velocity descriptor requires project.main",
    );
  });

  test("uses LF line endings only", () => {
    const output = velocityDescriptor.generate(project({ description: "x", authors: ["A"] }));
    expect(output.split("\r\n").length).toBe(1);
  });

  test("output is valid JSON", () => {
    const output = velocityDescriptor.generate(project({ authors: ["A"] }));
    expect(() => JSON.parse(output)).not.toThrow();
  });
});

describe("deriveVelocityId", () => {
  test("lowercases a plain name", () => {
    expect(deriveVelocityId("MyPlugin")).toBe("myplugin");
  });

  test("replaces disallowed characters with hyphens", () => {
    expect(deriveVelocityId("My Plugin!")).toBe("my-plugin-");
  });

  test("keeps hyphens and underscores as-is", () => {
    expect(deriveVelocityId("my_cool-plugin")).toBe("my_cool-plugin");
  });

  test("prefixes with 'p-' when the result starts with a digit", () => {
    expect(deriveVelocityId("1plugin")).toBe("p-1plugin");
  });

  test("prefixes with 'p-' when the result starts with a hyphen", () => {
    expect(deriveVelocityId("-leading")).toBe("p--leading");
  });
});
