/**
 * Notebook工具适配器
 */

import type {
  Tool,
  ToolInfo,
  ToolParam,
  ValidationResult,
  InterruptBehavior,
} from '../types/Tool.js';
import type { ToolUseContext } from '../types/ToolUseContext.js';
import type { ToolResult } from '../types/ToolResult.js';
import { ToolTag } from '../types/Tool.js';
import { NotebookToolImpl } from '../notebook/NotebookToolImpl.js';
import type { Notebook, CodeCell } from '../notebook/types/index.js';
import { notebookManager } from '../notebook/NotebookManager.js';

/**
 * Notebook工具适配器
 */
export class NotebookToolAdapter implements Tool {
  /**
   * 工具名称
   */
  name = 'notebook';

  /**
   * 工具描述
   */
  description = 'Notebook工具，支持创建、编辑和执行混合代码和文档';

  /**
   * 工具参数
   */
  params: ToolParam[] = [
    {
      name: 'action',
      type: 'string',
      description:
        '操作类型：create, open, save, addCodeCell, addMarkdownCell, executeCell, export, list, delete',
      required: true,
      enum: [
        'create',
        'open',
        'save',
        'addCodeCell',
        'addMarkdownCell',
        'executeCell',
        'export',
        'list',
        'delete',
      ],
      example: 'create',
    },
    {
      name: 'name',
      type: 'string',
      description: 'Notebook名称（create 操作必填）',
      required: false,
      example: 'My Notebook',
    },
    {
      name: 'notebook_path',
      type: 'string',
      description:
        'Notebook 文件路径（open/save 操作使用，兼容 NotebookEditTool 接口）',
      required: false,
      example: './notebooks/my-notebook.ipynb',
    },
    {
      name: 'path',
      type: 'string',
      description: 'Notebook路径（与 notebook_path 同义）',
      required: false,
      example: './notebooks/my-notebook.ipynb',
    },
    {
      name: 'notebookId',
      type: 'string',
      description: 'Notebook ID',
      required: false,
      example: 'notebook-123',
    },
    {
      name: 'cellId',
      type: 'string',
      description: '单元格ID',
      required: false,
      example: 'cell-123',
    },
    {
      name: 'cell_index',
      type: 'number',
      description: '单元格索引（兼容 NotebookEditTool 接口）',
      required: false,
      example: 0,
    },
    {
      name: 'code',
      type: 'string',
      description: '代码内容',
      required: false,
      example: 'print("Hello, World!")',
    },
    {
      name: 'language',
      type: 'string',
      description: '编程语言',
      required: false,
      example: 'python',
    },
    {
      name: 'content',
      type: 'string',
      description: 'Markdown内容',
      required: false,
      example: '# Hello\nThis is a markdown cell',
    },
    {
      name: 'format',
      type: 'string',
      description: '导出格式：html, pdf, markdown',
      required: false,
      enum: ['html', 'pdf', 'markdown'],
      example: 'markdown',
    },
  ];

  /**
   * 工具别名（包含 NotebookEditTool 兼容别名）
   */
  aliases = [
    'nb',
    'jupyter',
    'NotebookEditTool',
    'NotebookEdit',
    'EditNotebook',
  ];

  /**
   * 搜索提示
   */
  searchHint = 'Notebook创建和执行';

  /**
   * 搜索提示数组
   */
  searchTips = ['notebook', 'jupyter', 'code', 'markdown'];

  /**
   * 是否启用
   */
  enabled = true;

  /**
   * 是否只读
   */
  readOnly = false;

  /**
   * 是否破坏性
   */
  destructive = false;

  /**
   * 是否并发安全
   */
  concurrencySafe = true;

  /**
   * 是否延迟加载
   */
  deferred = false;

  /**
   * 是否始终加载
   */
  alwaysLoad = false;

  /**
   * 检查工具是否启用
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * 检查工具是否只读
   */
  isReadOnly(): boolean {
    return this.readOnly;
  }

  /**
   * 检查工具是否并发安全
   */
  isConcurrencySafe(): boolean {
    return this.concurrencySafe;
  }

  /**
   * 中断行为
   */
  interruptBehavior(): InterruptBehavior {
    return 'block';
  }

