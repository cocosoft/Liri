/**
 * taor/stopHooks.ts — TAORLoop 默认停止钩子注册
 *
 * 由 `query/TAORLoop.ts` 外迁（大文件拆分，见
 * `.trae/specs/file-size-debt-partition-plan.md` §42）：**只搬不改**（含全部原注释与
 * 日志文案）。原为宿主私有方法 `registerDefaultStopHooks()`，其中 6/8 个钩子**只读
 * 上下文参数**；仅两处需宿主状态（`turnCount`/`startTime` 读、三个守卫 reset 写）
 * ⇒ 以**窄端口** `deps` 注入，宿主行为逐字不变。
 */

import { getLogger } from '@modules/monitoring';
import { DEFAULT_STOP_HOOK_PRIORITIES, StopHookManager } from '../StopHooks.js';
import type { StopHookContext } from '../StopHooks.js';

const logger = getLogger('query:taorLoop');

/** 宿主状态窄端口（仅原 `registerDefaultStopHooks` 实际触及的两类访问） */
export interface TAORStopHookDeps {
  /** 当前轮次（`this.turnCount`） */
  getTurnCount: () => number;
  /** 本轮起始时刻（`this.startTime`） */
  getStartTime: () => number;
  /** 复位三个守卫：`errorRecovery.resetAll()` + `circuitBreaker.reset()` + `loopDetector.reset()` */
  resetGuards: () => void;
}

export function registerDefaultStopHooks(
  stopHookManager: StopHookManager,
  deps: TAORStopHookDeps
): void {
  stopHookManager.registerHook({
    name: 'taor_token_budget',
    priority: DEFAULT_STOP_HOOK_PRIORITIES.HIGH,
    hook: async (context: StopHookContext) => {
      logger.info('TAOR loop token budget stop', {
        reason: context.reason,
        usage: context.usage,
      });
    },
  });

  stopHookManager.registerHook({
    name: 'taor_max_turns',
    priority: DEFAULT_STOP_HOOK_PRIORITIES.MEDIUM,
    hook: async (context: StopHookContext) => {
      logger.info('TAOR loop max turns stop', { turns: context.turnCount });
    },
  });

  stopHookManager.registerHook({
    name: 'taor_completion',
    priority: DEFAULT_STOP_HOOK_PRIORITIES.LOW,
    hook: async () => {
      logger.info('TAOR loop completed', {
        turns: deps.getTurnCount(),
        duration: Date.now() - deps.getStartTime(),
      });
    },
  });

  // Phase 4: 丰富化停止钩子
  stopHookManager.registerHook({
    name: 'taor_audit_trail',
    priority: DEFAULT_STOP_HOOK_PRIORITIES.LOW,
    hook: async (context: StopHookContext) => {
      logger.info('TAOR audit trail', {
        sessionId: context.sessionId,
        reason: context.reason,
        turns: context.turnCount,
        durationMs: context.durationMs,
      });
    },
  });

  stopHookManager.registerHook({
    name: 'taor_cleanup',
    priority: DEFAULT_STOP_HOOK_PRIORITIES.LOW,
    hook: async () => {
      deps.resetGuards();
    },
  });

  // Phase 4: 丰富化停止钩子
  stopHookManager.registerHook({
    name: 'extract_memories',
    priority: DEFAULT_STOP_HOOK_PRIORITIES.LOW,
    hook: async (context: StopHookContext) => {
      // 仅在正常完成时触发，aborted 时跳过
      if (context.reason === 'aborted') return;
      logger.info('stop hook: extract_memories triggered', {
        sessionId: context.sessionId,
        turns: context.turnCount,
      });
      // 实际记忆提取由 MemoryExtractionService 异步完成
    },
  });

  stopHookManager.registerHook({
    name: 'classify_task',
    priority: DEFAULT_STOP_HOOK_PRIORITIES.LOW,
    hook: async (context: StopHookContext) => {
      logger.info('stop hook: classify_task', {
        sessionId: context.sessionId,
        reason: context.reason,
        turns: context.turnCount,
      });
      // 根据 context 推断任务类型：单轮→qa，多轮→planning，大量工具调用→automation
    },
  });

  stopHookManager.registerHook({
    name: 'auto_dream',
    priority: DEFAULT_STOP_HOOK_PRIORITIES.LOW,
    hook: async (context: StopHookContext) => {
      // 仅在 completed 且 非 aborted 时触发后台子任务
      if (context.reason !== 'completed') return;
      logger.info('stop hook: auto_dream triggered', {
        sessionId: context.sessionId,
      });
      // 实际子任务由 DreamService 调度
    },
  });

  stopHookManager.registerHook({
    name: 'computer_use_cleanup',
    priority: DEFAULT_STOP_HOOK_PRIORITIES.LOW,
    hook: async (context: StopHookContext) => {
      logger.info('stop hook: computer_use_cleanup', {
        sessionId: context.sessionId,
      });
      // 清理 computer use 相关资源（截图缓存、沙箱环境等）
    },
  });
}
