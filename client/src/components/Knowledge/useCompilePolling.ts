/**
 * useCompilePolling — 知识库编译"触发 + 状态机轮询"统一 hook（Phase 0，C1/C2/C3）
 *
 * 修复点（详见 dev_docs/20260828/knowledge-frontend-review-20260828.md）：
 * - C1 编译 202 竞态假成功：triggerCompile（202 异步返回）后立即查询，后端线程未启动时
 *   状态仍 idle → 原 while(status==="compiling") 一次不进入 → 直接 100% + "编译完成"。
 * - C2 30 分钟超时误报成功：超时退出时 status 仍 compiling 且 result 为空 → 误报成功。
 * - C3 轮询逻辑在顶栏/抽屉两处重复 → 收敛于此，两入口复用。
 * - A1 done 边界：编译过快（小库 1s 内完成）时轮询捕捉不到 compiling，必须"遇 done 即成功、
 *   遇 lastError 即失败、持续 idle 才提示未启动"。
 * - A2 全局互斥：模块级 compilingGlobal，跨组件实例共享，顶栏/抽屉不可并行触发。
 */

import { useCallback } from "react";
import { knowledgeService } from "../../services/knowledgeService";

const POLL_INTERVAL = 1000;
/** 等编译启动（idle → compiling/done）的重试次数上限。
 *  KB-C9：原 10 次（10s）在大库冷启动/线程池繁忙时误报"编译任务未启动"，放宽至 30s */
const IDLE_RETRY_LIMIT = 30;
/** 进度轮询超时保护 */
const PROGRESS_DEADLINE = 30 * 60 * 1000;

/** 模块级互斥标志：跨 hook 实例共享，防止顶栏/抽屉并行触发编译 */
let compilingGlobal = false;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface CompilePollingResult {
  message: string;
  hasError: boolean;
}

interface UseCompilePollingOptions {
  /** 进度回调（0-100） */
  onProgress?: (progress: number) => void;
  /** 最终结果（成功/失败/超时/未启动） */
  onResult: (result: CompilePollingResult) => void;
  /** 无论成败都会触发的收尾回调 */
  onFinished?: () => void;
}

export function useCompilePolling(opts: UseCompilePollingOptions) {
  const { onProgress, onResult, onFinished } = opts;

  return {
    /** 触发一次编译并轮询到终态。返回 false 表示已被互斥挡住（未真正启动）。 */
    start: useCallback(async (): Promise<boolean> => {
      if (compilingGlobal) return false;
      compilingGlobal = true;
      try {
        // 刷新恢复：后端已在编译 → 直接进入进度轮询，不重复触发
        const initial = await knowledgeService.getCompileStatus();
        if (initial.status !== "compiling") {
          await knowledgeService.triggerCompile(false); // 202 立即返回
        }

        // 阶段 A：等待编译启动（idle → compiling/done）。
        // 遇 done（含 lastError）即退出循环进入结果解析；持续 idle 达到上限则报"未启动"。
        let status =
          initial.status === "compiling"
            ? initial
            : await knowledgeService.getCompileStatus();
        for (let i = 0; status.status === "idle" && i < IDLE_RETRY_LIMIT; i++) {
          await sleep(POLL_INTERVAL);
          status = await knowledgeService.getCompileStatus();
        }

        // 阶段 B：进度轮询（仅 compiling），直到 done 或超时
        if (status.status === "compiling") {
          const deadline = Date.now() + PROGRESS_DEADLINE;
          while (status.status === "compiling" && Date.now() < deadline) {
            if (status.total > 0) {
              onProgress?.(
                Math.min(99, Math.round((status.current / status.total) * 100)),
              );
            }
            await sleep(POLL_INTERVAL);
            status = await knowledgeService.getCompileStatus();
          }
          // C2：超时退出 → 明确报超时，不再误报成功
          if (status.status === "compiling") {
            onResult({
              message: "编译超时，请稍后在日志查看编译进度",
              hasError: true,
            });
            onProgress?.(100);
            return true;
          }
        }

        // 结果解析（A1：done 即终态，不做额外等待）
        const result = status.result;
        if (status.lastError && !result) {
          onResult({
            message: `编译失败: ${status.lastError}`,
            hasError: true,
          });
        } else if (result) {
          onResult({
            message:
              `编译完成: ${result.compiled} 个成功, ${result.skipped} 个跳过` +
              (result.errors ? `, ${result.errors} 个错误` : ""),
            hasError: result.errors > 0,
          });
        } else if (status.status === "idle") {
          onResult({ message: "编译任务未启动，请稍后重试", hasError: true });
        } else {
          onResult({ message: "编译完成", hasError: false });
        }
        onProgress?.(100);
        return true;
      } catch (err) {
        onResult({
          message:
            "编译失败: " + (err instanceof Error ? err.message : "未知错误"),
          hasError: true,
        });
        onProgress?.(0);
        return true;
      } finally {
        compilingGlobal = false;
        onFinished?.();
      }
    }, [onProgress, onResult, onFinished]),
  };
}
