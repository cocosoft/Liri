export function hasConfiguredMemorySecretInput(value: unknown): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;

  if (typeof record.source === "string" && record.source === "env") {
    const envKey = typeof record.id === "string" ? record.id : typeof record.path === "string" ? record.path : "";
    if (envKey) {
      return !!process.env[envKey];
    }
  }

  const directValue = record.value ?? record.id ?? record.path;
  if (typeof directValue === "string" && directValue.length > 0) {
    return true;
  }

  return false;
}

export function resolveMemorySecretInputString(params: {
  value: unknown;
  path: string;
}): string | undefined {
  if (typeof params.value !== "object" || params.value === null) {
    if (typeof params.value === "string" && params.value.length > 0) {
      return params.value;
    }
    return undefined;
  }

  const record = params.value as Record<string, unknown>;

  if (record.source === "env" && typeof record.id === "string") {
    const envValue = process.env[record.id];
    if (typeof envValue === "string" && envValue.length > 0) {
      return envValue.trim();
    }
  }

  if (typeof record.value === "string" && record.value.length > 0) {
    return record.value;
  }

  return undefined;
}
