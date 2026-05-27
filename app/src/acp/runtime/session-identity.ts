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
