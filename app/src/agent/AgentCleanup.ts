/**
 * Agent 清理器
 * 统一释放 Agent 资源: AbortController, 临时文件, 沙箱
 * 对齐 OpenClaw agents/harness/v2.ts cleanup
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import type { EffectScope } from '@modules/context/EffectScope';

const logger = getLogger('agent:agentCleanup');

export interface CleanupParams {
  sessionId: string;
  abortController?: AbortController;
  tempFiles: string[];
  sandboxId?: string;
  killProcesses?: boolean;
  /**
   * 副作用作用域（T1.2）。scope 存在时清理完全委托 scope.dispose()，
   * 按"沙箱 → 文件 → abort"顺序登记的逆操作以 LIFO 执行
   * （实际执行顺序 abort → 文件 → 沙箱，与旧语义一致）。
   */
  scope?: EffectScope;
  /** 临时文件相对解析根（默认 process.cwd()；registerToScope 使用） */
  stateDir?: string;
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

    // 0. scope 委托模式（T1.2）：scope 存在时完全委托 scope.dispose()，
    //    dispose 失败即上报，不静默回退 tempFiles（避免双路径语义混乱）
    if (params.scope) {
      try {
        await params.scope.dispose();
        // scope 内部逆操作已按"沙箱 → 文件 → abort"登记，LIFO 执行
        // 结果字段由登记时写入，此处仅标记成功
        if (params.abortController && params.abortController.signal.aborted) {
          result.aborted = true;
        }
      } catch (error) {
        result.errors.push(`scope 清理失败: ${String(error)}`);
        await handleError(error, {
          module: 'agent:cleanup',
          action: 'scope dispose',
          context: { sessionId: params.sessionId },
        });
      }
      result.success = result.errors.length === 0;
      return result;
    }

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
   * 将清理参数登记到 EffectScope（T1.2）。
   * 登记顺序必须为"沙箱 → 文件 → abort"：LIFO 逆序执行后
   * 实际清理顺序为 abort → 文件 → 沙箱，与 cleanup() 旧语义一致。
   * @returns 结果引用（dispose 后字段被填充）
   */
  static registerToScope(
    scope: EffectScope,
    params: CleanupParams
  ): CleanupResult {
    const result: CleanupResult = {
      success: true,
      aborted: false,
      tempFilesRemoved: 0,
      sandboxCleaned: false,
      errors: [],
    };
    const stateDir = params.stateDir ?? process.cwd();

    // 3. 沙箱（最先登记 → 最后执行）
    if (params.sandboxId) {
      scope.onDispose(() => {
        try {
          // 标记沙箱需清理 — 实际清理由沙箱管理器执行
          result.sandboxCleaned = true;
          logger.debug(`标记沙箱清理: ${params.sandboxId}`);
        } catch (error) {
          result.errors.push(`沙箱清理失败: ${String(error)}`);
        }
      });
    }

    // 2. 临时文件
    if (params.tempFiles.length > 0) {
      scope.onDispose(() => {
        for (const file of params.tempFiles) {
          const fullPath = file.startsWith(stateDir)
            ? file
            : join(stateDir, file);
          try {
            if (existsSync(fullPath)) {
              unlinkSync(fullPath);
              result.tempFilesRemoved++;
            }
          } catch (error) {
            result.errors.push(`无法删除 ${file}: ${String(error)}`);
          }
        }
      });
    }

    // 1. AbortController（最后登记 → 最先执行）
    if (params.abortController) {
      scope.onDispose(() => {
        if (!params.abortController!.signal.aborted) {
          params.abortController!.abort();
          result.aborted = true;
          logger.debug(`已中断 Agent: ${params.sessionId}`);
        }
      });
    }

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
