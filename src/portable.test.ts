/**
 * Contract tests for src/portable.ts.
 *
 * See docs/SPEC.md §3.8. `describe.skip` keeps these dormant while the
 * module is stubbed — remove the `.skip` when implementing.
 */

import { describe, expect, test } from "vite-plus/test";

import { toPosixPath } from "./portable.ts";

describe.skip("toPosixPath", () => {
  test("passes forward-slash input through unchanged", () => {
    expect(toPosixPath("a/b/c")).toBe("a/b/c");
    expect(toPosixPath("./libs/foo.jar")).toBe("./libs/foo.jar");
  });

  test("converts backslashes to forward slashes", () => {
    expect(toPosixPath("a\\b\\c")).toBe("a/b/c");
    expect(toPosixPath(".\\libs\\foo.jar")).toBe("./libs/foo.jar");
  });

  test("normalizes mixed separators", () => {
    expect(toPosixPath("a\\b/c")).toBe("a/b/c");
  });

  test("leaves absolute Windows drive paths functional", () => {
    expect(toPosixPath("C:\\Users\\foo")).toBe("C:/Users/foo");
  });
});

// linkOrCopy, resolveRelativeToConfig, installShutdownHandler, writeFileLF
// have filesystem / process dependencies — contract tests live with the
// implementation PRs.
