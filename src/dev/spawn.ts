/**
 * Spawn the Minecraft server JVM inside the staged dev directory. stdin is
 * piped so the parent can send `/stop`; stdout/stderr are inherited so the
 * user sees the server's own logs directly.
 */

import { spawn, type ChildProcess } from "node:child_process";
import process from "node:process";

import { installShutdownHandler } from "../portable.ts";

export interface SpawnServerOptions {
  devDir: string;
  serverJarName: string;
  memory: string;
  jvmArgs: string[];
}

/**
 * Spawn `java -Xmx<memory> <jvmArgs> -jar <serverJar> nogui` inside `devDir`.
 * `nogui` suppresses Bukkit's AWT console window on desktop JVMs.
 * Installs a SIGINT handler that is disposed automatically on child exit.
 */
export function spawnServer(opts: SpawnServerOptions): ChildProcess {
  const argv = [`-Xmx${opts.memory}`, ...opts.jvmArgs, "-jar", opts.serverJarName, "nogui"];

  const child = spawn("java", argv, {
    cwd: opts.devDir,
    stdio: ["pipe", "inherit", "inherit"],
  });

  if (child.stdin !== null && !child.stdin.destroyed) {
    // `end: false` keeps the child's stdin open when the parent's closes
    // (e.g. EOF on a non-TTY). Shutdown still reaches the child via the
    // SIGINT handler installed below.
    process.stdin.pipe(child.stdin, { end: false });
  }

  const dispose = installShutdownHandler(child, {
    gracefulStdin: "stop\n",
    graceMs: 30_000,
    forceKillWindowMs: 2_000,
  });

  child.once("exit", () => {
    dispose();
    if (child.stdin !== null) {
      try {
        process.stdin.unpipe(child.stdin);
      } catch {
        // Already unpiped or parent stdin is closed.
      }
    }
  });

  return child;
}
