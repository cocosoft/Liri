/**
 * KanbanTool — `kanban`（Q-18 处置：`rewrite` 后接线，2026-10-23）
 *
 * **数据源**：`getCoreAPI().getTaskOpsPort()` —— 与 `GET/POST/PATCH/DELETE /v1/kanban`
 * 以及客户端 `KanbanBoard` **同一张 `kanban_cards` 表**（`SqliteTaskStore`）。
 *
 * **修复前的病根**（P4a §2.3 `needs-rewrite`）：整个工具用**进程内 `Map`** 存 boards/columns/cards
 * ⇒ 与 UI/HTTP 的 SQLite 真源**双轨**：模型建的卡在界面上看不见、界面上的卡模型也读不到，
 * 且进程重启即丢。原 `create_board` / `add_column` 等看板/列 CRUD 在真实数据模型里
 * **没有对应存储**（schema 只有 `kanban_cards.column_id`）⇒ 一并删除，动作面收敛为**卡片 CRUD**。
 *
 * **列**：由客户端 `KanbanBoard` 定义（`backlog` / `todo` / `in_progress` / `done`）；
 * 未提供 `columnId` ⇒ `todo`（与 HTTP 建卡默认值一致）。
 */
import { randomUUID } from 'node:crypto';
import { TOOL_NAME_CONSTANTS } from '../toolNameConstants';
import { BaseTool } from '../BaseTool';
import type { ToolResult, ToolUseContext, ToolParam } from '../types/index';
import { getCoreAPI } from '@modules/runtime/api/CoreAPIImpl';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools:KanbanTool:KanbanTool');

/** 客户端看板列（与 `client/src/components/Agent/KanbanBoard.tsx` 的 `COLUMNS` 一致） */
export const KANBAN_COLUMNS = [
  'backlog',
  'todo',
  'in_progress',
  'done',
] as const;
export type KanbanColumnId = (typeof KANBAN_COLUMNS)[number];

/** 建卡默认列（与 `kanban-handlers.ts` 的 `columnId || 'todo'` 一致） */
export const DEFAULT_KANBAN_COLUMN: KanbanColumnId = 'todo';

/** 卡片优先级（客户端 `PRI` 映射只认这三档） */
export const CARD_PRIORITIES = ['low', 'medium', 'high'] as const;
export type CardPriority = (typeof CARD_PRIORITIES)[number];

/** `kanban_cards` 一行的投影（`SqliteTaskStore.loadKanbanCards()` 的返回形状） */
export interface KanbanCard {
  id: string;
  title: string;
  description: string;
  columnId: string;
  assignee?: string;
  priority: string;
  tags: string[];
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface KanbanInput {
  action: 'list' | 'create' | 'update' | 'move' | 'delete';
  cardId?: string;
  title?: string;
  description?: string;
  columnId?: string;
  priority?: string;
  assignee?: string;
  tags?: string[];
}

/** 任务数据端口（只取本工具用到的四个方法，避免依赖整张端口类型） */
export interface KanbanPort {
  listKanbanCards(): Promise<unknown>;
  saveKanbanCard(card: {
    id: string;
    title: string;
    description?: string;
    columnId?: string;
    assignee?: string;
    priority?: string;
    tags?: string[];
    sortOrder?: number;
  }): Promise<void>;
  deleteKanbanCard(cardId: string): Promise<void>;
  moveKanbanCard(
    cardId: string,
    columnId: string,
    sortOrder: number
  ): Promise<void>;
}

/** 列名校验（fail-closed：非法列 ⇒ 明确报错，不做静默修正） */
export function normalizeColumn(
  value: unknown
): { ok: true; columnId: KanbanColumnId } | { ok: false; error: string } {
  if (value === undefined || value === null || value === '') {
    return { ok: true, columnId: DEFAULT_KANBAN_COLUMN };
  }
  const raw = String(value);
  if ((KANBAN_COLUMNS as readonly string[]).includes(raw)) {
    return { ok: true, columnId: raw as KanbanColumnId };
  }
  return {
    ok: false,
    error: `非法列 "${raw}"。可用列：${KANBAN_COLUMNS.join(', ')}`,
  };
}

/** 优先级校验（缺省 `medium`） */
export function normalizePriority(
  value: unknown
): { ok: true; priority: CardPriority } | { ok: false; error: string } {
  if (value === undefined || value === null || value === '') {
    return { ok: true, priority: 'medium' };
  }
  const raw = String(value);
  if ((CARD_PRIORITIES as readonly string[]).includes(raw)) {
    return { ok: true, priority: raw as CardPriority };
  }
  return {
    ok: false,
    error: `非法优先级 "${raw}"。可用值：${CARD_PRIORITIES.join(', ')}`,
  };
}

export class KanbanTool extends BaseTool {
  name = TOOL_NAME_CONSTANTS.kanban;

