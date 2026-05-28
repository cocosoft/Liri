// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
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
