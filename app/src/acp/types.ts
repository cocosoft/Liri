export const ACP_PROTOCOL_VERSION = '1.0';

export const ACP_SESSION_ID_PREFIX = 'acp-sess-';

export const ACP_PROVENANCE_MODE_VALUES = [
  'off',
  'meta',
  'meta+receipt',
] as const;

export type AcpProvenanceMode = (typeof ACP_PROVENANCE_MODE_VALUES)[number];

export type SessionId = string & { __brand: 'SessionId' };

export interface AcpSession {
  sessionId: SessionId;
  sessionKey: string;
  cwd: string;
  createdAt: number;
  lastTouchedAt: number;
  abortController: AbortController | null;
  activeRunId: string | null;
}

export interface AcpServerOptions {
  gatewayUrl?: string;
  gatewayToken?: string;
  gatewayPassword?: string;
  defaultSessionKey?: string;
  defaultSessionLabel?: string;
  requireExistingSession?: boolean;
  resetSession?: boolean;
  prefixCwd?: boolean;
  provenanceMode?: AcpProvenanceMode;
  sessionCreateRateLimit?: {
    maxRequests?: number;
    windowMs?: number;
  };
  verbose?: boolean;
}

export interface AcpClientOptions {
  cwd?: string;
  serverCommand?: string;
  serverArgs?: string[];
  serverVerbose?: boolean;
  verbose?: boolean;
}

export interface AcpClientHandle {
  sessionId: string;
}

export const ACP_AGENT_INFO = {
  name: 'pyapp-acp',
  title: 'PY_APP ACP Gateway',
  version: '1.0.0',
};

export type AcpApprovalClass =
  | 'always_allow'
  | 'requires_approval'
  | 'requires_approval_and_audit'
  | 'requires_explicit_approval'
  | 'blocked'
  | 'auto_approve'
  | 'tool_fallback';
