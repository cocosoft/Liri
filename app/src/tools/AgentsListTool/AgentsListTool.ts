/**
 * AgentsListTool — `agents_list`（Q-18 处置：`rewrite` 后接线，2026-10-23）
 *
 * **数据源**：`AgentTool.getActiveAgents()`（内存活跃台账 `AgentRunLedger.listActive()` 的
 * 只读投影）+ `getSpawnPauseState()`（spawn 暂停开关）。与 `GET /v1/agents/control` **同源**
 * —— 不新造第二份"活跃代理"事实。
 *
 * **修复前的病根**（P4a §2.3 `needs-rewrite`）：`execute()` 返回**硬编码空结果**
 * （`{agents: [], total: 0, …}`），属假数据（CS04）；`parentSessionId` 过滤在控制面投影里
 * **没有该字段**（O10a② 明确不外泄 `sessionId`）⇒ 该参数为假能力，已删除。
 *
 * **失败语义**：取不到 AgentTool 真身（未注册 / 未加载）⇒ `success:false` 并说明原因，
 * **不**伪装成"0 个代理"（空列表 ≠ 控制面不可用）。
 */
import { TOOL_NAME_CONSTANTS } from '../toolNameConstants';
import { BaseTool } from '../BaseTool';
import type { ToolResult, ToolUseContext, ToolParam } from '../types/index';
import type { AgentRunStatus } from '../AgentTool/AgentRunLedger';
import type { AgentType } from '../AgentTool/types';
import {
  getSpawnPauseState,
  type SpawnPauseState,
} from '../AgentTool/spawnPause';
import { resolveAgentToolInstance } from '../utils/resolveAgentToolInstance';

import { getLogger } from '@modules/monitoring';
// R03-002：必须走模块出口（子路径直连会判违规）
import {
  AGENTS_LIST_DEFAULT_LIMIT,
  AGENTS_LIST_MAX_LIMIT,
} from '@modules/constants';
const logger = getLogger('tools:AgentsListTool:AgentsListTool');

/** 活跃代理的只读投影（**不含** `sessionId` 等控制面专有字段） */
export interface AgentEntry {
  id: string;
  name: string;
  type: AgentType;
  startTime: number;
  status: AgentRunStatus;
}

export interface AgentsListFilter {
  type?: AgentType;
  status?: AgentRunStatus;
  limit?: number;
  offset?: number;
}

export interface AgentsListResult {
  /** spawn 暂停开关（与 `POST /v1/agents/pause` 同一状态源） */
  spawn: SpawnPauseState;
  /** 本页条目（过滤 + 分页后） */
  agents: AgentEntry[];
  /** 过滤前活跃总数 */
  total: number;
  /** 过滤后、分页前的条数 */
  filtered: number;
  /** 本页条数 */
  returned: number;
  /** 过滤后的状态分布（仅活跃态：`running` / `cancel_requested`） */
  running: number;
  cancelRequested: number;
}

/**
 * 纯函数：过滤 + 计数 + 分页（**唯一口径**，便于单测）。
 *
 * 注：`AgentRunLedger.listActive()` 只含**非终态**（`running` / `cancel_requested`），
 * 终态在归因表 / 磁盘台账 ⇒ 此处不伪造 `completed` / `failed` 计数。
 */
export function shapeAgentsList(
  raw: readonly AgentEntry[],
  filter: AgentsListFilter
): AgentsListResult {
  const matched = raw.filter(
    (a) =>
      (filter.type === undefined || a.type === filter.type) &&
      (filter.status === undefined || a.status === filter.status)
  );

  const offset = normalizeOffset(filter.offset);
  const limit = normalizeLimit(filter.limit);
  const page = matched.slice(offset, offset + limit);

  return {
    spawn: getSpawnPauseState(),
    agents: page,
    total: raw.length,
    filtered: matched.length,
    returned: page.length,
    running: matched.filter((a) => a.status === 'running').length,
    cancelRequested: matched.filter((a) => a.status === 'cancel_requested')
      .length,
  };
}

/** `limit` 归一：非数 / ≤0 ⇒ 默认；超上限 ⇒ 截断 */
function normalizeLimit(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return AGENTS_LIST_DEFAULT_LIMIT;
  return Math.min(Math.trunc(n), AGENTS_LIST_MAX_LIMIT);
}

/** `offset` 归一：非数 / ≤0 ⇒ 0 */
function normalizeOffset(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.trunc(n);
}

export class AgentsListTool extends BaseTool {
  name = TOOL_NAME_CONSTANTS.agents_list;

  description =
    '列出当前活跃的子代理（运行态投影）与 spawn 暂停状态。可按类型/状态过滤并分页；只读，不启动也不停止代理。';

  params: ToolParam[] = [
    {
      name: 'type',
      type: 'string',
      enum: ['general', 'explore', 'plan', 'verification', 'code-guide'],
      description: '按 Agent 类型过滤',
      required: false,
    },
    {
      name: 'status',
      type: 'string',
      enum: ['running', 'cancel_requested', 'completed', 'failed'],
      description: '按运行状态过滤（活跃表只含 running / cancel_requested）',
      required: false,
    },
    {
      name: 'limit',
      type: 'number',
      description: `本页最大条数（默认 ${AGENTS_LIST_DEFAULT_LIMIT}，上限 ${AGENTS_LIST_MAX_LIMIT}）`,
      required: false,
      default: AGENTS_LIST_DEFAULT_LIMIT,
    },
    {
      name: 'offset',
      type: 'number',
      description: '分页偏移量（默认 0）',
      required: false,
      default: 0,
    },
  ];

  /** U-03：模型可见出参结构 */
  override readonly outputJsonSchema = {
    type: 'object',
    properties: {
      spawn: {
        type: 'object',
        properties: {
          paused: { type: 'boolean' },
          reason: { type: 'string' },
          changedAt: { type: 'number' },
        },
      },
      agents: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            type: { type: 'string' },
            startTime: { type: 'number' },
            status: { type: 'string' },
          },
        },
      },
      total: { type: 'number' },
      filtered: { type: 'number' },
      returned: { type: 'number' },
      running: { type: 'number' },
      cancelRequested: { type: 'number' },
    },
  };

  async execute(input: unknown, _context: ToolUseContext): Promise<ToolResult> {
    const filter = (input ?? {}) as AgentsListFilter;

    const agentTool = resolveAgentToolInstance();
    if (!agentTool) {
      logger.warn('agents_list 不可用：AgentTool 真身未就绪');
      return {
        success: false,
        error:
          'agents_list 暂不可用：Agent 控制面（AgentTool）未注册或尚未加载。请稍后重试。',
      };
    }

    try {
      const result = shapeAgentsList(agentTool.getActiveAgents(), filter);
      logger.info('agents_list', {
        total: result.total,
        filtered: result.filtered,
        returned: result.returned,
        paused: result.spawn.paused,
      });
      return {
        success: true,
        data: result,
        output:
          `Active agents: ${result.total} (filtered ${result.filtered}, ` +
          `this page ${result.returned}; running ${result.running}, ` +
          `cancel_requested ${result.cancelRequested})` +
          (result.spawn.paused ? ' — spawn 已暂停' : ''),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('agents_list 执行异常', { error: message });
      return { success: false, error: `Failed to list agents: ${message}` };
    }
  }
}

export function createAgentsListTool(): AgentsListTool {
  return new AgentsListTool();
}
