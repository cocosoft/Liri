// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * TAORLoop 实例工厂（E 批外移，2026-11-05）
 *
 * 从 `ChatManager._getOrCreateTAORLoop` 迁出（原 887–978，约 90 行）—— 口径逐字保持：
 * - 空 `sessionId` 拒绝创建（P0 2026-08-14：防单例首次固化空 id 导致会话串扰）；
 * - `privateInstance` ⇒ **不入缓存**的全新实例（LRTO 任务私有，检查点由任务自己管）；
 * - 普通/扩容实例按 `SessionScopedRegistry` 分键缓存（`::turnsX<n>`），拆除时精确回收；
 * - 每次取用都 `registerTAORLoop(sessionId, …)`，让 checkpoint 恢复端点指向**最近使用**实例。
 *
 * 日志 module 仍为 `chat:manager`（与迁移前一致）。
 */

import { configManager } from '@openliri/infra/config';
import { getLogger } from '@openliri/infra/monitoring';
import { registerTAORLoop } from '@modules/infrastructure';
import type { TAORLoopConfig } from '@modules/query';

import { createChatAgentLoop } from '../createAgentLoop.js';

const logger = getLogger('chat:manager');

/** 基础轮次上限（env `MAX_TAOR_TURNS` 可覆盖） */
const DEFAULT_MAX_TAOR_TURNS = 300;

/** 循环实例类型（与 `createChatAgentLoop` 返回一致） */
export type ChatAgentLoop = ReturnType<typeof createChatAgentLoop>;

export interface TaorLoopHost {
  /** 查询引擎（懒创建，同一宿主实例复用） */
  getQueryEngine(): Parameters<typeof createChatAgentLoop>[0]['queryEngine'];
  /** 配置了 verifier 角色时返回其调用器（未配置 ⇒ undefined，键不存在 ⇒ 零行为变更） */
  getVerifierModel(): TAORLoopConfig['verifierModel'];
  /** 会话级循环缓存（`SessionScopedRegistry<TAORLoop>`） */
  loops: {
    getOrCreate(
      sessionId: string,
      factory: () => ChatAgentLoop,
      keySuffix?: string
    ): ChatAgentLoop;
  };
}

export interface TaorLoopOptions {
  maxTurnsMultiplier?: number;
  privateInstance?: boolean;
}

function resolveBaseMaxTurns(): number {
  return (
    parseInt(configManager.env('MAX_TAOR_TURNS') || '') ||
    DEFAULT_MAX_TAOR_TURNS
  );
}

/** 获取或创建 TAORLoop 实例（懒初始化；语义见文件头） */
export function getOrCreateTaorLoop(
  host: TaorLoopHost,
  sessionId: string,
  opts?: TaorLoopOptions
): ChatAgentLoop {
  // P0 修复（2026-08-14 排查）：空 sessionId 拒绝创建——原单例首次调用固化空 id，
  // 导致所有会话串扰同一 TAORLoop。改为按 sessionId 的 Map 缓存 + 非空校验。
  if (!sessionId) {
    logger.warn(
      '_getOrCreateTAORLoop: 拒绝空 sessionId（防 TAORLoop 串扰污染）'
    );
    throw new Error('TAORLoop requires a non-empty sessionId');
  }
  const multiplier = opts?.maxTurnsMultiplier ?? 1;
  const verifierModel = host.getVerifierModel();

  // S1（2026-09-05，PR9）：privateInstance=true → LRTO 任务私有实例——
  // 每次调用全新构建、不入任何缓存（中止/销毁安全，不伤同会话普通对话）。
  if (opts?.privateInstance) {
    const baseMaxTurns = resolveBaseMaxTurns();
    return createChatAgentLoop({
      mode: 'batch',
      queryEngine: host.getQueryEngine(),
      config: {
        sessionId,
        maxTurns: multiplier > 1 ? baseMaxTurns * multiplier : baseMaxTurns,
        // 归属③（2026-09-05）：任务私有实例关闭 DB 检查点——任务级持久化由
        // LRTO._persistCheckpoint 承担；否则此类 checkpoint 会被 Durable Resume
        // 当作会话恢复（sessionId=taskId）造成任务上下文串入普通对话恢复。
        enableCheckpoint: false,
        checkpointInterval: 0,
        // G-3：仅在配置了 verifier 角色时注入（未配置 ⇒ 键不存在，行为零变化）
        ...(verifierModel ? { verifierModel } : {}),
      },
    });
  }

  // S1（2026-09-05，PR9/B-任务）：扩容续跑时创建放大轮次预算的独立实例——
  // 与基础实例分键缓存（同 multiplier 复用，避免每次 re-roll 新建实例）。
  // 2026-10-19（源码排查 S1）：键为 `sessionId`（基础）/ `sessionId::turnsX<n>`（扩容），
  // 由注册表登记「会话 → 键集合」⇒ 拆除时精确回收全部变体。
  const taorLoop = host.loops.getOrCreate(
    sessionId,
    () => {
      const baseMaxTurns = resolveBaseMaxTurns();
      // 阶段 2（2026-09-01）：统一循环工厂（mode='batch'）替代直接 createTAORLoop
      return createChatAgentLoop({
        mode: 'batch',
        queryEngine: host.getQueryEngine(),
        config: {
          sessionId,
          maxTurns: multiplier > 1 ? baseMaxTurns * multiplier : baseMaxTurns,
          /** 启用检查点，每 3 轮自动保存（原值：关闭 + 5 轮） */
          enableCheckpoint: true,
          checkpointInterval: 3,
          // G-3：仅在配置了 verifier 角色时注入（未配置 ⇒ 键不存在，行为零变化）
          ...(verifierModel ? { verifierModel } : {}),
        },
      });
    },
    multiplier > 1 ? String(multiplier) : undefined
  );

  // F2（2026-10-12，预算挂起续跑 Task 3）：把实例登记进活跃注册表
  // （`checkpoint-handlers` 的 `activeLoops`）。注册键用 **sessionId**（非 cacheKey）：
  // 端点寻址键即路径段 sessionId，而 cacheKey 在 multiplier>1 时带 `::turnsXn` 后缀。
  // 2026-10-19（D2/D3 修复）：登记从「仅首次创建」改为**每次取用**（端点始终指向最近使用实例）。
  const activeLoop = taorLoop;
  registerTAORLoop(sessionId, {
    getCheckpointsForSession: () => activeLoop.getCheckpointsForSession(),
    resumeFromCheckpoint: (id?: string) => activeLoop.resumeFromCheckpoint(id),
  });
  return taorLoop;
}
