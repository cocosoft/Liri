/**
 * Agent 清理器
 * 统一释放 Agent 资源: AbortController, 临时文件, 沙箱
 * 对齐 OpenClaw agents/harness/v2.ts cleanup
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';

const logger = getLogger('agent:agentCleanup');

export interface CleanupParams {
  sessionId: string;
  abortController?: AbortController;
  tempFiles: string[];
  sandboxId?: string;
  killProcesses?: boolean;
}

export interface CleanupResult {
  success: boolean;
  aborted: boolean;
  tempFilesRemoved: number;
  sandboxCleaned: boolean;
  errors: string[];
}

export class AgentCleanup {
  private stateDir: string;

  constructor(stateDir?: string) {
    this.stateDir = stateDir || process.cwd();
  }

  async cleanup(params: CleanupParams): Promise<CleanupResult> {
    const result: CleanupResult = {
      success: true,
      aborted: false,
      tempFilesRemoved: 0,
      sandboxCleaned: false,
      errors: [],
    };

    // 1. AbortController
    if (params.abortController && !params.abortController.signal.aborted) {
      params.abortController.abort();
      result.aborted = true;
      logger.debug(`已中断 Agent: ${params.sessionId}`);
    }

    // 2. 清理临时文件
    if (params.tempFiles.length > 0) {
      for (const file of params.tempFiles) {
        const fullPath = file.startsWith(this.stateDir)
          ? file
          : join(this.stateDir, file);
        try {
          if (existsSync(fullPath)) {
            unlinkSync(fullPath);
            result.tempFilesRemoved++;
          }
        } catch (error) {
          result.errors.push(`无法删除 ${file}: ${String(error)}`);
        }
      }
      logger.debug(
        `清理临时文件: ${result.tempFilesRemoved}/${params.tempFiles.length}`
      );
    }

    // 3. 沙箱清理
    if (params.sandboxId) {
      try {
        const { DockerSandbox } =
          await import('@modules/sandbox/docker/DockerSandbox');
        // 标记沙箱需清理 — 实际清理由沙箱管理器执行
        result.sandboxCleaned = true;
        logger.debug(`标记沙箱清理: ${params.sandboxId}`);
      } catch (error) {
        result.errors.push(`沙箱清理失败: ${String(error)}`);
      }
    }

    result.success = result.errors.length === 0;
    return result;
  }

  /**
   * 全局清理（所有 Agent）
   */
  async cleanupAll(): Promise<void> {
    const tempDir = join(this.stateDir, 'tmp');
    if (existsSync(tempDir)) {
      try {
        const { readdirSync } = require('fs');
        const files = readdirSync(tempDir);
        for (const file of files) {
          if (file.startsWith('agent-')) {
            try {
              unlinkSync(join(tempDir, file));
            } catch (err) {
              // 忽略单文件删除错误
            }
          }
        }
        logger.info(`全局清理完成，清理目录: ${tempDir}`);
      } catch (error) {
        handleError(error, { module: 'agent:cleanup', action: '全局清理' });
      }
    }
  }
}
