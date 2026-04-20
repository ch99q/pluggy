/**
 * Cross-platform helpers. See docs/SPEC.md §3.8.
 *
 * Every function in here must behave identically on macOS, Linux, and Windows.
 */

import type { ChildProcess } from "node:child_process";
import { copyFile, link, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

/**
 * Create a file at `destination` that references the bytes at `source`.
 *
 * Attempts a hardlink first (works on all platforms, no privileges needed,
 * same-volume required). Falls back to a byte-for-byte copy if hardlink fails
 * (cross-volume, filesystem restriction, etc.).
 *
 * Never creates a symlink — symlinks on Windows require admin or Developer Mode.
 *
 * If `destination` already exists, it is overwritten: the existing file is
 * unlinked first, and then the hardlink (or copy fallback) proceeds. Other
 * errors from the initial `link` call — anything that isn't EEXIST — trigger
 * the copy fallback.
 */
export async function linkOrCopy(source: string, destination: string): Promise<void> {
  try {
    await link(source, destination);
    return;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      // Destination already exists — unlink and retry the hardlink. If the
      // retry also fails, fall through to the copy fallback below.
      await unlink(destination);
      try {
        await link(source, destination);
        return;
      } catch {
        // Fall through to copy.
      }
    }
    // Hardlink failed (EXDEV, EPERM, ENOTSUP, etc.) — fall back to copy.
    try {
      await copyFile(source, destination);
    } catch (copyErr) {
      const msg = (copyErr as Error).message;
      throw new Error(`linkOrCopy: failed to link or copy ${source} -> ${destination}: ${msg}`);
    }
  }
}

/**
 * Normalize any user-provided path string to forward-slash (POSIX) form,
 * for persistence in `project.json` / `pluggy.lock`. Input may contain
 * backslashes (Windows shells produce them); output never does.
 */
export function toPosixPath(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Resolve a path that is relative to a config file's directory.
 * Accepts both forward- and backward-slash input; returns an absolute
 * OS-native path.
 */
export function resolveRelativeToConfig(configFile: string, relative: string): string {
  // Normalize backslashes to forward slashes first so `isAbsolute` and
  // `resolve` see the input as they would from a POSIX config.
  const normalized = toPosixPath(relative);
  if (isAbsolute(normalized)) {
    return resolve(normalized);
  }
  return resolve(dirname(configFile), normalized);
}

export interface ShutdownOptions {
  /** Command to send over the child's stdin to request a graceful shutdown. */
  gracefulStdin: string;
  /** Milliseconds to wait for graceful exit before forcing termination. */
  graceMs: number;
  /** Milliseconds within which a second Ctrl+C triggers immediate force-kill. */
  forceKillWindowMs: number;
}

/**
 * Install a SIGINT (Ctrl+C) handler that orchestrates graceful shutdown of
 * the given child process:
 *
 *   1. First Ctrl+C: write `opts.gracefulStdin` to the child's stdin, wait
 *      up to `opts.graceMs` for clean exit, then `child.kill()` (SIGTERM on
 *      Unix, TerminateProcess on Windows — Node's cross-platform shim).
 *   2. Second Ctrl+C within `opts.forceKillWindowMs`: force-kill immediately.
 *
 * Returns a disposer that removes the handler.
 */
export function installShutdownHandler(child: ChildProcess, opts: ShutdownOptions): () => void {
  let firstSigintAt = 0;
  let graceTimer: NodeJS.Timeout | undefined;
  let forceWindowTimer: NodeJS.Timeout | undefined;

  const clearGraceTimer = (): void => {
    if (graceTimer !== undefined) {
      clearTimeout(graceTimer);
      graceTimer = undefined;
    }
  };

  const clearForceWindowTimer = (): void => {
    if (forceWindowTimer !== undefined) {
      clearTimeout(forceWindowTimer);
      forceWindowTimer = undefined;
    }
  };

  const onExit = (): void => {
    clearGraceTimer();
    clearForceWindowTimer();
  };

  child.once("exit", onExit);

  const onSigint = (): void => {
    const now = Date.now();
    if (firstSigintAt !== 0 && now - firstSigintAt <= opts.forceKillWindowMs) {
      // Second Ctrl+C within the window — force-kill immediately.
      clearGraceTimer();
      clearForceWindowTimer();
      try {
        child.kill("SIGKILL");
      } catch {
        // Child may already be dead.
      }
      return;
    }

    firstSigintAt = now;

    // Open the second-press window so future SIGINTs within it force-kill.
    clearForceWindowTimer();
    forceWindowTimer = setTimeout(() => {
      firstSigintAt = 0;
      forceWindowTimer = undefined;
    }, opts.forceKillWindowMs);
    // Don't keep the event loop alive just for this timer.
    forceWindowTimer.unref?.();

    // Ask the child to stop gracefully.
    if (child.stdin && !child.stdin.destroyed && child.stdin.writable) {
      try {
        child.stdin.write(opts.gracefulStdin);
      } catch {
        // Child stdin may have closed between the check and the write.
      }
    }

    // If the child hasn't exited within graceMs, terminate it.
    clearGraceTimer();
    graceTimer = setTimeout(() => {
      graceTimer = undefined;
      if (child.exitCode === null && child.signalCode === null) {
        try {
          child.kill();
        } catch {
          // Already dead.
        }
      }
    }, opts.graceMs);
    graceTimer.unref?.();
  };

  process.on("SIGINT", onSigint);

  return (): void => {
    process.removeListener("SIGINT", onSigint);
    child.removeListener("exit", onExit);
    clearGraceTimer();
    clearForceWindowTimer();
  };
}

/**
 * Write a file using LF line endings regardless of host OS.
 * Used for generated files (`server.properties`, `plugin.yml`, etc.) so
 * build outputs are byte-identical across platforms.
 */
export async function writeFileLF(path: string, contents: string): Promise<void> {
  const normalized = contents.includes("\r\n") ? contents.replace(/\r\n/g, "\n") : contents;
  await writeFile(path, normalized, "utf8");
}
