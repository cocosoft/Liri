export interface AcpSessionIdentity {
  sessionKey: string;
  backend: string;
  runtimeSessionName: string;
  cwd?: string;
}

export function formatSessionIdentity(input: AcpSessionIdentity): string {
  const parts = [input.backend, input.runtimeSessionName, input.sessionKey];
  return parts.join('/');
}

export function parseSessionIdentity(
  identity: string
): AcpSessionIdentity | null {
  const parts = identity.split('/');
  if (parts.length < 3) {
    return null;
  }
  const [backend, runtimeSessionName, ...rest] = parts;
  return {
    backend,
    runtimeSessionName,
    sessionKey: rest.join('/'),
  };
}

export function createSessionIdentity(params: {
  sessionKey: string;
  backend: string;
  runtimeSessionName?: string;
}): AcpSessionIdentity {
  return {
    sessionKey: params.sessionKey,
    backend: params.backend,
    runtimeSessionName: params.runtimeSessionName || 'default',
  };
}

// ============ 会话标识符（原 session-identifiers.ts，已归集） ============
// 归集原因：format/parse 逻辑与上方 formatSessionIdentity/parseSessionIdentity
// 逐行重复，合并物理文件消除双实现（架构暴胀分析模式：重复实现去重）。

let counter = 0;

const RUNTIME_SESSION_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function generateRuntimeSessionName(prefix: string = 'sess'): string {
  counter += 1;
  const ts = Date.now().toString(36);
  const seq = counter.toString(36).padStart(4, '0');
  return `${prefix}_${ts}_${seq}`;
}

export function isValidRuntimeSessionName(name: string): boolean {
  return RUNTIME_SESSION_NAME_PATTERN.test(name);
}

export function formatSessionIdentifier(params: {
  sessionKey: string;
  backend: string;
  runtimeSessionName: string;
}): string {
  return `${params.backend}/${params.runtimeSessionName}/${params.sessionKey}`;
}

export function parseSessionIdentifier(identifier: string): {
  sessionKey: string;
  backend: string;
  runtimeSessionName: string;
} | null {
  const parts = identifier.split('/');
  if (parts.length < 3) {
    return null;
  }
  const [backend, runtimeSessionName, ...rest] = parts;
  return {
    backend,
    runtimeSessionName,
    sessionKey: rest.join('/'),
  };
}

export function resetSessionIdentifierCounter(): void {
  counter = 0;
}
