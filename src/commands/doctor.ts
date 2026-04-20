import { spawn } from "node:child_process";
import { readdir, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";

import { Command } from "commander";

import { pickDescriptor } from "../build/descriptor.ts";
import { bold, green, log, red, yellow } from "../logging.ts";
import { getRegisteredPlatforms } from "../platform/mod.ts";
import { getCachePath, type ResolvedProject } from "../project.ts";
import { resolveWorkspaceContext, topologicalOrder, type WorkspaceContext } from "../workspace.ts";

export type CheckStatus = "pass" | "warn" | "fail";

export interface CheckResult {
  id: string;
  label: string;
  status: CheckStatus;
  detail?: string;
}

export interface DoctorCommandOptions {
  json?: boolean;
  cwd?: string;
  /** Per-check overrides used by tests to avoid spawning a JVM or hitting the network. */
  checks?: {
    java?: () => Promise<CheckResult>;
    cache?: () => Promise<CheckResult>;
    registries?: (project: ResolvedProject) => Promise<CheckResult[]>;
    project?: (project: ResolvedProject) => CheckResult;
    workspace?: (ctx: WorkspaceContext) => CheckResult;
    descriptor?: (ctx: WorkspaceContext) => CheckResult[];
    outdated?: () => Promise<CheckResult>;
  };
}

export interface DoctorCommandResult {
  ok: boolean;
  exitCode: 0 | 1;
  checks: CheckResult[];
}

/**
 * Run every environment and project-validation check, returning the
 * aggregated verdict. `exitCode` is 1 iff any check has `status: "fail"` —
 * warns are informational only.
 */
export async function runDoctorCommand(
  opts: DoctorCommandOptions = {},
): Promise<DoctorCommandResult> {
  const cwd = opts.cwd ?? process.cwd();
  const context = resolveWorkspaceContext(cwd);
  if (context === undefined) {
    throw new Error("No pluggy project found — run doctor from inside a project directory.");
  }

  const hooks = opts.checks ?? {};
  const all: CheckResult[] = [];

  all.push(await (hooks.java ? hooks.java() : checkJava(context)));
  all.push(await (hooks.cache ? hooks.cache() : checkCache()));

  const registryProject = context.current?.project ?? context.root;
  const regResults = await (hooks.registries
    ? hooks.registries(registryProject)
    : checkRegistries(registryProject));
  all.push(...regResults);

  // Validate every workspace so one bad leaf surfaces even if the root is fine.
  const toValidate = projectsForValidation(context);
  for (const project of toValidate) {
    all.push(hooks.project ? hooks.project(project) : checkProjectValid(project));
  }

  all.push(hooks.workspace ? hooks.workspace(context) : checkWorkspaceGraph(context));

  const descResults = hooks.descriptor ? hooks.descriptor(context) : checkDescriptors(context);
  all.push(...descResults);

  all.push(await (hooks.outdated ? hooks.outdated() : checkOutdatedPlaceholder()));

  const hardFailures = all.filter((c) => c.status === "fail");
  const ok = hardFailures.length === 0;
  const exitCode: 0 | 1 = ok ? 0 : 1;

  if (opts.json === true) {
    const payload = {
      status: ok ? "success" : "error",
      ok,
      checks: all,
      failures: hardFailures,
    };
    if (ok) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.error(JSON.stringify(payload, null, 2));
    }
  } else {
    log.info(bold("pluggy doctor"));
    for (const c of all) {
      printCheck(c);
    }
    log.info("");
    if (ok) {
      log.success("all required checks passed");
    } else {
      log.error(`${hardFailures.length} check(s) failed`);
    }
  }

  return { ok, exitCode, checks: all };
}

/**
 * Probe `java -version`, parsing the major version from its output. Warns
 * when the toolchain is outside the 8-21 window required by BuildTools-based
 * platforms (spigot, bukkit).
 */
