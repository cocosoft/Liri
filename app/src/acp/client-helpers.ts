import type { AcpClientOptions, AcpApprovalClass } from './types.js';
import type { AcpRuntimeEnsureInput } from './runtime/types.js';

export function buildServerArgs(opts: AcpClientOptions): string[] {
  const args: string[] = [];
  if (opts.serverArgs) {
    args.push(...opts.serverArgs);
  }
  if (opts.serverVerbose) {
    args.push('--verbose');
  }
  if (opts.cwd) {
    args.push('--cwd', opts.cwd);
  }
  return args;
}

const SENSITIVE_ENV_PREFIXES = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'DATABASE_URL',
  'REDIS_URL',
];

export function buildAcpClientStripKeys(params?: {
  stripProviderAuthEnvVars?: boolean;
  activeSkillEnvKeys?: Iterable<string>;
}): Set<string> {
  const keys = new Set<string>();

  if (params?.stripProviderAuthEnvVars !== false) {
    for (const prefix of SENSITIVE_ENV_PREFIXES) {
      keys.add(prefix);
    }
  }

  if (params?.activeSkillEnvKeys) {
    for (const key of params.activeSkillEnvKeys) {
      keys.add(key);
    }
  }

  return keys;
}

export function resolveAcpClientSpawnEnv(
  baseEnv: NodeJS.ProcessEnv,
  options?: { stripKeys?: Iterable<string> }
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  const stripKeys = options?.stripKeys;

  if (stripKeys) {
    for (const key of stripKeys) {
      delete env[key];
    }
  }

  return env;
}

export function resolveAcpClientSpawnInvocation(
  params: { serverCommand: string; serverArgs: string[] },
  _context: {
    platform: NodeJS.Platform;
    env: NodeJS.ProcessEnv;
    execPath: string;
  }
): { command: string; args: string[]; shell: boolean; windowsHide: boolean } {
  return {
    command: params.serverCommand,
    args: params.serverArgs,
    shell: false,
    windowsHide: true,
  };
}

export interface ResolvePermissionRequestParams {
  approvalClass: AcpApprovalClass;
  toolName: string;
  autoApprove: boolean;
  sessionKey: string;
}

export interface RequestPermissionResponse {
  allowed: boolean;
  reason?: string;
}

export async function resolvePermissionRequest(
  params: ResolvePermissionRequestParams,
  _deps?: { prompt?: (msg: string) => Promise<string> }
): Promise<RequestPermissionResponse> {
  if (params.autoApprove) {
    return { allowed: true, reason: 'auto-approved' };
  }
  return { allowed: false, reason: 'manual approval required' };
}
