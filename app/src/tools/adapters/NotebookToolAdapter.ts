/**
 * Notebook工具适配器
 */

import type {
  Tool,
  ToolInfo,
  ToolParam,
  ToolValidationResult,
  InterruptBehavior,
} from '../types/Tool.js';
import type { ToolUseContext } from '../types/ToolUseContext.js';
import type { ToolResult } from '../types/ToolResult.js';
import { ToolTag } from '../types/Tool.js';
import { NotebookToolImpl } from '../notebook/NotebookToolImpl.js';
import type { Notebook, CodeCell } from '../notebook/types/index.js';
import { notebookManager } from '../notebook/NotebookManager.js';
import { handleError } from '@modules/error/handleError';

/**
 * U-03（2026-10-20）：`notebook` 的**模型可见出参结构**。
 *
 * ⚠️ 本工具是**多 action 分支**工具，`data` 随 action 变化（`create`/`open`/`addCodeCell`/
 * `addMarkdownCell`/`executeCell`/`executeAllCells`/`export`/`list`/`save`/`delete`）⇒
 * 按既有约定（`channel` / `image_analysis` 等）声明**各分支字段的并集**，根级不设 `required`；
 * 分支内共同的 `notebookId` / `name` 等只作为可选属性出现。
 *
 * 为让顶层类型恒为 `object`（`output_schema` 只表达一种顶层类型），`list` 分支的
 * `data` 已从「裸数组」归一为 `{ notebooks, total }`。
 */
const NOTEBOOK_OUTPUT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  description:
    'notebook 的 data 按 action 分支变化，各分支只保证自己产出的字段',
  properties: {
    notebookId: { type: 'string', description: 'Notebook ID' },
    name: { type: 'string', description: 'Notebook 名称' },
    path: { type: 'string', description: 'Notebook 文件路径' },
    cellId: { type: 'string', description: '单元格 ID' },
    cellIndex: { type: 'number', description: '单元格索引（入参回显）' },
    type: {
      type: 'string',
      enum: ['code', 'markdown'],
      description: '新增单元格类型',
    },
    content: { type: 'string', description: '导出内容（export 分支）' },
    format: { type: 'string', description: '导出格式（export 分支）' },
    success: {
      type: 'boolean',
      description: '单元格执行是否成功（executeCell 分支）',
    },
    error: { type: 'string', description: '执行失败原因（executeCell 分支）' },
    executionTime: {
      type: 'number',
      description: '执行耗时（毫秒；executeCell 分支）',
    },
    output: {
      type: 'array',
      description: '单元格输出（executeCell 分支）',
      items: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['text', 'html', 'image', 'error'],
            description: '输出类型',
          },
          content: {
            type: ['string', 'object'],
            description: '输出内容（文本，或图片等二进制载荷）',
          },
          metadata: { type: 'object', description: '输出元数据' },
        },
        required: ['type', 'content'],
      },
    },
    results: {
      type: 'array',
      description: '逐单元格执行结果（executeAllCells 分支）',
      items: {
        type: 'object',
        properties: {
          cellId: { type: 'string' },
          success: { type: 'boolean' },
          error: { type: 'string' },
          executionTime: { type: 'number' },
        },
        required: ['cellId', 'success'],
      },
    },
    total: {
      type: 'number',
      description: '单元格总数（executeAllCells）或 Notebook 总数（list）',
    },
    succeeded: {
      type: 'number',
      description: '执行成功的单元格数（executeAllCells 分支）',
    },
    failed: {
      type: 'number',
      description: '执行失败的单元格数（executeAllCells 分支）',
    },
    notebooks: {
      type: 'array',
      description: 'Notebook 列表（list 分支）',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Notebook ID' },
          name: { type: 'string', description: '名称' },
          path: { type: 'string', description: '文件路径' },
          cells: { type: 'number', description: '单元格数量' },
        },
        required: ['id', 'name', 'cells'],
      },
    },
  },
};

/**
 * Notebook工具适配器
 */
