// 2026-10-01 D-217（子批 E `chat` 组）：原静态导入 app 侧
// `@modules/services/compact/AutoCompactService`；该目录改归 app（现为独立模块 `@modules/compaction`）后
// 会构成 `session -> compaction`(app) 倒挂 ⇒ 改经 **CoreAPI 同步门面**（既有 sanctioned 缝）。
// ⚠️ 用**同步**门面而非 Promise 端口：本文件由 `SessionGateway` 的**构造函数**与
// **同步 fluent API**（`wireWithRealServices(): this`）调用 ⇒ 改异步会向上传染。
import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';
import type { AutoCompactServiceRefPort } from '@modules/runtime/api/compactPorts';
import {
  SessionCheckpointService as RealCheckpointService,
  getCheckpointService,
} from '@modules/chat';
import type {
  SessionCheckpointService,
  SessionCheckpointHandle,
} from './SessionCompactionBridge';
import type { AutoCompactServiceRef } from './CompactionTypes';
import { SessionCompactionBridge } from './SessionCompactionBridge';
import { SummaryCompactor } from './SummaryCompactor';
import { LayeredCompactor } from './LayeredCompactor';
import { KeyInfoExtractor } from './KeyInfoExtractor';
import { join } from 'path';
import { resolveDataDir } from '@modules/core';

export class AutoCompactServiceAdapter implements AutoCompactServiceRef {
  constructor(private real: AutoCompactServiceRefPort) {}

  checkAndCompact(
    sessionId: string,
    messages: unknown[],
    model: string
  ): { shouldCompact: boolean } {
    return this.real.checkAndCompact(sessionId, messages as never[], model);
  }

  async performAutoCompact(
    sessionId: string,
    messages: unknown[],
    model: string
  ): Promise<{ success: boolean; error?: string }> {
    const result = await this.real.performAutoCompact(
      sessionId,
      messages as never[],
      model
    );
    return { success: result.success, error: result.error };
  }
}

export class SessionCheckpointServiceAdapter implements SessionCheckpointService {
  constructor(private real: RealCheckpointService) {}

  async createCheckpoint(
    sessionId: string
  ): Promise<SessionCheckpointHandle | null> {
    try {
      const cp = await this.real.createCheckpoint({
        sessionId,
        autoCreated: true,
      });
      return { id: cp.id, createdAt: cp.createdAt };
    } catch {
      return null;
    }
  }
}

export function createWiredCompactionBridge(): SessionCompactionBridge {
  // M2-fix: 压缩历史 JSONL 持久化到 ~/.pyapp/data/sessions/compaction-history.jsonl，
  // 跨重启可恢复（违反 R08-001 的原纯内存实现已修正）
  const bridge = new SessionCompactionBridge({
    recordHistoryPath: join(
      resolveDataDir(),
      'sessions',
      'compaction-history.jsonl'
    ),
  });

  const autoCompactService = getCoreAPI().createAutoCompactService();
  const adapter = new AutoCompactServiceAdapter(autoCompactService);
  bridge.setAutoCompactService(adapter);

  const checkpointService = getCheckpointService();
  bridge.setCheckpointService(
    new SessionCheckpointServiceAdapter(checkpointService)
  );

  // 注册分层压缩策略引擎
  bridge.registerEngine(new SummaryCompactor(100, 30, adapter));
  bridge.registerEngine(new LayeredCompactor(80, 20, adapter));
  bridge.registerEngine(new KeyInfoExtractor(60, adapter));

  return bridge;
}
