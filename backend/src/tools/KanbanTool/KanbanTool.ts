/**
 * KanbanTool
 * Kanban 看板管理工具
 * 提供看板、列、卡片的 CRUD 操作和状态流转
 */
import { BaseTool } from '../BaseTool';
import type { ToolResult, ToolUseContext, ToolParam } from '../types/index';

/**
 * 卡片优先级
 */
export type CardPriority = 'low' | 'medium' | 'high' | 'urgent';

/**
 * 看板数据
 */
export interface KanbanBoard {
  id: string;
  name: string;
  description?: string;
  columns: KanbanColumn[];
  createdAt: number;
  updatedAt: number;
}

/**
 * 看板列
 */
export interface KanbanColumn {
  id: string;
  name: string;
  description?: string;
  cards: KanbanCard[];
}

/**
 * 看板卡片
 */
export interface KanbanCard {
  id: string;
  title: string;
  description?: string;
  priority: CardPriority;
  assignee?: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

/**
 * Kanban 工具输入参数
 */
export interface KanbanInput {
  action: 'create_board' | 'list_boards' | 'view_board' | 'delete_board'
    | 'add_column' | 'rename_column' | 'remove_column'
    | 'add_card' | 'move_card' | 'update_card' | 'delete_card';
  boardId?: string;
  boardName?: string;
  boardDescription?: string;
  columnId?: string;
  columnName?: string;
  columnDescription?: string;
  targetColumnId?: string;
  cardId?: string;
  cardTitle?: string;
  cardDescription?: string;
  cardPriority?: CardPriority;
  assignee?: string;
  tags?: string[];
}

// 内存存储
const boards = new Map<string, KanbanBoard>();

let idCounter = 0;
function generateId(prefix: string): string {
  idCounter++;
  return `${prefix}_${Date.now()}_${idCounter}`;
}

export class KanbanTool extends BaseTool {
  name = 'kanban';

  description = 'Manage Kanban boards with columns and cards. Create, view, and organize tasks using a visual board system with drag-and-drop card movement between columns.';

  params: ToolParam[] = [
    {
      name: 'action',
      type: 'string',
      enum: [
        'create_board', 'list_boards', 'view_board', 'delete_board',
        'add_column', 'rename_column', 'remove_column',
        'add_card', 'move_card', 'update_card', 'delete_card',
      ],
      description: 'Action to perform',
      required: true,
    },
    {
      name: 'boardId', type: 'string',
      description: 'Board ID (required for view/delete/add_column/rename_column/remove_column/add_card)',
      required: false,
    },
    {
      name: 'boardName', type: 'string',
      description: 'Board name (required for create_board)',
      required: false,
    },
    {
      name: 'boardDescription', type: 'string',
      description: 'Board description',
      required: false,
    },
    {
      name: 'columnId', type: 'string',
      description: 'Column ID (required for rename_column/remove_column)',
      required: false,
    },
    {
      name: 'columnName', type: 'string',
      description: 'Column name (required for add_column/rename_column)',
      required: false,
    },
    {
      name: 'columnDescription', type: 'string',
      description: 'Column description',
      required: false,
    },
    {
      name: 'targetColumnId', type: 'string',
      description: 'Target column ID (required for move_card)',
      required: false,
    },
    {
      name: 'cardId', type: 'string',
      description: 'Card ID (required for move_card/update_card/delete_card)',
      required: false,
    },
    {
      name: 'cardTitle', type: 'string',
      description: 'Card title (required for add_card)',
      required: false,
    },
    {
      name: 'cardDescription', type: 'string',
      description: 'Card description',
      required: false,
    },
    {
      name: 'cardPriority', type: 'string', enum: ['low', 'medium', 'high', 'urgent'],
      description: 'Card priority (default: medium)',
      required: false,
    },
    {
      name: 'assignee', type: 'string',
      description: 'Card assignee',
      required: false,
    },
    {
      name: 'tags', type: 'array',
      description: 'Card tags',
      required: false,
    },
  ];

  override aliases = ['board', 'kanban_board'];
  override searchHint = 'Manage Kanban boards with columns and cards';

  /** 重置所有看板数据（仅用于测试） */
  static resetAll(): void {
    boards.clear();
  }