export async function checkJava(context: WorkspaceContext): Promise<CheckResult> {
  const target = context.current?.project ?? context.root;
  const primaryPlatform = target.compatibility?.platforms?.[0];

  try {
    const out = await runJavaVersion();
    // `java -version` writes to stderr on most JDKs.
    const combined = `${out.stdout}\n${out.stderr}`;
    const match =
      combined.match(/version "(\d+)(?:\.(\d+))?[^"]*"/) ??
      combined.match(/version (\d+)(?:\.(\d+))?/);
    const major = match
      ? Number.parseInt(match[1] === "1" && match[2] !== undefined ? match[2] : match[1], 10)
      : undefined;
    const detail = major === undefined ? combined.split("\n")[0] : `Java ${major}`;

    if (
      primaryPlatform !== undefined &&
      (primaryPlatform === "spigot" || primaryPlatform === "bukkit") &&
      major !== undefined &&
      (major < 8 || major > 21)
    ) {
      return {
        id: "java",
        label: "Java toolchain",
        status: "warn",
        detail: `${detail} — spigot/bukkit BuildTools needs Java 8-21`,
      };
    }
    return { id: "java", label: "Java toolchain", status: "pass", detail };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      id: "java",
      label: "Java toolchain",
      status: "fail",
      detail: `java not found or failed to run: ${message}`,
    };
  }
}

async function runJavaVersion(): Promise<{ stdout: string; stderr: string }> {
  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("java", ["-version"], { shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (b: Buffer) => {
      stdout += b.toString("utf8");
    });
    child.stderr?.on("data", (b: Buffer) => {
      stderr += b.toString("utf8");
    });
    child.once("error", rejectPromise);
    child.once("close", (code) => {
      if (code === 0 || code === null) resolvePromise({ stdout, stderr });
      else rejectPromise(new Error(`java -version exited with code ${code}: ${stderr.trim()}`));
    });
  });
}

/**
 * Stat the cache directory and verify it's writable by touching a temp file.
 * Reports size as the detail string on the pass result.
 */
export async function checkCache(): Promise<CheckResult> {
  const path = getCachePath();
  try {
    const s = await stat(path).catch(() => undefined);
    if (s === undefined) {
      return {
        id: "cache",
        label: "Cache reachability",
        status: "warn",
        detail: `cache directory does not exist yet: ${path}`,
      };
    }
    if (!s.isDirectory()) {
      return {
        id: "cache",
        label: "Cache reachability",
        status: "fail",
        detail: `cache path exists but is not a directory: ${path}`,
      };
    }
    const probe = join(path, `.pluggy-doctor-probe-${process.pid}`);
    try {
      await writeFile(probe, "");
      await unlink(probe);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        id: "cache",
        label: "Cache reachability",
        status: "fail",
        detail: `cache is not writable: ${path} (${message})`,
      };
    }
    const sizeBytes = await dirSize(path);
    return {
      id: "cache",
      label: "Cache reachability",
      status: "pass",
      detail: `${path} (${formatBytes(sizeBytes)})`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      id: "cache",
      label: "Cache reachability",
      status: "fail",
      detail: `could not stat cache at ${path}: ${message}`,
    };
  }
}

async function dirSize(path: string): Promise<number> {
  let total = 0;
  async function walk(current: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        try {
          const s = await stat(full);
          total += s.size;
        } catch {
          // unreadable entry
        }
      }
    }
  }
  await walk(path);
  return total;
}

/** HEAD each declared registry URL; warn on non-2xx/4xx or network failure. */
export async function checkRegistries(project: ResolvedProject): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const registries = project.registries ?? [];
  if (registries.length === 0) {
    return [
      {
        id: "registry",
        label: "Registries",
        status: "pass",
        detail: "no extra registries declared",
      },
    ];
  }
  for (const entry of registries) {
    const url = typeof entry === "string" ? entry : entry.url;
    out.push(await checkOneRegistry(url));
  }
  return out;
}

async function checkOneRegistry(url: string): Promise<CheckResult> {
  const label = `Registry ${url}`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(url, { method: "HEAD", signal: controller.signal });
      if (res.ok || (res.status >= 200 && res.status < 500)) {
        return { id: "registry", label, status: "pass", detail: `HTTP ${res.status}` };
      }
      return {
        id: "registry",
        label,
        status: "warn",
        detail: `HTTP ${res.status}`,
      };
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { id: "registry", label, status: "warn", detail: `unreachable: ${message}` };
  }
}

const NAME_RE = /^[a-zA-Z0-9_]+$/;
const VERSION_RE = /^\d+\.\d+\.\d+(-[a-zA-Z0-9]+)?$/;

