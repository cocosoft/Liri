// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * codeRunnerWiring — CodeRunner 运行期依赖接线（issue #19 · Cut G，2026-10-29）
 *
 * 迁出来源：`ChatManager._wireCodeRunnerDeps` 的方法体（原 686–722，约 37 行）。
 *
 * 行为不变：`CODE_MODE` 关闭时**立即返回**（零副作用）；开启时三个端口逐字搬迁
 * （`readContext` / `writeEvent` / `loadUsedRounds`），日志口径不变。
 *
 * 说明：`configureCodeRunner` 是**进程级**注册表（模块单例），故本函数只做装配，
 * 不持有会话状态 —— 调用方每次装配传入当前宿主端口（与迁移前一致）。
 */

import { feature as coreFeature } from '@openliri/kernel';
import { configureCodeRunner } from '@modules/tools';
import { getLogger } from '@modules/monitoring';
import type { EventLogStorage } from '@modules/session';
import type { LiriEvent } from '@modules/session/types/events';

const logger = getLogger('chat:manager');

export interface CodeRunnerWiringDeps {
  /** 当前会话 id（按请求身份分桶；无会话 ⇒ null） */
  getCurrentSessionId: () => string | null;
  /** per-session 事件日志实例（复用宿主 LRU 缓存） */
  getOrCreateEventLog: (sessionId: string) => EventLogStorage;
  /** 事件写入（seq 由调用方按 tailSeq 分配） */
  appendStreamEvent: (
    sessionId: string,
    event: LiriEvent
  ) => Promise<{ ok: boolean; reason?: string; tailSeq: number }>;
}

/**
 * CM-6：CodeRunner 运行期依赖接线（CODE_MODE 开启时配置）
 * readContext 复用 per-session EventLogStorage.read；
 * writeEvent 复用 appendStreamEvent（seq 取自 EventLogStorage tailSeq）。
 */
export function wireCodeRunnerDeps(deps: CodeRunnerWiringDeps): void {
  if (!coreFeature('CODE_MODE')) return;
  configureCodeRunner({
    readContext: async (opts) => {
      const sid = deps.getCurrentSessionId();
      if (!sid) return { unavailable: true, reason: 'no active session' };
      const log = deps.getOrCreateEventLog(sid);
      return log.read({ limit: opts?.limit ?? 100 });
    },
    writeEvent: async (type, data) => {
      const sid = deps.getCurrentSessionId();
      if (!sid) return;
      const log = deps.getOrCreateEventLog(sid);
      const tail = await log.getTailSeq();
      await deps.appendStreamEvent(sid, {
        type: type as LiriEvent['type'],
        schemaVersion: 1,
        seq: tail + 1,
        time: Date.now(),
        sessionId: sid,
        data: data as LiriEvent['data'],
      });
    },
    // CM-1 持久化重建：统计会话事件流中 code_run 事件数作为已用轮次
    loadUsedRounds: async () => {
      const sid = deps.getCurrentSessionId();
      if (!sid) return 0;
      const log = deps.getOrCreateEventLog(sid);
      const events = await log.read({
        types: ['assistant/code_run' as LiriEvent['type']],
        limit: 10000,
      });
      return events.length;
    },
  });
  logger.info('CodeRunner runtime deps wired (CODE_MODE enabled)');
}
