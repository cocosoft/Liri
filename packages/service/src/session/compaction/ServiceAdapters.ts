// 2026-10-01 D-217（子批 E `chat` 组）：原静态导入 app 侧
// `@openliri/service/services/compact/AutoCompactService`；该目录改归 app（现为独立模块 `@modules/compaction`）后
// 会构成 `session -> compaction`(app) 倒挂 ⇒ 改经 **CoreAPI 同步门面**（既有 sanctioned 缝）。
// ⚠️ 用**同步**门面而非 Promise 端口：本文件由 `SessionGateway` 的**构造函数**与
// **同步 fluent API**（`wireWithRealServices(): this`）调用 ⇒ 改异步会向上传染。
// P1（2026-11-13，session 并入 `packages/service`）：门面改经**推送注入端口**取（同 P37），
// 不再值导入 app 的 `CoreAPIImpl`；未注册 ⇒ 保持"未接线"并告警（与既有降级口径一致）。
import { getRuntimeCoreApi } from '@openliri/service/runtime/api/coreApiProvider';
import { getLogger } from '@openliri/infra/monitoring';
import type { AutoCompactServiceRefPort } from '@openliri/service/runtime/api/compactPorts';
// 2026-10-01（B11 余 1 条 · `session -> chat` 收口）：原**整条**静态导入 `@modules/chat`
// （值 `getCheckpointService` + 类型 `SessionCheckpointService`）⇒ 构成 `session -> chat`(app) 倒挂。
// 该取用是**装配值**（非类型）⇒ 移类型文件治不了 ⇒ 改经 **CoreAPI 同步门面**（既有 sanctioned 缝，
// 同 `getCheckpointCleanup()`）：`CoreAPIImpl.getSessionCheckpointRef()`；投影见
// `./runtime/api/sessionCheckpointPorts#SessionCheckpointRefPort`（只声明真正被调用的 1 方法 + 被读的 2 字段）。
// ⚠️ 本导入必须**整条**去掉（值 + 类型一并）—— 只删值导入则该「文件 × 模块」对仍在、计数不减。
import type { SessionCheckpointRefPort } from '@openliri/service/runtime/api/sessionCheckpointPorts';
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
import { resolveDataDir } from '@openliri/infra/environment';

const logger = getLogger('session:compaction:adapters');

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
  constructor(private real: SessionCheckpointRefPort) {}

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

  const core = getRuntimeCoreApi();
  if (!core?.createAutoCompactService || !core.getSessionCheckpointRef) {
    logger.warning('组合根端口未注册：压缩桥接保持未接线（autoCompact / checkpoint）');
    return bridge;
  }

  const autoCompactService = core.createAutoCompactService();
  const adapter = new AutoCompactServiceAdapter(autoCompactService);
  bridge.setAutoCompactService(adapter);

  const checkpointService = core.getSessionCheckpointRef();
  bridge.setCheckpointService(
    new SessionCheckpointServiceAdapter(checkpointService)
  );

  // 注册分层压缩策略引擎
  bridge.registerEngine(new SummaryCompactor(100, 30, adapter));
  bridge.registerEngine(new LayeredCompactor(80, 20, adapter));
  bridge.registerEngine(new KeyInfoExtractor(60, adapter));

  return bridge;
}
