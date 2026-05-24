import { spawn, type ChildProcess } from 'node:child_process';
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

function createStdioConnection(proc: ChildProcess): ClientSideConnection {
  let dataHandler: ((data: string) => void) | null = null;
  let errorHandler: ((error: Error) => void) | null = null;
  let closeHandler: (() => void) | null = null;

  if (proc.stdout) {
    proc.stdout.on('data', (chunk: Buffer) => {
      if (dataHandler) {
        dataHandler(chunk.toString('utf-8'));
      }
    });
  }

  if (proc.stderr) {
    proc.stderr.on('data', (chunk: Buffer) => {
      if (errorHandler) {
        errorHandler(new Error(chunk.toString('utf-8')));
      }
    });
  }

  proc.on('close', () => {
    if (closeHandler) {
      closeHandler();
    }
  });

  proc.on('error', (err: Error) => {
    if (errorHandler) {
      errorHandler(err);
    }
  });

  return {
    send(data: string): void {
      if (proc.stdin) {
        proc.stdin.write(data);
      }
    },
    onData(handler: (data: string) => void): void {
      dataHandler = handler;
    },
    onError(handler: (error: Error) => void): void {
      errorHandler = handler;
    },
    onClose(handler: () => void): void {
      closeHandler = handler;
    },
    close(): void {
      proc.kill();
    },
  };
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

  const child = spawn(invocation.command, invocation.args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
    shell: invocation.shell,
    windowsHide: invocation.windowsHide,
  });

  const _connection = createStdioConnection(child);

  const sessionId = `acp-client-${Date.now()}`;

  return {
    sessionId,
  };
}
