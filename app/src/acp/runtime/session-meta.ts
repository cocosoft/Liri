const sessionMetaStore = new Map<string, Map<string, unknown>>();

export function setSessionMeta(
  sessionKey: string,
  key: string,
  value: unknown
): void {
  let meta = sessionMetaStore.get(sessionKey);
  if (!meta) {
    meta = new Map();
    sessionMetaStore.set(sessionKey, meta);
  }
  meta.set(key, value);
}

export function getSessionMeta<T = unknown>(
  sessionKey: string,
  key: string
): T | undefined {
  const meta = sessionMetaStore.get(sessionKey);
  if (!meta) {
    return undefined;
  }
  return meta.get(key) as T | undefined;
}

export function deleteSessionMeta(sessionKey: string, key: string): boolean {
  const meta = sessionMetaStore.get(sessionKey);
  if (!meta) {
    return false;
  }
  const deleted = meta.delete(key);
  if (meta.size === 0) {
    sessionMetaStore.delete(sessionKey);
  }
  return deleted;
}

export function getSessionMetaKeys(sessionKey: string): string[] {
  const meta = sessionMetaStore.get(sessionKey);
  if (!meta) {
    return [];
  }
  return Array.from(meta.keys());
}

export function clearSessionMeta(sessionKey: string): void {
  sessionMetaStore.delete(sessionKey);
}

export function clearAllSessionMeta(): void {
  sessionMetaStore.clear();
}

export function getSessionMetaSnapshot(
  sessionKey: string
): Record<string, unknown> {
  const meta = sessionMetaStore.get(sessionKey);
  if (!meta) {
    return {};
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of meta) {
    result[key] = value;
  }
  return result;
}
