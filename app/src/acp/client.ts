import { spawn } from 'child_process';
import type { AcpClientOptions, AcpClientHandle } from './types.js';
import {
  buildServerArgs,
  buildAcpClientStripKeys,
  resolveAcpClientSpawnEnv,
  resolveAcpClientSpawnInvocation,
} from './client-helpers.js';

export interface ClientSideConnection {
  send(data: string): void;
  onData(handler: (data: string) => void): void;
  onError(handler: (error: Error) => void): void;
  onClose(handler: () => void): void;
  close(): void;
}

export async function createAcpClient(
  opts: AcpClientOptions
): Promise<AcpClientHandle> {
  const serverCommand = opts.serverCommand || 'node';
  const serverArgs = buildServerArgs(opts);
  const invocation = resolveAcpClientSpawnInvocation(
    { serverCommand, serverArgs },
    { platform: process.platform, env: process.env, execPath: process.execPath }
  );

  const env = resolveAcpClientSpawnEnv(process.env, {
    stripKeys: buildAcpClientStripKeys(),
  });

  spawn(invocation.command, invocation.args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
    shell: invocation.shell,
    windowsHide: invocation.windowsHide,
  });

  const sessionId = `acp-client-${Date.now()}`;

  return {
    sessionId,
  };
}
