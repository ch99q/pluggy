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

export function replace(template: string, obj: Record<string, unknown>): string {
  const replacementMap = generateReplacementMap(obj);
  let result = template;

  for (const [key, value] of replacementMap.entries()) {
    const regex = new RegExp(`\\$\\{${key}\\}`, "g");
    result = result.replace(regex, value);
  }

  return result;
}
