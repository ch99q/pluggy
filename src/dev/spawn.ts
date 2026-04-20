/**
 * Spawn the Minecraft server JVM inside the staged dev directory.
 *
 * Never invokes a shell — the executable is `java` (or `java.exe` via Node's
 * PATH lookup on Windows). stdin is piped so we can send `/stop`; stdout and
 * stderr are inherited so the user sees the server's own logs without any
 * extra copying.
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
 * Spawn `java -Xmx<memory> <jvmArgs> -jar <serverJar>` inside the dev dir,
 * with stdio piped so the parent can forward stdin and stream stdout/stderr.
 * Installs a SIGINT handler via `portable.installShutdownHandler` that is
 * automatically disposed when the child exits.
 */
export function spawnServer(opts: SpawnServerOptions): ChildProcess {
  const argv = [`-Xmx${opts.memory}`, ...opts.jvmArgs, "-jar", opts.serverJarName];

  const child = spawn("java", argv, {
    cwd: opts.devDir,
    stdio: ["pipe", "inherit", "inherit"],
  });

  // Forward parent stdin to the server so `/op`, `/tp`, `/stop`, etc. work
  // from the terminal. Pipe when the parent has a real stdin stream; on
  // non-TTY / redirected setups pipe() still works, but we guard in case
  // either side is already closed.
  if (child.stdin !== null && !child.stdin.destroyed) {
    // `end: false` keeps the server stdin open when the parent's stdin
    // closes (e.g. EOF from a non-TTY). The child is still reachable via
    // our shutdown handler.
    process.stdin.pipe(child.stdin, { end: false });
  }

  const dispose = installShutdownHandler(child, {
    gracefulStdin: "stop\n",
    graceMs: 30_000,
    forceKillWindowMs: 2_000,
  });

  child.once("exit", () => {
    dispose();
    // Stop forwarding parent stdin — the child's stdin is gone.
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