  /**
   * 最大结果大小
   */
  maxResultSizeChars = 10000;

  /**
   * Notebook工具实例
   */
  private notebookTool: NotebookToolImpl;

  /**
   * 已打开的 Notebook 映射（ID → Notebook）
   */
  private notebookMap: Map<string, Notebook> = new Map();

  /**
   * 构造函数
   */
  constructor() {
    this.notebookTool = new NotebookToolImpl();
  }

  /**
   * 验证参数
   */
  validateParams(params: Record<string, unknown>): ValidationResult {
    if (!params.action) {
      return { result: false, message: 'Missing required parameter: action' };
    }

    const action = params.action as string;

    if (action === 'create' && !params.name) {
      return {
        result: false,
        message: 'Missing required parameter: name for create action',
      };
    }

    if (action === 'export' && !params.format) {
      return {
        result: false,
        message: 'Missing required parameter: format for export action',
      };
    }

    return { result: true };
  }

  /**
   * 解析 Notebook：优先 notebookId，其次 notebook_path/path
   */
  private resolveNotebook(
    params: Record<string, unknown>
  ): Notebook | undefined {
    const notebookId = params.notebookId as string | undefined;
    if (notebookId) {
      return (
        this.notebookMap.get(notebookId) ||
        notebookManager.getNotebook(notebookId)
      );
    }

    const notebookPath = (params.notebook_path || params.path) as
      | string
      | undefined;
    if (notebookPath) {
      const existing = Array.from(this.notebookMap.values()).find(
        (n) => n.path === notebookPath
      );
      if (existing) return existing;
      try {
        const nb = notebookManager.openNotebook(notebookPath);
        this.notebookMap.set(nb.id, nb);
        return nb;
      } catch {
        return undefined;
      }
    }

    return undefined;
  }

