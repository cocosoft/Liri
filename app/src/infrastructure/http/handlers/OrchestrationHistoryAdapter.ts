/**
 * 编排历史适配器
 *
 * 订阅 globalEventBus 上的编排事件，以 append-only JSONL 格式
 * 持久化到 .liri/workitems/<itemId>_orchestration_history.jsonl。
 * 供前端历史回放使用。
 *
 * 每个事件记录格式：
 * { "eventId": "uuid", "eventType": "orch:*", "payload": {}, "timestamp": 1234567890 }
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { globalEventBus } from '../../../core/events/EventBus.js';
import { OrchestrationEventType } from '../../../agent/events/OrchestrationEvents.js';
import { AgentEventType } from '../../../agent/events/types.js';
import { getLogger } from '@modules/monitoring';
const logger = getLogger('http:orchHistory');

/** 编排历史事件记录 */
export interface OrchestrationHistoryRecord {
  /** 全局唯一事件 ID */
  eventId: string;
  /** 事件类型 */
  eventType: string;
  /** 事件载荷 */
  payload: unknown;
  /** 事件时间戳（毫秒） */
  timestamp: number;
}

/** 历史查询结果 */
export interface OrchestrationHistoryQueryResult {
  /** 事件列表 */
  events: OrchestrationHistoryRecord[];
  /** 是否还有更多 */
  hasMore: boolean;
  /** 最新事件时间戳 */
  latestTimestamp: number;
}

/** 需要记录的编排事件类型列表 */
const RECORDED_EVENT_TYPES: ReadonlySet<string> = new Set([
  OrchestrationEventType.COUNCIL_START,
  OrchestrationEventType.COUNCIL_ROUND_START,
  OrchestrationEventType.COUNCIL_AGENT_SPEAKING,
  OrchestrationEventType.COUNCIL_AGENT_DELTA,
  OrchestrationEventType.COUNCIL_ROUND,
  OrchestrationEventType.COUNCIL_END,
  OrchestrationEventType.COUNCIL_DETAIL,

  OrchestrationEventType.ORCH_START,
  OrchestrationEventType.ORCH_TASK_START,
  OrchestrationEventType.ORCH_TASK_PROGRESS,
  OrchestrationEventType.ORCH_TASK_END,
  OrchestrationEventType.ORCH_STEP_START,
  OrchestrationEventType.ORCH_STEP_DELTA,
  OrchestrationEventType.ORCH_STEP_COMPLETED,
  OrchestrationEventType.ORCH_END,

  OrchestrationEventType.PLAN_START,
  OrchestrationEventType.PLAN_STEP_START,
  OrchestrationEventType.PLAN_STEP_COMPLETED,
  OrchestrationEventType.PLAN_PROGRESS,
  OrchestrationEventType.PLAN_COMPLETED,

  OrchestrationEventType.CHAIN_START,
  OrchestrationEventType.CHAIN_STEP,
  OrchestrationEventType.CHAIN_END,

  OrchestrationEventType.SWARM_DISPATCH,
  OrchestrationEventType.SWARM_AGENT_STATUS,
  OrchestrationEventType.SWARM_COMPLETE,

  AgentEventType.THINKING_START,
  AgentEventType.THINKING_DELTA,
  AgentEventType.THINKING_END,
  AgentEventType.TOOL_CALL_START,
  AgentEventType.TOOL_CALL_DELTA,
  AgentEventType.TOOL_CALL_END,
]);

/** JSONL 文件名后缀 */
const HISTORY_FILE_SUFFIX = '_orchestration_history.jsonl';

/**
 * 编排历史适配器
 *
 * 订阅 globalEventBus 并持久化编排事件到 JSONL 文件，
 * 同时提供历史查询能力。
 */
export class OrchestrationHistoryAdapter {
  /** 每个 item 对应的文件路径 */
  private filePaths = new Map<string, string>();

  /** 订阅列表 */
  private subscriptions: Array<{ unsubscribe: () => void }> = [];

  /** 是否已启动 */
  private started = false;

