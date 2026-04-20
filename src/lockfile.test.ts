/**
 * Contract tests for src/lockfile.ts.
 *
 * See docs/SPEC.md §3.5. `describe.skip` keeps these dormant while the
 * module is stubbed — remove the `.skip` when implementing.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";

import { type Lockfile, readLock, verifyLock, writeLock } from "./lockfile.ts";

describe.skip("lockfile I/O", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "pluggy-lockfile-"));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  test("readLock returns null when no lockfile exists", () => {
    expect(readLock(rootDir)).toBeNull();
  });

  test("writeLock then readLock round-trips", async () => {
    const lock: Lockfile = {
      version: 1,
      entries: {
        worldedit: {
          source: { kind: "modrinth", slug: "worldedit", version: "7.3.15" },
          resolvedVersion: "7.3.15",
          integrity: "sha256-abc",
          declaredBy: ["my-plugin"],
        },
      },
    };
    await writeLock(rootDir, lock);
    const read = readLock(rootDir);
    expect(read).toEqual(lock);
  });

  test("lockfile is valid JSON on disk", async () => {
    const lock: Lockfile = { version: 1, entries: {} };
    await writeLock(rootDir, lock);
    const raw = await readFile(join(rootDir, "pluggy.lock"), "utf8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});

describe.skip("verifyLock", () => {
  test("reports declared deps that are missing from the lock", () => {
    const lock: Lockfile = { version: 1, entries: {} };
    const missing = verifyLock(lock, {
      worldedit: { source: { kind: "modrinth", slug: "worldedit", version: "7.3.15" } },
    });
    expect(missing).toContain("worldedit");
  });

  test("returns empty when every declared dep is locked", () => {
    const lock: Lockfile = {
      version: 1,
      entries: {
        worldedit: {
          source: { kind: "modrinth", slug: "worldedit", version: "7.3.15" },
          resolvedVersion: "7.3.15",
          integrity: "sha256-abc",
          declaredBy: ["my-plugin"],
        },
      },
    };
    const missing = verifyLock(lock, {
      worldedit: { source: { kind: "modrinth", slug: "worldedit", version: "7.3.15" } },
    });
    expect(missing).toEqual([]);
  });
});
