import type { ChildProcess } from "node:child_process";

export interface SpawnServerOptions {
  devDir: string;
  serverJarName: string;
  memory: string;
  jvmArgs: string[];
}

/**
 * Spawn `java -Xmx<memory> <jvmArgs> -jar <serverJar>` inside the dev dir,
 * with stdio piped so the parent can forward stdin and stream stdout/stderr.
 * Installs a SIGINT handler via `portable.installShutdownHandler`.
 */
export function spawnServer(_opts: SpawnServerOptions): ChildProcess {
  throw new Error("not implemented: spawnServer");
}
