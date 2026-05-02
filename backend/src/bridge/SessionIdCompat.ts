/**
 * 会话ID兼容层
 * 新旧SessionId格式转换
 */
export function toCompatSessionId(infraId: string): string {
  return infraId.replace(/-/g, '').substring(0, 16);
}

export function toInfraSessionId(compatId: string): string {
  if (compatId.includes('-')) return compatId;
  return `${compatId.substring(0, 8)}-${compatId.substring(8, 12)}-${compatId.substring(12)}`;
}

export function isValidSessionId(id: string): boolean {
  return /^[a-f0-9-]{8,}$/i.test(id);
}

export function sameSessionId(a: string, b: string): boolean {
  return toCompatSessionId(a) === toCompatSessionId(b);
}
