export function repairIncompleteJson(json: string): string {
  if (!json || json.trim().length === 0) return json;

  const trimmed = json.trim();
  if (looksComplete(trimmed)) return trimmed;

  let result = trimmed;

  if (result.startsWith('"') && !result.endsWith('"')) {
    result += '"';
  }

  let braceDepth = 0;
  let bracketDepth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < result.length; i++) {
    const ch = result[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') braceDepth++;
    if (ch === '}') braceDepth--;
    if (ch === '[') bracketDepth++;
    if (ch === ']') bracketDepth--;
  }

  while (bracketDepth > 0) {
    result += ']';
    bracketDepth--;
  }
  while (braceDepth > 0) {
    result += '}';
    braceDepth--;
  }

  result = result.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');

  if (!looksComplete(result)) {
    result = trimmed + '}';
    result = result.replace(/,\s*}/g, '}');
  }

  try {
    JSON.parse(result);
    return result;
  } catch {
    return repairByTrimmingTrailingText(result);
  }
}

function looksComplete(json: string): boolean {
  try {
    JSON.parse(json);
    return true;
  } catch {
    return false;
  }
}

function repairByTrimmingTrailingText(json: string): string {
  const lastBrace = json.lastIndexOf('}');
  if (lastBrace > 0) {
    return json.slice(0, lastBrace + 1);
  }
  return json;
}

export function repairToolCallArguments(args: string): string {
  const repaired = repairIncompleteJson(args);
  try {
    JSON.parse(repaired);
    return repaired;
  } catch {
    return '{}';
  }
}
