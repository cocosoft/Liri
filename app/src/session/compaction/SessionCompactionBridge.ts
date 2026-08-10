/**
 * SessionCompactionBridge — 将会话生命周期与 AutoCompactService 桥接
 *
 * 职责：
 * 1. 集成现有 services/compact/AutoCompactService 的压缩能力
 * 2. 在压缩前自动创建检查点（通过 SessionCheckpointService）
 * 3. 记录压缩历史到 CompactionRecord
 * 4. 提供会话生命周期的压缩钩子
 *
 * 不重复实现：消息压缩、边界检测、记忆压缩委托给 AutoCompactService
 */

import type { Session } from '../models/Session';
import type { CompactionRecord } from './CompactionRecord';
import { createCompactionRecord } from './CompactionRecord';
import type {
  CompactionEngine,
  AutoCompactServiceRef,
} from './CompactionTypes';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { SummaryCompactor } from './SummaryCompactor';
import { LayeredCompactor } from './LayeredCompactor';
import { KeyInfoExtractor } from './KeyInfoExtractor';

const logger = getLogger('session:compactionBridge');

export interface CompactionBridgeConfig {
  enabled: boolean;
  autoCheckpointBeforeCompact: boolean;
  maxRecordsPerSession: number;
  compactOnThreshold: boolean;
  thresholdPercent: number;
}

const DEFAULT_BRIDGE_CONFIG: CompactionBridgeConfig = {
  enabled: true,
  autoCheckpointBeforeCompact: true,
  maxRecordsPerSession: 20,
  compactOnThreshold: true,
  thresholdPercent: 0.85,
};

export interface SessionCheckpointHandle {
  id: string;
  createdAt: number;
}

export interface CompactionSessionService {
  createCheckpoint(sessionId: string): Promise<SessionCheckpointHandle | null>;
}

export interface SessionCheckpointService {
  createCheckpoint(sessionId: string): Promise<SessionCheckpointHandle | null>;
}

export class SessionCompactionBridge {
  private config: CompactionBridgeConfig;
  private records: Map<string, CompactionRecord[]> = new Map();
  private engines: CompactionEngine[] = [];
  private checkpointService: SessionCheckpointService | null = null;
  private autoCompactService: AutoCompactServiceRef | null = null;

  constructor(config?: Partial<CompactionBridgeConfig>) {
    this.config = { ...DEFAULT_BRIDGE_CONFIG, ...config };
    this.registerDefaultEngines();
  }

  /**
   * 注册默认压缩引擎（SummaryCompactor, LayeredCompactor, KeyInfoExtractor）
   */
  private registerDefaultEngines(): void {
    this.registerEngine(new SummaryCompactor());
    this.registerEngine(new LayeredCompactor());
    this.registerEngine(new KeyInfoExtractor());
  }

  setAutoCompactService(service: AutoCompactServiceRef): void {
    this.autoCompactService = service;
  }

  setCheckpointService(service: SessionCheckpointService): void {
    this.checkpointService = service;
  }

  registerEngine(engine: CompactionEngine): void {
    this.engines.push(engine);
    logger.debug('Compaction engine registered', {
      name: engine.constructor.name,
    });
  }

  async beforeCompact(
    session: Session,
    model: string
  ): Promise<{ proceed: boolean; checkpointId?: string; reason: string }> {
    if (!this.config.enabled) {
      return { proceed: false, reason: 'Compaction disabled' };
    }

    let checkpointId: string | undefined;

    if (this.config.autoCheckpointBeforeCompact && this.checkpointService) {
      try {
        const handle = await this.checkpointService.createCheckpoint(
          session.id
        );
        if (handle) {
          checkpointId = handle.id;
          logger.info('Checkpoint created before compaction', {
            sessionId: session.id,
            checkpointId: handle.id,
          });
        }
      } catch (e) {
        logger.warn('Failed to create checkpoint before compaction', {
          sessionId: session.id,
          error: String(e),
        });
      }
    }

    // 优先使用 autoCompactService，若未配置则查询已注册的 engines
    let shouldCompact = false;
    if (this.autoCompactService) {
      shouldCompact = this.autoCompactService.checkAndCompact(
        session.id,
        session.messages as never[],
        model
      ).shouldCompact;
    } else {
      shouldCompact = this.engines.some(
        (engine) =>
          engine.checkAndCompact(session.id, session.messages, model)
            .shouldCompact
      );
    }

    return {
      proceed: shouldCompact,
      checkpointId,
      reason: shouldCompact
        ? 'Threshold exceeded, proceeding with compaction'
        : 'Below compaction threshold',
    };
  }

  async performCompact(
    session: Session,
    model: string,
    type: CompactionRecord['type'] = 'auto'
  ): Promise<CompactionRecord> {
    const record = createCompactionRecord(session.id, type);
    record.beforeMessageCount = session.messages.length;

    const startTime = Date.now();

    // 优先使用 autoCompactService，若未配置则使用已注册的 engines
    if (this.autoCompactService) {
      try {
        const result = await this.autoCompactService.performAutoCompact(
          session.id,
          session.messages as never[],
          model
        );
        record.durationMs = Date.now() - startTime;

        if (result.success) {
          record.success = true;
          record.afterMessageCount = session.messages.length;
          logger.info('Compaction completed', {
            sessionId: session.id,
            messagesBefore: record.beforeMessageCount,
            messagesAfter: record.afterMessageCount,
            durationMs: record.durationMs,
          });
        } else {
          record.success = false;
          record.error = result.error;
          logger.warn('Compaction failed', {
            sessionId: session.id,
            error: result.error,
          });
        }
      } catch (e) {
        record.success = false;
        record.error = String(e);
        await handleError(e, {
          module: 'sessions:compaction',
          action: '执行压缩失败',
        });
      }
    } else if (this.engines.length > 0) {
      let anySuccess = false;
      for (const engine of this.engines) {
        try {
          const result = await engine.performAutoCompact(
            session.id,
            session.messages,
            model
          );
          if (result.success) {
            anySuccess = true;
          }
        } catch (e) {
          logger.warn('Engine compaction error', {
            sessionId: session.id,
            engine: engine.constructor.name,
            error: String(e),
          });
        }
      }
      record.durationMs = Date.now() - startTime;
      record.success = anySuccess;
      record.afterMessageCount = session.messages.length;
    } else {
      record.durationMs = 0;
      record.success = false;
      record.error = 'No compaction engine available';
    }

    this.recordCompaction(record);
    return record;
  }

  private recordCompaction(record: CompactionRecord): void {
    const existing = this.records.get(record.sessionId) ?? [];
    existing.push(record);
    if (existing.length > this.config.maxRecordsPerSession) {
      existing.splice(0, existing.length - this.config.maxRecordsPerSession);
    }
    this.records.set(record.sessionId, existing);
  }

  getCompactionHistory(sessionId: string): CompactionRecord[] {
    return this.records.get(sessionId) ?? [];
  }

  getLastCompaction(sessionId: string): CompactionRecord | null {
    const history = this.records.get(sessionId);
    return history && history.length > 0 ? history[history.length - 1] : null;
  }

  clearSessionRecords(sessionId: string): void {
    this.records.delete(sessionId);
  }

  clearAll(): void {
    this.records.clear();
  }
}

export interface SessionCheckpointService {
  createCheckpoint(sessionId: string): Promise<SessionCheckpointHandle | null>;
}