/**
 * Validate the structural fields of a single `project.json`. Names the
 * offending field in `detail` so CI output points at the right key.
 */
export function checkProjectValid(project: ResolvedProject): CheckResult {
  const label = `project.json (${project.name ?? "unknown"})`;
  if (typeof project.name !== "string" || !NAME_RE.test(project.name)) {
    return {
      id: "project",
      label,
      status: "fail",
      detail: `invalid or missing "name": ${String(project.name)}`,
    };
  }
  if (typeof project.version !== "string" || !VERSION_RE.test(project.version)) {
    return {
      id: "project",
      label,
      status: "fail",
      detail: `invalid or missing "version": ${String(project.version)}`,
    };
  }
  const compat = project.compatibility;
  if (
    compat === undefined ||
    compat === null ||
    !Array.isArray(compat.versions) ||
    compat.versions.length === 0 ||
    !Array.isArray(compat.platforms) ||
    compat.platforms.length === 0
  ) {
    return {
      id: "project",
      label,
      status: "fail",
      detail: `"compatibility" must declare non-empty "versions" and "platforms"`,
    };
  }
  for (const p of compat.platforms) {
    if (!getRegisteredPlatforms().includes(p)) {
      return {
        id: "project",
        label,
        status: "fail",
        detail: `unknown platform "${p}" (known: ${getRegisteredPlatforms().join(", ")})`,
      };
    }
  }
  return {
    id: "project",
    label,
    status: "pass",
    detail: `name=${project.name}, version=${project.version}`,
  };
}

/** Run topological order over workspaces; fails on cycles. */
export function checkWorkspaceGraph(context: WorkspaceContext): CheckResult {
  const label = "Workspace graph";
  if (context.workspaces.length === 0) {
    return { id: "workspace", label, status: "pass", detail: "standalone project" };
  }
  try {
    const ordered = topologicalOrder(context.workspaces);
    return {
      id: "workspace",
      label,
      status: "pass",
      detail: `${ordered.length} workspace(s): ${ordered.map((w) => w.name).join(" -> ")}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { id: "workspace", label, status: "fail", detail: message };
  }
}

/**
 * Run `pickDescriptor` across every buildable project so cross-family
 * compatibility errors are surfaced before a build attempts them.
 */
export function checkDescriptors(context: WorkspaceContext): CheckResult[] {
  const targets =
    context.workspaces.length > 0 ? context.workspaces.map((w) => w.project) : [context.root];

  const out: CheckResult[] = [];
  for (const project of targets) {
    // The root in a multi-workspace repo has no descriptor of its own.
    if (context.workspaces.length > 0 && project === context.root) continue;

    const label = `Descriptor family (${project.name})`;
    try {
      const desc = pickDescriptor(project);
      out.push({
        id: "descriptor",
        label,
        status: "pass",
        detail: `${project.compatibility.platforms[0]} → ${desc.path}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      out.push({ id: "descriptor", label, status: "fail", detail: message });
    }
  }
  if (out.length === 0) {
    out.push({
      id: "descriptor",
      label: "Descriptor family",
      status: "pass",
      detail: "no plugin workspaces to check",
    });
  }
  return out;
}

export async function checkOutdatedPlaceholder(): Promise<CheckResult> {
  return {
    id: "outdated",
    label: "Outdated dependencies",
    status: "warn",
    detail: "(not yet implemented)",
  };
}

function projectsForValidation(context: WorkspaceContext): ResolvedProject[] {
  const out: ResolvedProject[] = [context.root];
  for (const ws of context.workspaces) {
    out.push(ws.project);
  }
  return out;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function printCheck(c: CheckResult): void {
  const marker = c.status === "pass" ? green("✔") : c.status === "warn" ? yellow("!") : red("✖");
  const detail = c.detail === undefined || c.detail.length === 0 ? "" : ` — ${c.detail}`;
  log.info(`  ${marker} ${c.label}${detail}`);
}

/** Factory for the `pluggy doctor` commander command. */
export function doctorCommand(): Command {
  return new Command("doctor")
    .description("Check your environment and project for common issues.")
    .action(async function action(this: Command) {
      const globalOpts = this.optsWithGlobals();
      const result = await runDoctorCommand({ json: globalOpts.json === true });
      if (result.exitCode !== 0) {
        process.exit(result.exitCode);
      }
    });
}
