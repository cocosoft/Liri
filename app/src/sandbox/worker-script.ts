/**
 * Worker 线程脚本
 * 在独立的 Worker 线程中执行插件命令，实现进程级隔离
 */

import { parentPort, workerData } from 'worker_threads';
import { exec } from 'child_process';
import { promisify } from 'util';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'sandbox:worker-script',
  level: LogLevel.INFO,
});

const execAsync = promisify(exec);

interface ExecuteRequest {
  type: 'execute';
  requestId: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeout: number;
}

interface ExecuteResponse {
  type: 'result' | 'error';
  requestId: string;
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  executionTime: number;
  error?: string;
}

if (!parentPort) {
  throw new Error('worker-script.ts must be run as a Worker thread');
}

parentPort.on('message', async (request: ExecuteRequest) => {
  if (request.type !== 'execute') return;

  const startTime = Date.now();

  try {
    const command = request.args.join(' ');

    const { stdout, stderr } = await execAsync(command, {
      cwd: request.cwd,
      env: request.env ? { ...process.env, ...request.env } : process.env,
      timeout: request.timeout,
      maxBuffer: 1024 * 1024,
    });

    const response: ExecuteResponse = {
      type: 'result',
      requestId: request.requestId,
      success: true,
      exitCode: 0,
      stdout: stdout || '',
      stderr: stderr || '',
      executionTime: Date.now() - startTime,
    };

    parentPort!.postMessage(response);
  } catch (error: any) {
    const response: ExecuteResponse = {
      type: 'result',
      requestId: request.requestId,
      success: false,
      exitCode: error.code || 1,
      stdout: error.stdout || '',
      stderr: error.stderr || error.message || String(error),
      executionTime: Date.now() - startTime,
      error: error.message || String(error),
    };

    parentPort!.postMessage(response);
  }
});
