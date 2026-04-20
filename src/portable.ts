/**
 * Cross-platform helpers. See docs/SPEC.md §3.8.
 *
 * Every function in here must behave identically on macOS, Linux, and Windows.
 */

import type { ChildProcess } from "node:child_process";

/**
 * Create a file at `destination` that references the bytes at `source`.
 *
 * Attempts a hardlink first (works on all platforms, no privileges needed,
 * same-volume required). Falls back to a byte-for-byte copy if hardlink fails
 * (cross-volume, filesystem restriction, etc.).
 *
 * Never creates a symlink — symlinks on Windows require admin or Developer Mode.
 */
export function linkOrCopy(_source: string, _destination: string): Promise<void> {
  throw new Error("not implemented: linkOrCopy");
}

/**
 * Normalize any user-provided path string to forward-slash (POSIX) form,
 * for persistence in `project.json` / `pluggy.lock`. Input may contain
 * backslashes (Windows shells produce them); output never does.
 */
export function toPosixPath(_p: string): string {
  throw new Error("not implemented: toPosixPath");
}

/**
 * Resolve a path that is relative to a config file's directory.
 * Accepts both forward- and backward-slash input; returns an absolute
 * OS-native path.
 */
export function resolveRelativeToConfig(_configFile: string, _relative: string): string {
  throw new Error("not implemented: resolveRelativeToConfig");
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
export function installShutdownHandler(_child: ChildProcess, _opts: ShutdownOptions): () => void {
  throw new Error("not implemented: installShutdownHandler");
}

/**
 * Write a file using LF line endings regardless of host OS.
 * Used for generated files (`server.properties`, `plugin.yml`, etc.) so
 * build outputs are byte-identical across platforms.
 */
export function writeFileLF(_path: string, _contents: string): Promise<void> {
  throw new Error("not implemented: writeFileLF");
}