  /**
   * 测试注入端口（缺省走 `getCoreAPI().getTaskOpsPort()`）。
   * 生产恒为 `undefined` ⇒ 行为与不注入完全一致。
   */
  constructor(private readonly portOverride?: KanbanPort) {
    super();
  }

  description =
    'Manage Kanban cards (persisted in the local SQLite kanban_cards table, shared with the Kanban UI). Actions: list / create / update / move / delete. Columns: backlog, todo, in_progress, done.';

  params: ToolParam[] = [
    {
      name: 'action',
      type: 'string',
      enum: ['list', 'create', 'update', 'move', 'delete'],
      description:
        'Action to perform: list (optional columnId filter), create (title required), update (cardId + fields), move (cardId + columnId), delete (cardId)',
      required: true,
    },
    {
      name: 'cardId',
      type: 'string',
      description: 'Card ID (required for update / move / delete)',
      required: false,
    },
    {
      name: 'title',
      type: 'string',
      description: 'Card title (required for create)',
      required: false,
    },
    {
      name: 'description',
      type: 'string',
      description: 'Card description',
      required: false,
    },
    {
      name: 'columnId',
      type: 'string',
      enum: [...KANBAN_COLUMNS],
      description:
        'Column: backlog / todo / in_progress / done (default todo; required for move)',
      required: false,
    },
    {
      name: 'priority',
      type: 'string',
      enum: [...CARD_PRIORITIES],
      description: 'Card priority: low / medium / high (default medium)',
      required: false,
    },
    {
      name: 'assignee',
      type: 'string',
      description: 'Card assignee',
      required: false,
    },
    {
      name: 'tags',
      type: 'array',
      description: 'Card tags',
      required: false,
    },
  ];

  /** U-03：模型可见出参结构 */
  override readonly outputJsonSchema = {
    type: 'object',
    properties: {
      action: { type: 'string' },
      cards: { type: 'array', items: { type: 'object' } },
      total: { type: 'number' },
      card: { type: 'object' },
      cardId: { type: 'string' },
      columnId: { type: 'string' },
    },
  };

