import { expect, test } from "vite-plus/test";
import { getPlatform } from "../mod.ts";

test("velocity platform exists", () => {
  expect(getPlatform("velocity").id).toBe("velocity");
  expect(getPlatform("Velocity").id).toBe("velocity");
  expect(() => getPlatform("@Velocity")).toThrow("Platform with id '@Velocity' not found");
});

test("velocity platform versions", async () => {
  const velocity = getPlatform("velocity");
  const versions = await velocity.getVersions();
  expect(Array.isArray(versions)).toBe(true);
  expect(versions).toEqual(expect.arrayContaining(["3.1.1", "3.1.0", "1.1.9"]));
  expect(versions.length).toBeGreaterThan(0);

  const latest = await velocity.getLatestVersion();
  expect(latest.version).toBe(versions[0]);
});

test("velocity platform download latest version", async () => {
  const velocity = getPlatform("velocity");
  const latestVersion = await velocity.getLatestVersion();
  const result = await velocity.download(latestVersion, true);

  expect(result?.version).toBe(latestVersion.version);
  expect(result?.build).toBe(latestVersion.build);
  expect(result?.output instanceof Uint8Array).toBe(true);
  expect(result?.output.length).toBeGreaterThan(0);
});