  /**
   * 执行工具
   */
  async execute(
    params: Record<string, unknown>,
    context: ToolUseContext
  ): Promise<ToolResult> {
    try {
      const action = params.action as string;
      const name = params.name as string | undefined;
      const path = params.path as string | undefined;
      const notebookPath = params.notebook_path as string | undefined;
      const notebookId = params.notebookId as string | undefined;
      const cellId = params.cellId as string | undefined;
      const cellIndex = params.cell_index as number | undefined;
      const code = params.code as string | undefined;
      const language = params.language as string | undefined;
      const content = params.content as string | undefined;
      const format = params.format as string | undefined;

      switch (action) {
        case 'create': {
          const notebook = await this.notebookTool.createNotebook(name!);
          this.notebookMap.set(notebook.id, notebook);
          return {
            success: true,
            data: { notebookId: notebook.id, name: notebook.name },
            output: `Notebook created: ${name}`,
          };
        }

        case 'open': {
          const targetPath = (notebookPath || path)!;
          const openedNotebook =
            await this.notebookTool.openNotebook(targetPath);
          this.notebookMap.set(openedNotebook.id, openedNotebook);
          return {
            success: true,
            data: {
              notebookId: openedNotebook.id,
              name: openedNotebook.name,
              path: openedNotebook.path,
            },
            output: `Notebook opened: ${targetPath}`,
          };
        }

        case 'save': {
          const notebook = this.resolveNotebook(params);
          if (!notebook) {
            return {
              success: false,
              error: 'Notebook not found',
              output: 'Notebook not found',
            };
          }
          const targetPath = notebookPath || path;
          if (targetPath) {
            notebookManager.saveNotebookAs(notebook, targetPath);
          } else {
            notebookManager.saveNotebook(notebook);
          }
          return { success: true, output: `Notebook saved: ${notebook.name}` };
        }

        case 'addCodeCell': {
          const notebook = this.resolveNotebook(params);
          if (!notebook) {
            return {
              success: false,
              error: 'Notebook not found',
              output: 'Notebook not found',
            };
          }
          const cell = await this.notebookTool.addCodeCell(
            notebook,
            code!,
            language || 'python'
          );
          if (cellIndex !== undefined && !isNaN(cellIndex)) {
            const nb = notebook as any;
            if (nb.removeCell && nb.insertCell) {
              nb.removeCell(cell.id);
              nb.insertCell(cellIndex, cell);
            }
          }
          return {
            success: true,
            data: { cellId: cell.id, cellIndex, type: 'code' },
            output: `Code cell added to notebook: ${notebook.name}`,
          };
        }

        case 'addMarkdownCell': {
          const notebook = this.resolveNotebook(params);
          if (!notebook) {
            return {
              success: false,
              error: 'Notebook not found',
              output: 'Notebook not found',
            };
          }
          const cell = await this.notebookTool.addMarkdownCell(
            notebook,
            content!
          );
          if (cellIndex !== undefined && !isNaN(cellIndex)) {
            const nb = notebook as any;
            if (nb.removeCell && nb.insertCell) {
              nb.removeCell(cell.id);
              nb.insertCell(cellIndex, cell);
            }
          }
          return {
            success: true,
            data: { cellId: cell.id, cellIndex, type: 'markdown' },
            output: `Markdown cell added to notebook: ${notebook.name}`,
          };
        }

        case 'executeCell': {
          const notebook = this.resolveNotebook(params);
          if (!notebook) {
            return {
              success: false,
              error: 'Notebook not found',
              output: 'Notebook not found',
            };
          }
          const targetCell = cellId
            ? ((notebook as any).getCell(cellId) as CodeCell | undefined)
            : cellIndex !== undefined && !isNaN(cellIndex)
              ? (notebook.cells[cellIndex] as CodeCell)
              : undefined;
          if (!targetCell) {
            return {
              success: false,
              error: 'Cell not found',
              output: 'Cell not found',
            };
          }
          if (targetCell.type !== 'code') {
            return {
              success: false,
              error: 'Can only execute code cells',
              output: 'Can only execute code cells',
            };
          }
          const result = await this.notebookTool.executeCell(
            targetCell as CodeCell
          );
          return {
            success: result.success,
            data: result,
            output: result.success
              ? `Cell executed: ${cellId || cellIndex}`
              : `Cell execution failed: ${result.error}`,
          };
        }

        case 'export': {
          const notebook = this.resolveNotebook(params);
          if (!notebook) {
            return {
              success: false,
              error: 'Notebook not found',
              output: 'Notebook not found',
            };
          }
          const exportedContent = await this.notebookTool.exportNotebook(
            notebook,
            format as any
          );
          return {
            success: true,
            data: { content: exportedContent.toString('utf8'), format },
            output: `Notebook exported as ${format}`,
          };
        }

        case 'list': {
          const notebooks = notebookManager.getNotebooks();
          return {
            success: true,
            data: notebooks.map((n) => ({
              id: n.id,
              name: n.name,
              path: n.path,
              cells: n.cells.length,
            })),
            output: `Found ${notebooks.length} notebook(s)`,
          };
        }

        case 'delete': {
          const notebook = this.resolveNotebook(params);
          if (!notebook) {
            return {
              success: false,
              error: 'Notebook not found',
              output: 'Notebook not found',
            };
          }
          notebookManager.deleteNotebook(notebook);
          this.notebookMap.delete(notebook.id);
          return {
            success: true,
            output: `Notebook deleted: ${notebook.name}`,
          };
        }

        default:
          return {
            success: false,
            error: `Unknown action: ${action}`,
            output: `未知操作: ${action}`,
          };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        output: `Notebook tool failed: ${error}`,
      };
    }
  }

  /**
   * 获取工具信息
   */
  getInfo(): ToolInfo {
    return {
      name: this.name,
      description: this.description,
      params: this.params,
      aliases: this.aliases,
      searchTips: this.searchTips,
      searchHint: this.searchHint,
      enabled: this.enabled,
      readOnly: this.readOnly,
      destructive: this.destructive,
      concurrencySafe: this.concurrencySafe,
      deferred: this.deferred,
      alwaysLoad: this.alwaysLoad,
      interruptBehavior: this.interruptBehavior(),
      maxResultSizeChars: this.maxResultSizeChars,
      tags: [ToolTag.CODE],
    };
  }

  /**
   * 初始化工具
   */
  async initialize(): Promise<void> {
    // 初始化逻辑
  }

  /**
   * 清理工具
   */
  async cleanup(): Promise<void> {
    // 清理逻辑
  }
}