  /**
   * 启动历史记录
   *
   * 订阅所有编排事件类型，写入历史文件。
   */
  start(liriDir: string): void {
    if (this.started) return;
    this.started = true;

    const itemDir = join(liriDir, 'workitems');
    if (!existsSync(itemDir)) {
      mkdirSync(itemDir, { recursive: true });
    }

    // 订阅所有需要记录的事件类型
    for (const eventType of RECORDED_EVENT_TYPES) {
      const sub = globalEventBus.subscribe(eventType, (payload: unknown) => {
        // 从 payload 中提取 itemId（各事件可能在不同字段）
        const itemId = this.extractItemId(payload, eventType);
        if (!itemId) return; // 无法确定 itemId 的事件跳过

        this.appendRecord(itemDir, itemId, {
          eventId: randomUUID(),
          eventType,
          payload,
          timestamp: Date.now(),
        });
      });
      this.subscriptions.push(sub);
    }

    logger.info('编排历史适配器已启动');
  }

  /**
   * 停止历史记录，清理所有订阅
   */
  stop(): void {
    for (const sub of this.subscriptions) {
      sub.unsubscribe();
    }
    this.subscriptions = [];
    this.started = false;
    this.filePaths.clear();
    logger.info('编排历史适配器已停止');
  }

  /**
   * 查询编排历史
   *
   * @param itemDir 工作项存储目录
   * @param itemId 工作项 ID
   * @param since 可选，只返回该时间戳之后的事件
   * @param limit 可选，最大返回条数（默认 100）
   */
  query(
    itemDir: string,
    itemId: string,
    since?: number,
    limit: number = 100
  ): OrchestrationHistoryQueryResult {
    const filePath = join(itemDir, `${itemId}${HISTORY_FILE_SUFFIX}`);

    if (!existsSync(filePath)) {
      return { events: [], hasMore: false, latestTimestamp: 0 };
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.trim().split('\n');

      // 从后往前解析，取最新的 limit 条
      const records: OrchestrationHistoryRecord[] = [];

      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (!line) continue;

        try {
          const record = JSON.parse(line) as OrchestrationHistoryRecord;
          if (since !== undefined && record.timestamp <= since) continue;
          records.unshift(record);
          if (records.length >= limit) break;
        } catch (recErr) {
          // KB-ORCH-BADLINE（2026-08-29）：历史记录损坏行静默跳过 → 数据损坏不可感知
          logger.warn('编排历史损坏行跳过', {
            error: recErr instanceof Error ? recErr.message : String(recErr),
          });
        }
      }

      const latestTimestamp =
        records.length > 0 ? records[records.length - 1].timestamp : 0;

      return {
        events: records,
        hasMore: records.length >= limit,
        latestTimestamp,
      };
    } catch (_err) {
      return { events: [], hasMore: false, latestTimestamp: 0 };
    }
  }

  /**
   * 获取历史文件路径
   */
  getHistoryFilePath(itemDir: string, itemId: string): string {
    return join(itemDir, `${itemId}${HISTORY_FILE_SUFFIX}`);
  }

  // ========== 私有方法 ==========

  /**
   * 追加一条记录到历史文件
   */
  private appendRecord(
    itemDir: string,
    itemId: string,
    record: OrchestrationHistoryRecord
  ): void {
    const filePath = this.getHistoryFilePath(itemDir, itemId);

    try {
      appendFileSync(filePath, JSON.stringify(record) + '\n', 'utf-8');
    } catch (err) {
      logger.warn('写入编排历史失败', {
        itemId,
        eventType: record.eventType,
        error: String(err),
      });
    }
  }

  /**
   * 从事件 payload 中提取 itemId
   *
   * 不同事件类型的 payload 中 itemId/workspaceItemId 字段名不同，
   * 统一尝试多个可能的字段名。
   */
  private extractItemId(payload: unknown, _eventType: string): string | null {
    if (!payload || typeof payload !== 'object') return null;

    const obj = payload as Record<string, unknown>;

    // 尝试常见字段名
    const possibleKeys = [
      'workItemId',
      'itemId',
      'workspaceItemId',
      'sessionId',
    ];

    for (const key of possibleKeys) {
      const val = obj[key];
      if (typeof val === 'string' && val.length > 0) {
        return val;
      }
    }

    return null;
  }
}

// ============================================================
// 全局单例
// ============================================================

let _defaultAdapter: OrchestrationHistoryAdapter | null = null;

/**
 * 获取编排历史适配器全局单例
 */
export function getOrchestrationHistoryAdapter(): OrchestrationHistoryAdapter {
  if (!_defaultAdapter) {
    _defaultAdapter = new OrchestrationHistoryAdapter();
  }
  return _defaultAdapter;
}
