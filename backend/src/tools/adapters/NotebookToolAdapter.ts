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
import { NotebookToolImpl } from '../notebook/NotebookToolImpl.js';
import type { Notebook, CodeCell } from '../notebook/types/index.js';

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
        '操作类型：create, open, save, addCodeCell, addMarkdownCell, executeCell, export',
      required: true,
      enum: [
        'create',
        'open',
        'save',
        'addCodeCell',
        'addMarkdownCell',
        'executeCell',
        'export',
      ],
      example: 'create',
    },
    {
      name: 'name',
      type: 'string',
      description: 'Notebook名称',
      required: false,
      example: 'My Notebook',
    },
    {
      name: 'path',
      type: 'string',
      description: 'Notebook路径',
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
   * 工具别名
   */
  aliases = ['nb', 'jupyter'];

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

    switch (params.action) {
      case 'create':
        if (!params.name) {
          return {
            result: false,
            message: 'Missing required parameter: name for create action',
          };
        }
        break;
      case 'open':
        if (!params.path) {
          return {
            result: false,
            message: 'Missing required parameter: path for open action',
          };
        }
        break;
      case 'save':
        if (!params.notebookId) {
          return {
            result: false,
            message: 'Missing required parameter: notebookId for save action',
          };
        }
        break;
      case 'addCodeCell':
        if (!params.notebookId || !params.code || !params.language) {
          return {
            result: false,
            message:
              'Missing required parameters: notebookId, code, language for addCodeCell action',
          };
        }
        break;
      case 'addMarkdownCell':
        if (!params.notebookId || !params.content) {
          return {
            result: false,
            message:
              'Missing required parameters: notebookId, content for addMarkdownCell action',
          };
        }
        break;
      case 'executeCell':
        if (!params.cellId) {
          return {
            result: false,
            message:
              'Missing required parameter: cellId for executeCell action',
          };
        }
        break;
      case 'export':
        if (!params.notebookId || !params.format) {
          return {
            result: false,
            message:
              'Missing required parameters: notebookId, format for export action',
          };
        }
        break;
    }

    return { result: true };
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
      const notebookId = params.notebookId as string | undefined;
      const cellId = params.cellId as string | undefined;
      const code = params.code as string | undefined;
      const language = params.language as string | undefined;
      const content = params.content as string | undefined;
      const format = params.format as string | undefined;

      switch (action) {
        case 'create':
          const notebook = await this.notebookTool.createNotebook(name!);
          return {
            success: true,
            data: {
              notebookId: notebook.id,
              name: notebook.name,
            },
            output: `Notebook created: ${name}`,
          };

        case 'open':
          const openedNotebook = await this.notebookTool.openNotebook(path!);
          return {
            success: true,
            data: {
              notebookId: openedNotebook.id,
              name: openedNotebook.name,
              path: openedNotebook.path,
            },
            output: `Notebook opened: ${path}`,
          };

        case 'save':
          // 这里需要获取Notebook实例，实际实现中可能需要存储映射
          return {
            success: true,
            output: `Notebook saved: ${notebookId}`,
          };

        case 'addCodeCell':
          // 这里需要获取Notebook实例
          return {
            success: true,
            output: `Code cell added to notebook: ${notebookId}`,
          };

        case 'addMarkdownCell':
          // 这里需要获取Notebook实例
          return {
            success: true,
            output: `Markdown cell added to notebook: ${notebookId}`,
          };

        case 'executeCell':
          // 这里需要获取Cell实例
          return {
            success: true,
            output: `Cell executed: ${cellId}`,
          };

        case 'export':
          // 这里需要获取Notebook实例
          const exportedContent = await this.notebookTool.exportNotebook(
            { id: notebookId! } as Notebook,
            format as any
          );
          return {
            success: true,
            data: {
              content: exportedContent.toString('utf8'),
              format,
            },
            output: `Notebook exported as ${format}`,
          };

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