  async execute(
    input: Record<string, unknown>,
    _context: ToolUseContext
  ): Promise<ToolResult> {
    try {
      const params = input as unknown as KanbanInput;

      if (!params.action || typeof params.action !== 'string') {
        return { success: false, error: 'action is required and must be a string' };
      }

      const validActions = [
        'create_board', 'list_boards', 'view_board', 'delete_board',
        'add_column', 'rename_column', 'remove_column',
        'add_card', 'move_card', 'update_card', 'delete_card',
      ];
      if (!validActions.includes(params.action)) {
        return {
          success: false,
          error: `Invalid action "${params.action}". Must be one of: ${validActions.join(', ')}`,
        };
      }

      switch (params.action) {
        case 'create_board':
          return this.createBoard(params);
        case 'list_boards':
          return this.listBoards();
        case 'view_board':
          return this.viewBoard(params);
        case 'delete_board':
          return this.deleteBoard(params);
        case 'add_column':
          return this.addColumn(params);
        case 'rename_column':
          return this.renameColumn(params);
        case 'remove_column':
          return this.removeColumn(params);
        case 'add_card':
          return this.addCard(params);
        case 'move_card':
          return this.moveCard(params);
        case 'update_card':
          return this.updateCard(params);
        case 'delete_card':
          return this.deleteCard(params);
        default:
          return { success: false, error: `Unhandled action: ${params.action}` };
      }
    } catch (error) {
      return {
        success: false,
        error: `Kanban tool failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private createBoard(params: KanbanInput): ToolResult {
    if (!params.boardName) {
      return { success: false, error: 'boardName is required for create_board action' };
    }

    const id = generateId('board');
    const board: KanbanBoard = {
      id,
      name: params.boardName,
      description: params.boardDescription,
      columns: [
        { id: generateId('col'), name: '待办', cards: [] },
        { id: generateId('col'), name: '进行中', cards: [] },
        { id: generateId('col'), name: '完成', cards: [] },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    boards.set(id, board);

    return {
      success: true,
      data: { action: 'create_board', boardId: id, board },
      output: `看板 "${params.boardName}" 已创建（ID: ${id}），包含默认列：待办、进行中、完成。`,
    };
  }

  private listBoards(): ToolResult {
    const allBoards = Array.from(boards.values()).map((b) => ({
      id: b.id,
      name: b.name,
      columnCount: b.columns.length,
      cardCount: b.columns.reduce((sum, col) => sum + col.cards.length, 0),
      createdAt: b.createdAt,
    }));

    return {
      success: true,
      data: { action: 'list_boards', boards: allBoards },
      output: allBoards.length === 0
        ? '暂无看板。使用 create_board 创建新看板。'
        : `共 ${allBoards.length} 个看板:\n${allBoards.map((b) => `  - ${b.name} (${b.id}): ${b.cardCount} 张卡片`).join('\n')}`,
    };
  }

  private viewBoard(params: KanbanInput): ToolResult {
    if (!params.boardId) {
      return { success: false, error: 'boardId is required for view_board action' };
    }

    const board = boards.get(params.boardId);
    if (!board) {
      return { success: false, error: `看板 "${params.boardId}" 未找到` };
    }

    const summary = board.columns.map((col) =>
      `${col.name}: ${col.cards.length} 张卡片`
    ).join('\n');

    return {
      success: true,
      data: { action: 'view_board', board },
      output: `看板: ${board.name}${board.description ? ` (${board.description})` : ''}\n${summary}`,
    };
  }

  private deleteBoard(params: KanbanInput): ToolResult {
    if (!params.boardId) {
      return { success: false, error: 'boardId is required for delete_board action' };
    }

    const board = boards.get(params.boardId);
    if (!board) {
      return { success: false, error: `看板 "${params.boardId}" 未找到` };
    }

    boards.delete(params.boardId);

    return {
      success: true,
      data: { action: 'delete_board', boardId: params.boardId },
      output: `看板 "${board.name}" 已删除。`,
    };
  }

  private addColumn(params: KanbanInput): ToolResult {
    if (!params.boardId || !params.columnName) {
      return { success: false, error: 'boardId and columnName are required for add_column action' };
    }

    const board = boards.get(params.boardId);
    if (!board) {
      return { success: false, error: `看板 "${params.boardId}" 未找到` };
    }

    const colId = generateId('col');
    board.columns.push({
      id: colId,
      name: params.columnName,
      description: params.columnDescription,
      cards: [],
    });
    board.updatedAt = Date.now();

    return {
      success: true,
      data: { action: 'add_column', columnId: colId, boardId: params.boardId },
      output: `列 "${params.columnName}" 已添加到看板 "${board.name}"。`,
    };
  }

  private renameColumn(params: KanbanInput): ToolResult {
    if (!params.boardId || !params.columnId || !params.columnName) {
      return { success: false, error: 'boardId, columnId, and columnName are required for rename_column action' };
    }

    const board = boards.get(params.boardId);
    if (!board) {
      return { success: false, error: `看板 "${params.boardId}" 未找到` };
    }

    const col = board.columns.find((c) => c.id === params.columnId);
    if (!col) {
      return { success: false, error: `列 "${params.columnId}" 未找到` };
    }

    const oldName = col.name;
    col.name = params.columnName;
    board.updatedAt = Date.now();

    return {
      success: true,
      data: { action: 'rename_column', boardId: params.boardId, columnId: params.columnId },
      output: `列 "${oldName}" 已重命名为 "${params.columnName}"。`,
    };
  }

  private removeColumn(params: KanbanInput): ToolResult {
    if (!params.boardId || !params.columnId) {
      return { success: false, error: 'boardId and columnId are required for remove_column action' };
    }

    const board = boards.get(params.boardId);
    if (!board) {
      return { success: false, error: `看板 "${params.boardId}" 未找到` };
    }

    const colIndex = board.columns.findIndex((c) => c.id === params.columnId);
    if (colIndex === -1) {
      return { success: false, error: `列 "${params.columnId}" 未找到` };
    }

    const col = board.columns[colIndex];
    board.columns.splice(colIndex, 1);
    board.updatedAt = Date.now();

    return {
      success: true,
      data: { action: 'remove_column', boardId: params.boardId, columnId: params.columnId },
      output: `列 "${col.name}" 已移除（包含 ${col.cards.length} 张卡片）。`,
    };
  }

  private addCard(params: KanbanInput): ToolResult {
    if (!params.boardId || !params.cardTitle) {
      return { success: false, error: 'boardId and cardTitle are required for add_card action' };
    }

    const board = boards.get(params.boardId);
    if (!board) {
      return { success: false, error: `看板 "${params.boardId}" 未找到` };
    }

    let targetCol = board.columns[0];
    if (params.columnId) {
      const found = board.columns.find((c) => c.id === params.columnId);
      if (!found) {
        return { success: false, error: `列 "${params.columnId}" 未找到` };
      }
      targetCol = found;
    }

    const card: KanbanCard = {
      id: generateId('card'),
      title: params.cardTitle,
      description: params.cardDescription,
      priority: params.cardPriority || 'medium',
      assignee: params.assignee,
      tags: params.tags || [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    targetCol.cards.push(card);
    board.updatedAt = Date.now();

    return {
      success: true,
      data: { action: 'add_card', cardId: card.id, boardId: params.boardId, columnId: targetCol.id },
      output: `卡片 "${params.cardTitle}" 已添加到看板 "${board.name}" 的 "${targetCol.name}" 列。`,
    };
  }

  private moveCard(params: KanbanInput): ToolResult {
    if (!params.boardId || !params.cardId || !params.targetColumnId) {
      return { success: false, error: 'boardId, cardId, and targetColumnId are required for move_card action' };
    }

    const board = boards.get(params.boardId);
    if (!board) {
      return { success: false, error: `看板 "${params.boardId}" 未找到` };
    }

    const targetCol = board.columns.find((c) => c.id === params.targetColumnId);
    if (!targetCol) {
      return { success: false, error: `目标列 "${params.targetColumnId}" 未找到` };
    }

    let foundCard: KanbanCard | undefined;
    let sourceCol: KanbanColumn | undefined;

    for (const col of board.columns) {
      const idx = col.cards.findIndex((c) => c.id === params.cardId);
      if (idx !== -1) {
        foundCard = col.cards[idx];
        sourceCol = col;
        col.cards.splice(idx, 1);
        break;
      }
    }

    if (!foundCard || !sourceCol) {
      return { success: false, error: `卡片 "${params.cardId}" 未找到` };
    }

    foundCard.updatedAt = Date.now();
    targetCol.cards.push(foundCard);
    board.updatedAt = Date.now();

    return {
      success: true,
      data: { action: 'move_card', cardId: params.cardId, fromColumn: sourceCol.id, toColumn: targetCol.id },
      output: `卡片 "${foundCard.title}" 已从 "${sourceCol.name}" 移动到 "${targetCol.name}"。`,
    };
  }

  private updateCard(params: KanbanInput): ToolResult {
    if (!params.boardId || !params.cardId) {
      return { success: false, error: 'boardId and cardId are required for update_card action' };
    }

    const board = boards.get(params.boardId);
    if (!board) {
      return { success: false, error: `看板 "${params.boardId}" 未找到` };
    }

    for (const col of board.columns) {
      const card = col.cards.find((c) => c.id === params.cardId);
      if (card) {
        if (params.cardTitle !== undefined) card.title = params.cardTitle;
        if (params.cardDescription !== undefined) card.description = params.cardDescription;
        if (params.cardPriority !== undefined) card.priority = params.cardPriority;
        if (params.assignee !== undefined) card.assignee = params.assignee;
        if (params.tags !== undefined) card.tags = params.tags;
        card.updatedAt = Date.now();
        board.updatedAt = Date.now();

        return {
          success: true,
          data: { action: 'update_card', cardId: params.cardId },
          output: `卡片 "${card.title}" 已更新。`,
        };
      }
    }

    return { success: false, error: `卡片 "${params.cardId}" 未找到` };
  }

  private deleteCard(params: KanbanInput): ToolResult {
    if (!params.boardId || !params.cardId) {
      return { success: false, error: 'boardId and cardId are required for delete_card action' };
    }

    const board = boards.get(params.boardId);
    if (!board) {
      return { success: false, error: `看板 "${params.boardId}" 未找到` };
    }

    for (const col of board.columns) {
      const idx = col.cards.findIndex((c) => c.id === params.cardId);
      if (idx !== -1) {
        const card = col.cards[idx];
        col.cards.splice(idx, 1);
        board.updatedAt = Date.now();

        return {
          success: true,
          data: { action: 'delete_card', cardId: params.cardId },
          output: `卡片 "${card.title}" 已删除。`,
        };
      }
    }

    return { success: false, error: `卡片 "${params.cardId}" 未找到` };
  }
}

export function createKanbanTool(): KanbanTool {
  return new KanbanTool();
}