export class NotebookToolAdapter implements Tool {
  /**
   * 工具名称
   */
  name = 'notebook';

  /** PR-0：非 `BaseTool`（无 `getRiskClass()`）⇒ 显式声明风险（lint:tool-risk 规则 3） */
  readonly riskClass = 'write' as const;

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
   * U-03（2026-10-20）：模型可见出参结构（多 action 分支并集，见文件头常量）
   */
  outputJsonSchema = NOTEBOOK_OUTPUT_JSON_SCHEMA;

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
  validateParams(params: Record<string, unknown>): ToolValidationResult {
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
          return {
            success: true,
            data: { notebookId: notebook.id, name: notebook.name },
            output: `Notebook saved: ${notebook.name}`,
          };
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

        // P2-1: 批量执行所有代码单元格（原仅接口存在，Adapter 未暴露）
        case 'executeAllCells': {
          const notebook = this.resolveNotebook(params);
          if (!notebook) {
            return {
              success: false,
              error: 'Notebook not found',
              output: 'Notebook not found',
            };
          }
          const results = await this.notebookTool.executeAllCells(notebook);
          const succeeded = results.filter((r) => r.success).length;
          const failed = results.length - succeeded;
          return {
            success: true,
            data: { results, total: results.length, succeeded, failed },
            output: `Executed ${results.length} cells (${succeeded} succeeded, ${failed} failed)`,
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
          // 注册导出文件到 FileRegistry
          const safeFormat = format || 'markdown';
          this.registerNotebookExport(
            exportedContent,
            notebook,
            safeFormat
          ).catch((err) => {
            handleError(err, {
              module: 'tools:notebook',
              action: '注册Notebook导出文件失败',
            });
          });
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
            // U-03（2026-10-20）：顶层类型统一为 object（原为裸数组），声明见 NOTEBOOK_OUTPUT_JSON_SCHEMA
            data: {
              notebooks: notebooks.map((n) => ({
                id: n.id,
                name: n.name,
                path: n.path,
                cells: n.cells.length,
              })),
              total: notebooks.length,
            },
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
            data: { notebookId: notebook.id, name: notebook.name },
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
      // U-03（2026-10-19）：显式效果声明 —— 编辑/执行本地 Notebook ⇒ 非幂等、副作用限本机
      idempotent: false,
      sideEffect: 'local',
      deferred: this.deferred,
      alwaysLoad: this.alwaysLoad,
      interruptBehavior: this.interruptBehavior(),
      maxResultSizeChars: this.maxResultSizeChars,
      tags: [ToolTag.CODE],
      // U-03（2026-10-20）：出参结构进快照（懒加载未解包时模型也能看到）
      outputJsonSchema: this.outputJsonSchema,
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

  /**
   * registerNotebookExport — 注册 Notebook 导出文件到 FileRegistry
   *
   * P0-3: storeZone 从 artifact 改为 notebook（前端"笔记本"分类可见），
   * 且写入 notebooks/exports/ 子目录，避免 .md/.html 与 NotebookManager 的 .ipynb 混目录。
   */
  private async registerNotebookExport(
    content: Buffer,
    notebook: { id: string; name: string },
    format: string
  ): Promise<void> {
    const { FileRegistry } =
      await import('@modules/services/file/FileRegistry');
    const registry = FileRegistry.getInstance();
    const extMap: Record<string, string> = {
      markdown: '.md',
      html: '.html',
      pdf: '.pdf',
    };
    const ext = extMap[format] || `.${format}`;

    await registry.registerFile({
      originalName: `${notebook.name}${ext}`,
      content,
      source: 'notebook_export',
      sourceId: notebook.id,
      mimeType:
        format === 'html'
          ? 'text/html'
          : format === 'pdf'
            ? 'application/pdf'
            : 'text/markdown',
      storeZone: 'notebook',
      subDir: 'exports',
      description: `Notebook 导出: ${notebook.name}`,
    });
  }
}
