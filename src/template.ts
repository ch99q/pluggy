/**
 * `${project.x}` substitution used by `init` and the build pipeline to seed
 * template files with values from `project.json`.
 */

/**
 * Flatten a nested object into a dotted-path map of scalar strings:
 * `{ a: { b: 1 } }` yields `{ "a.b": "1" }`. Arrays yield numeric-suffixed
 * keys (`list.0`, `list.1`, ...).
 */
export function generateReplacementMap(
  obj: Record<string, unknown>,
  prefix = "",
): Map<string, string> {
  const map = new Map<string, string>();

  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}.${key}` : key;

    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      const nestedMap = generateReplacementMap(value as Record<string, unknown>, newKey);
      nestedMap.forEach((val, nestedKey) => map.set(nestedKey, val));
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => {
        map.set(`${newKey}.${index}`, String(item));
      });
    } else {
      map.set(newKey, String(value));
    }
  }

  return map;
}

/** Substitute every `${dotted.key}` in `template` from `obj`. */
export function replace(template: string, obj: Record<string, unknown>): string {
  const replacementMap = generateReplacementMap(obj);
  let result = template;

  for (const [key, value] of replacementMap.entries()) {
    const regex = new RegExp(`\\$\\{${key}\\}`, "g");
    result = result.replace(regex, value);
  }

  return result;
}
