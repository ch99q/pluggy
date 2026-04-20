import { expect, test } from "vite-plus/test";
import { getPlatform } from "../mod.ts";

test("paper platform exists", () => {
  expect(getPlatform("paper").id).toBe("paper");
  expect(getPlatform("Paper").id).toBe("paper");
  expect(() => getPlatform("@Paper")).toThrow("Platform with id '@Paper' not found");
});

test("paper platform versions", async () => {
  const paper = getPlatform("paper");
  const versions = await paper.getVersions();
  expect(Array.isArray(versions)).toBe(true);
  expect(versions).toEqual(expect.arrayContaining(["1.21.8", "1.21.7", "1.21.6"]));
  expect(versions.length).toBeGreaterThan(0);

  const latest = await paper.getLatestVersion();
  expect(latest.version).toBe(versions[0]);
});

test("paper platform download latest version", async () => {
  const paper = getPlatform("paper");
  const latestVersion = await paper.getLatestVersion();
  const result = await paper.download(latestVersion, true);

  expect(result?.version).toBe(latestVersion.version);
  expect(result?.build).toBe(latestVersion.build);
  expect(result?.output instanceof Uint8Array).toBe(true);
  expect(result?.output.length).toBeGreaterThan(0);
});
