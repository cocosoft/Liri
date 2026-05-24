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
