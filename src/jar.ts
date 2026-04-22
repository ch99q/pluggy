/**
 * Utilities for reading metadata out of JAR/ZIP files without fully
 * extracting them. Used by `doctor` to inspect BuildTools and cached
 * dependency jars.
 */

import { existsSync } from "node:fs";

import yauzl, { type Entry, type ZipFile } from "yauzl";

function openZip(jarPath: string): Promise<ZipFile | undefined> {
  return new Promise((resolve) => {
    yauzl.open(jarPath, { lazyEntries: true, autoClose: false }, (err, zip) => {
      resolve(err || !zip ? undefined : zip);
    });
  });
}

function readEntry(zip: ZipFile, entry: Entry): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err || !stream) {
        reject(err ?? new Error("no stream"));
        return;
      }
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.once("end", () => resolve(Buffer.concat(chunks)));
      stream.once("error", reject);
    });
  });
}

/**
 * Read a single attribute from a JAR's `META-INF/MANIFEST.MF`.
 * Returns `undefined` if the JAR is missing, the manifest is absent,
 * or the attribute is not present.
 */
export async function readManifestAttribute(
  jarPath: string,
  attribute: string,
): Promise<string | undefined> {
  if (!existsSync(jarPath)) return undefined;
  const zip = await openZip(jarPath);
  if (!zip) return undefined;

  return new Promise((resolve) => {
    zip.readEntry();
    zip.on("entry", async (entry: Entry) => {
      if (entry.fileName !== "META-INF/MANIFEST.MF") {
        zip.readEntry();
        return;
      }
      try {
        const bytes = await readEntry(zip, entry);
        const text = bytes.toString("utf8");
        const match = text.match(new RegExp(`^${attribute}:\\s*(.+)`, "m"));
        resolve(match ? match[1].trim() : undefined);
      } catch {
        resolve(undefined);
      } finally {
        zip.close();
      }
    });
    zip.on("end", () => {
      zip.close();
      resolve(undefined);
    });
    zip.on("error", () => {
      zip.close();
      resolve(undefined);
    });
  });
}

/**
 * Read the class-file major version from the first `.class` entry in a JAR.
 * Returns `undefined` if the JAR can't be read or contains no class files.
 *
 * Convert to a Java release with `classMajorToJava` (Java N = major 44+N).
 */
export async function readJarClassMajor(jarPath: string): Promise<number | undefined> {
  if (!existsSync(jarPath)) return undefined;
  const zip = await openZip(jarPath);
  if (!zip) return undefined;

  return new Promise((resolve) => {
    zip.readEntry();
    zip.on("entry", async (entry: Entry) => {
      if (!entry.fileName.endsWith(".class") || entry.fileName.includes("module-info")) {
        zip.readEntry();
        return;
      }
      try {
        const bytes = await readEntry(zip, entry);
        resolve(bytes.length >= 8 ? bytes.readUInt16BE(6) : undefined);
      } catch {
        resolve(undefined);
      } finally {
        zip.close();
      }
    });
    zip.on("end", () => {
      zip.close();
      resolve(undefined);
    });
    zip.on("error", () => {
      zip.close();
      resolve(undefined);
    });
  });
}

/** Convert a class-file major version to its Java release number (Java N = major 44+N). */
export function classMajorToJava(major: number): number {
  return major - 44;
}
