/**
 * Dev-server runtime — stage `dev/`, build, spawn the server, watch sources,
 * and on every debounced change rebuild + (reload | restart).
 */

import { basename, join, resolve } from "node:path";

import { buildProject } from "../build/index.ts";
import { log } from "../logging.ts";
import { getPlatform } from "../platform/index.ts";
import type { DescriptorSpec } from "../platform/platform.ts";
import { linkOrCopy } from "../portable.ts";
import { getCachePath, type ResolvedProject } from "../project.ts";
import { resolveDependency, type ResolvedDependency } from "../resolver/index.ts";
import { parseSource } from "../source.ts";

import { isRuntimePlugin, stagePlugins } from "./plugins.ts";
import { spawnServer } from "./spawn.ts";
import { stageDev } from "./stage.ts";
import { watchProject } from "./watch.ts";

export interface DevOptions {
  platform?: string;
  version?: string;
  port?: number;
  memory?: string;
  clean?: boolean;
  freshWorld?: boolean;
  watch?: boolean;
  reload?: boolean;
  offline?: boolean;
  args?: string[];
}

/**
 * Run the dev loop: ensure platform jar, build plugin, stage `dev/`, spawn
 * server, and (unless `watch === false`) rebuild on source change. Returns
 * when the server has exited cleanly.
 */
export async function runDev(project: ResolvedProject, opts: DevOptions): Promise<void> {
  const platformId = opts.platform ?? project.compatibility.platforms[0];
  if (platformId === undefined) {
    throw new Error(
      "runDev: no platform configured — set compatibility.platforms[0] or pass --platform",
    );
  }
  const mcVersion = opts.version ?? project.compatibility.versions[0];
  if (mcVersion === undefined) {
    throw new Error(
      "runDev: no MC version configured — set compatibility.versions[0] or pass --version",
    );
  }

  const platform = getPlatform(platformId);

  // `platform.download` writes to `<cachePath>/versions/<id>-<ver>-<build>.jar`;
  // we reuse that on-disk path instead of the returned bytes.
  const versionInfo = await platform.getVersionInfo(mcVersion);
  const downloaded = await platform.download(versionInfo, false);
  const platformJarPath = join(
    getCachePath(),
    "versions",
    `${platform.id}-${downloaded.version}-${downloaded.build}.jar`,
  );

  let buildResult = await buildProject(project, { clean: opts.clean });

  const runtimePluginDeps = await resolveRuntimePluginDeps(project, platform.descriptor);

  const devDir = await stageDev(project, platformJarPath, {
    clean: opts.clean,
    freshWorld: opts.freshWorld,
    port: opts.port,
    onlineMode: opts.offline === true ? false : project.dev?.onlineMode,
  });

  const extraPluginsAbsolute = (project.dev?.extraPlugins ?? []).map((p) =>
    resolve(project.rootDir, p),
  );
  await stagePlugins(devDir, buildResult.outputPath, runtimePluginDeps, extraPluginsAbsolute);

  const memory = opts.memory ?? project.dev?.memory ?? "2G";
  const jvmArgs = opts.args ?? project.dev?.jvmArgs ?? [];
  let child = spawnServer({
    devDir,
    serverJarName: "server.jar",
    memory,
    jvmArgs,
  });

  log.debug(`dev: server spawned (pid=${child.pid ?? "?"})`);

  const pluginJarName = basename(buildResult.outputPath);
  const pluginDest = join(devDir, "plugins", pluginJarName);

  let stopWatching: (() => void) | undefined;

  const waitForExit = (c: typeof child): Promise<void> =>
    new Promise<void>((resolvePromise) => {
      c.once("exit", () => resolvePromise());
    });

  if (opts.watch !== false) {
    const rebuildAndReload = async (): Promise<void> => {
      log.info("dev: change detected — rebuilding…");
      try {
        buildResult = await buildProject(project, {});
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error(`dev: rebuild failed — keeping previous jar running: ${msg}`);
        return;
      }

      if (opts.reload === true) {
        // /reload has known correctness problems for stateful plugins; the
        // spec warns users. Best-effort swap + reload.
        try {
          await linkOrCopy(buildResult.outputPath, pluginDest);
          if (child.stdin !== null && !child.stdin.destroyed && child.stdin.writable) {
            child.stdin.write("reload confirm\n");
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log.error(`dev: reload failed: ${msg}`);
        }
        return;
      }

      if (child.stdin !== null && !child.stdin.destroyed && child.stdin.writable) {
        child.stdin.write("stop\n");
      }
      await waitForExit(child);

      try {
        await linkOrCopy(buildResult.outputPath, pluginDest);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error(`dev: could not replace plugin jar: ${msg}`);
      }

      child = spawnServer({
        devDir,
        serverJarName: "server.jar",
        memory,
        jvmArgs,
      });
      log.debug(`dev: server respawned (pid=${child.pid ?? "?"})`);
    };

    stopWatching = watchProject(project, {
      debounceMs: 200,
      onChange: rebuildAndReload,
    });
  }

  try {
    // `child` is reassigned when a rebuild respawns; snapshot, wait, re-check.
    while (true) {
      const snapshot = child;
      await waitForExit(snapshot);
      if (child === snapshot) break;
    }
  } finally {
    stopWatching?.();
  }
}

async function resolveRuntimePluginDeps(
  project: ResolvedProject,
  descriptor: DescriptorSpec,
): Promise<ResolvedDependency[]> {
  const deps = project.dependencies;
  if (deps === undefined || deps === null) return [];

  const registries = (project.registries ?? []).map((r) => (typeof r === "string" ? r : r.url));

  const results: ResolvedDependency[] = [];
  for (const [name, raw] of Object.entries(deps)) {
    const { source, version } =
      typeof raw === "string"
        ? { source: `modrinth:${name}`, version: raw }
        : { source: raw.source, version: raw.version };
    const parsed = parseSource(source, version);
    const resolved = await resolveDependency(parsed, {
      rootDir: project.rootDir,
      includePrerelease: false,
      force: false,
      registries,
    });
    const isPlugin = await isRuntimePlugin(resolved.jarPath, descriptor);
    if (isPlugin) results.push(resolved);
  }
  return results;
}
