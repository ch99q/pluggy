/** Contract tests for the `${dotted.key}` substitution helper. */

import { describe, expect, test } from "vite-plus/test";

import { generateReplacementMap, replace } from "./template.ts";

describe("generateReplacementMap", () => {
  test("flattens nested objects to dotted-path keys", () => {
    const map = generateReplacementMap({ project: { name: "foo", version: "1.0.0" } });
    expect(map.get("project.name")).toBe("foo");
    expect(map.get("project.version")).toBe("1.0.0");
  });

  test("expands arrays into numeric-suffixed keys", () => {
    const map = generateReplacementMap({ authors: ["alice", "bob"] });
    expect(map.get("authors.0")).toBe("alice");
    expect(map.get("authors.1")).toBe("bob");
  });

  test("stringifies scalars (number, boolean, null)", () => {
    const map = generateReplacementMap({ a: 1, b: true, c: null });
    expect(map.get("a")).toBe("1");
    expect(map.get("b")).toBe("true");
    expect(map.get("c")).toBe("null");
  });
});

describe("replace", () => {
  test("substitutes a known key", () => {
    expect(replace("hello ${who}", { who: "world" })).toBe("hello world");
  });

  test("leaves an unknown key unchanged", () => {
    expect(replace("hi ${unknown}", { who: "x" })).toBe("hi ${unknown}");
  });

  test("substitutes every occurrence of the same key", () => {
    expect(replace("${a}/${a}", { a: "x" })).toBe("x/x");
  });

  test("strips the escape backslash and leaves the placeholder literal", () => {
    expect(replace("hello \\${who}", { who: "world" })).toBe("hello ${who}");
  });

  test("an escaped key that is unknown is also emitted as a literal", () => {
    expect(replace("config: \\${SOME_RUNTIME_VAR}", { who: "x" })).toBe(
      "config: ${SOME_RUNTIME_VAR}",
    );
  });

  test("escaped and unescaped occurrences coexist in the same template", () => {
    expect(replace("${greet} \\${greet}", { greet: "hi" })).toBe("hi ${greet}");
  });

  test("preserves a literal backslash that doesn't precede ${...}", () => {
    expect(replace("path: C:\\Users", { who: "x" })).toBe("path: C:\\Users");
  });

  test("regex metacharacters in the key name are matched literally", () => {
    // `a.b` must match the dotted key, not `a` followed by any char `b`.
    expect(replace("${a.b}", { a: { b: "value" } })).toBe("value");
    expect(replace("${aXb}", { a: { b: "value" } })).toBe("${aXb}");
  });
});