  async execute(
    input: Record<string, unknown>,
    _context: ToolUseContext
  ): Promise<ToolResult> {
    const params = input as unknown as KanbanInput;
    if (!params.action || typeof params.action !== 'string') {
      return {
        success: false,
        error: 'action is required and must be a string',
      };
    }

    try {
      const port =
        this.portOverride ??
        ((await getCoreAPI().getTaskOpsPort()) as KanbanPort);
      switch (params.action) {
        case 'list':
          return await this.list(port, params);
        case 'create':
          return await this.create(port, params);
        case 'update':
          return await this.update(port, params);
        case 'move':
          return await this.move(port, params);
        case 'delete':
          return await this.remove(port, params);
        default:
          return {
            success: false,
            error: `Invalid action "${String(params.action)}". Must be one of: list, create, update, move, delete`,
          };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('kanban 执行失败', {
        action: params.action,
        error: message,
      });
      return { success: false, error: `Kanban tool failed: ${message}` };
    }
  }

  /** 读取全部卡片（与 UI/HTTP 同一张表） */
  private async loadCards(port: KanbanPort): Promise<KanbanCard[]> {
    const rows = (await port.listKanbanCards()) as KanbanCard[];
    return Array.isArray(rows) ? rows : [];
  }

  private async list(
    port: KanbanPort,
    params: KanbanInput
  ): Promise<ToolResult> {
    const cards = await this.loadCards(port);
    const filtered =
      params.columnId === undefined
        ? cards
        : cards.filter((c) => c.columnId === String(params.columnId));

    return {
      success: true,
      data: { action: 'list', cards: filtered, total: filtered.length },
      output:
        filtered.length === 0
          ? 'No kanban cards found.'
          : `Kanban cards: ${filtered.length}\n${filtered
              .map(
                (c) => `  - [${c.columnId}] ${c.title} (${c.id}, ${c.priority})`
              )
              .join('\n')}`,
    };
  }

  private async create(
    port: KanbanPort,
    params: KanbanInput
  ): Promise<ToolResult> {
    const title = typeof params.title === 'string' ? params.title.trim() : '';
    if (!title) {
      return { success: false, error: 'title is required for create' };
    }

    const column = normalizeColumn(params.columnId);
    if (!column.ok) return { success: false, error: column.error };
    const priority = normalizePriority(params.priority);
    if (!priority.ok) return { success: false, error: priority.error };

    const card: KanbanCard = {
      id: `kb_${randomUUID()}`,
      title,
      description: params.description ?? '',
      columnId: column.columnId,
      ...(params.assignee ? { assignee: params.assignee } : {}),
      priority: priority.priority,
      tags: Array.isArray(params.tags) ? params.tags.map(String) : [],
      sortOrder: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await port.saveKanbanCard(card);
    logger.info('kanban:create', { cardId: card.id, columnId: card.columnId });
    return {
      success: true,
      data: {
        action: 'create',
        cardId: card.id,
        columnId: card.columnId,
        card,
      },
      output: `Card "${card.title}" created in "${card.columnId}" (ID: ${card.id}).`,
    };
  }

  private async update(
    port: KanbanPort,
    params: KanbanInput
  ): Promise<ToolResult> {
    if (!params.cardId) {
      return { success: false, error: 'cardId is required for update' };
    }
    const cards = await this.loadCards(port);
    const existing = cards.find((c) => c.id === params.cardId);
    if (!existing) {
      return { success: false, error: `Card "${params.cardId}" not found` };
    }

    if (params.columnId !== undefined) {
      const column = normalizeColumn(params.columnId);
      if (!column.ok) return { success: false, error: column.error };
    }
    if (params.priority !== undefined) {
      const priority = normalizePriority(params.priority);
      if (!priority.ok) return { success: false, error: priority.error };
    }

    // `saveKanbanCard` 是**整行 upsert** ⇒ 必须先合并旧值，避免未提供的字段被清空
    const merged: KanbanCard = {
      ...existing,
      title: params.title?.trim() || existing.title,
      description:
        params.description === undefined
          ? existing.description
          : params.description,
      columnId:
        params.columnId === undefined
          ? existing.columnId
          : String(params.columnId),
      assignee:
        params.assignee === undefined ? existing.assignee : params.assignee,
      priority:
        params.priority === undefined ? existing.priority : params.priority,
      tags: Array.isArray(params.tags)
        ? params.tags.map(String)
        : existing.tags,
      updatedAt: Date.now(),
    };

    await port.saveKanbanCard(merged);
    return {
      success: true,
      data: { action: 'update', cardId: merged.id, card: merged },
      output: `Card "${merged.title}" updated.`,
    };
  }

  private async move(
    port: KanbanPort,
    params: KanbanInput
  ): Promise<ToolResult> {
    if (!params.cardId || params.columnId === undefined) {
      return {
        success: false,
        error: 'cardId and columnId are required for move',
      };
    }
    const column = normalizeColumn(params.columnId);
    if (!column.ok) return { success: false, error: column.error };

    const cards = await this.loadCards(port);
    const existing = cards.find((c) => c.id === params.cardId);
    if (!existing) {
      return { success: false, error: `Card "${params.cardId}" not found` };
    }

    await port.moveKanbanCard(params.cardId, column.columnId, Date.now());
    return {
      success: true,
      data: {
        action: 'move',
        cardId: params.cardId,
        fromColumn: existing.columnId,
        columnId: column.columnId,
      },
      output: `Card "${existing.title}" moved from "${existing.columnId}" to "${column.columnId}".`,
    };
  }

  private async remove(
    port: KanbanPort,
    params: KanbanInput
  ): Promise<ToolResult> {
    if (!params.cardId) {
      return { success: false, error: 'cardId is required for delete' };
    }
    const cards = await this.loadCards(port);
    const existing = cards.find((c) => c.id === params.cardId);
    if (!existing) {
      return { success: false, error: `Card "${params.cardId}" not found` };
    }

    await port.deleteKanbanCard(params.cardId);
    return {
      success: true,
      data: { action: 'delete', cardId: params.cardId },
      output: `Card "${existing.title}" deleted.`,
    };
  }
}

export function createKanbanTool(): KanbanTool {
  return new KanbanTool();
}
