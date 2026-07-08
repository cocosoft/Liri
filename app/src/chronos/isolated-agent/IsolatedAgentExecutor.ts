/**
 * IsolatedAgentExecutor 隔离 Agent 执行器
 * 对标 OpenClaw 的隔离 Agent 运行机制
 */
import { spawn } from 'node:child_process';
import path from 'path';
import fs from 'node:fs';
import os from 'node:os';
import { handleError } from '@modules/error';

/**
 * 执行配置
 */
export interface AgentExecutionConfig {
  taskId: string;
  command: string;
  args: string[];
  timeout: number;
  workDir?: string;
  envVars?: Record<string, string>;
  resourceLimits?: {
    maxMemory?: number;
    maxCpu?: number;
  };
}

/**
 * 执行结果
 */
export interface AgentExecutionResult {
  success: boolean;
  taskId: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  duration: number;
  error?: string;
}

/**
 * 隔离 Agent 执行器
 */
export class IsolatedAgentExecutor {
  /**
   * 在隔离环境中执行任务
   */
  async execute(config: AgentExecutionConfig): Promise<AgentExecutionResult> {
    const startTime = Date.now();
    const workDir =
      config.workDir || path.join(os.tmpdir(), 'pyapp_agents', config.taskId);

    fs.mkdirSync(workDir, { recursive: true });

    return new Promise((resolve) => {
      const child = spawn(config.command, config.args, {
        cwd: workDir,
        env: {
          ...process.env,
          ...config.envVars,
          LIRI_TASK_ID: config.taskId,
          LIRI_ISOLATED: 'true',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: config.timeout,
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('close', (exitCode) => {
        const duration = Date.now() - startTime;

        this.cleanupWorkDir(workDir);

        resolve({
          success: exitCode === 0,
          taskId: config.taskId,
          exitCode,
          stdout,
          stderr,
          duration,
        });
      });

      child.on('error', (err) => {
        const duration = Date.now() - startTime;

        this.cleanupWorkDir(workDir);

        resolve({
          success: false,
          taskId: config.taskId,
          exitCode: null,
          stdout,
          stderr,
          duration,
          error: err.message,
        });
      });
    });
  }

  /**
   * 清理工作目录
   */
  private cleanupWorkDir(workDir: string): void {
    try {
      if (fs.existsSync(workDir)) {
        const files = fs.readdirSync(workDir);

        for (const file of files) {
          const filePath = path.join(workDir, file);
          fs.unlinkSync(filePath);
        }

        fs.rmdirSync(workDir);
      }
    } catch (err) {
      void handleError(err, {
        module: 'chronos:isolated-agent',
        action: 'catch_error',
      });
    }
  }
}

export const isolatedAgentExecutor = new IsolatedAgentExecutor();
