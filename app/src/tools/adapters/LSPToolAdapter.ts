/**
 * LSP工具适配器
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
import { LSPToolImpl } from '../lsp/LSPToolImpl.js';
import {
  Position,
  CompletionItem,
  Location,
  Diagnostic,
} from '../lsp/types/index.js';
import { SymbolSearch } from '../lsp/SymbolSearch.js';
import type { SymbolInfo, SymbolSearchResult } from '../lsp/SymbolSearch.js';
import { ReferenceFinder } from '../lsp/ReferenceFinder.js';
import type { ReferenceResult } from '../lsp/ReferenceFinder.js';
import { HoverProvider } from '../lsp/HoverProvider.js';
import type { HoverResult } from '../lsp/HoverProvider.js';
import { CallHierarchy } from '../lsp/CallHierarchy.js';
import type {
  CallHierarchyItem,
  CallHierarchyNode,
} from '../lsp/CallHierarchy.js';
import { SymbolContext as SymbolContextProvider } from '../lsp/SymbolContext.js';
import type { SymbolContextResult } from '../lsp/SymbolContext.js';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'tools:adapters:LSPToolAdapter', level: LogLevel.INFO });

/**
 * LSP工具适配器
 */
export class LSPToolAdapter implements Tool {
  /**
   * 工具名称
   */
  name = 'lsp';

  /**
   * 工具描述
   */
  description =
    'Language Server Protocol工具，提供代码智能提示、定义跳转等功能';

  /**
   * 工具参数
   */
  params: ToolParam[] = [
    {
      name: 'action',
      type: 'string',
      description:
        '操作类型：completions, definition, references, diagnostics, format, hover, rename, codeAction, implementation, typeDefinition',
      required: true,
      enum: [
        'completions',
        'definition',
        'references',
        'diagnostics',
        'format',
        'hover',
        'rename',
        'codeAction',
        'implementation',
        'typeDefinition',
        'workspaceSymbol',
        'documentSymbol',
        'callHierarchy',
        'symbolContext',
      ],
      example: 'completions',
    },
    {
      name: 'document',
      type: 'string',
      description: '代码文档内容',
      required: true,
      example: 'function hello() { console.log("Hello"); }',
    },
    {
      name: 'language',
      type: 'string',
      description: '编程语言',
      required: true,
      enum: [
        'typescript',
        'javascript',
        'python',
        'java',
        'csharp',
        'cpp',
        'go',
        'rust',
      ],
      example: 'typescript',
    },
    {
      name: 'position',
      type: 'object',
      description: '光标位置 {line, character}',
      required: false,
      example: { line: 0, character: 10 },
    },
    {
      name: 'newName',
      type: 'string',
      description: '新名称（用于rename操作）',
      required: false,
      example: 'newFunctionName',
    },
  ];

  /**
   * 工具别名
   */
  aliases = ['language-server', 'code-intelligence'];

  /**
   * 搜索提示
   */
  searchHint = '代码智能提示和分析';

  /**
   * 搜索提示数组
   */
  searchTips = [
    'code completion',
    'definition',
    'references',
    'diagnostics',
    'format',
  ];

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
   * LSP工具实例
   */
  private lspTool: LSPToolImpl;
  private symbolSearch: SymbolSearch;
  private referenceFinder: ReferenceFinder;
  private hoverProvider: HoverProvider;
  private callHierarchy: CallHierarchy;
  private symbolContextProvider: SymbolContextProvider;

  /**
   * 构造函数
   */
  constructor() {
    this.lspTool = new LSPToolImpl();
    this.symbolSearch = new SymbolSearch(this.lspTool);
    this.referenceFinder = new ReferenceFinder(this.lspTool);
    this.hoverProvider = new HoverProvider(this.lspTool);
    this.callHierarchy = new CallHierarchy(this.lspTool);
    this.symbolContextProvider = new SymbolContextProvider();
  }

  /**
   * 验证参数
   */
  validateParams(params: Record<string, unknown>): ValidationResult {
    if (!params.action) {
      return { result: false, message: 'Missing required parameter: action' };
    }

    if (!params.document) {
      return { result: false, message: 'Missing required parameter: document' };
    }

    if (!params.language) {
      return { result: false, message: 'Missing required parameter: language' };
    }

    const positionActions = [
      'completions',
      'definition',
      'references',
      'hover',
      'implementation',
      'typeDefinition',
      'callHierarchy',
    ];
    if (positionActions.includes(params.action as string) && !params.position) {
      return {
        result: false,
        message: 'Missing required parameter: position for this action',
      };
    }

    if (params.action === 'rename' && !params.newName) {
      return {
        result: false,
        message: 'Missing required parameter: newName for rename action',
      };
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
      // 启动LSP服务器
      await this.lspTool.startServer();

      let result: any;
      const action = params.action as string;
      const document = params.document as string;
      const language = params.language as string;
      const position = params.position as Position | undefined;
      const newName = params.newName as string;

      switch (action) {
        case 'completions':
          result = await this.lspTool.getCompletions(
            document,
            position as Position
          );
          break;
        case 'definition':
          result = await this.lspTool.getDefinition(
            document,
            position as Position
          );
          break;
        case 'references':
          result = await this.lspTool.getReferences(
            document,
            position as Position
          );
          break;
        case 'diagnostics':
          result = await this.lspTool.getDiagnostics(document);
          break;
        case 'format':
          result = await this.lspTool.formatDocument(document);
          break;
        case 'hover':
          result = await this.lspTool.getHover(document, position as Position);
          break;
        case 'rename':
          result = await this.lspTool.renameSymbol(
            document,
            position as Position,
            newName
          );
          break;
        case 'codeAction':
          result = await this.lspTool.getCodeActions(
            document,
            position as Position
          );
          break;
        case 'implementation':
          result = await this.lspTool.getImplementation(
            document,
            position as Position
          );
          break;
        case 'typeDefinition':
          result = await this.lspTool.getTypeDefinition(
            document,
            position as Position
          );
          break;
        case 'workspaceSymbol': {
          const query =
            (params.query as string) || (params.symbol as string) || '';
          result = await this.symbolSearch.searchWorkspaceSymbols(query);
          break;
        }
        case 'documentSymbol':
          result = await this.symbolSearch.getDocumentSymbols(
            (params.uri as string) || `file://${document}`
          );
          break;
        case 'callHierarchy': {
          const p = position as Record<string, unknown> | undefined;
          const items = await this.callHierarchy.prepareCallHierarchy(
            (params.uri as string) || `file://${document}`,
            (params.line as number) ?? (p?.line as number) ?? 0,
            (params.character as number) ?? (p?.character as number) ?? 0
          );
          result = await this.callHierarchy.buildCallHierarchy(
            (params.uri as string) || `file://${document}`,
            (params.line as number) ?? (p?.line as number) ?? 0,
            (params.character as number) ?? (p?.character as number) ?? 0
          );
          break;
        }
        case 'symbolContext': {
          result = await this.symbolContextProvider.getSymbolContext(
            document,
            (params.line as number) ??
              ((position as unknown as Record<string, unknown>)
                ?.line as number) ??
              0,
            (params.character as number) ??
              ((position as unknown as Record<string, unknown>)
                ?.character as number) ??
              0,
            (params.filePath as string) || ''
          );
          break;
        }
        default:
          return {
            success: false,
            error: `Unknown action: ${action}`,
            output: `未知操作: ${action}`,
          };
      }

      return {
        success: true,
        data: result,
        output: `LSP ${action} completed successfully`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        output: `LSP tool failed: ${error}`,
      };
    } finally {
      // 停止LSP服务器
      await this.lspTool.stopServer();
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
    await this.lspTool.stopServer();
  }

  /**
   * 获取用户可见的工具名称
   */
  userFacingName(input?: Partial<any>): string {
    const action = (input?.action as string) || '';
    const language = (input?.language as string) || '';
    if (action && language) {
      return `LSP: ${action} (${language})`;
    }
    return this.name;
  }

  /**
   * 获取活动描述
   */
  getActivityDescription(input?: Partial<any>): string | null {
    const action = (input?.action as string) || '';
    const language = (input?.language as string) || '';
    if (action && language) {
      switch (action) {
        case 'completions':
          return `Getting code completions for ${language}`;
        case 'definition':
          return `Finding definition in ${language} code`;
        case 'references':
          return `Finding references in ${language} code`;
        case 'diagnostics':
          return `Getting diagnostics for ${language} code`;
        case 'format':
          return `Formatting ${language} code`;
        case 'workspaceSymbol':
          return `Searching workspace symbols`;
        case 'documentSymbol':
          return `Getting document symbols`;
        case 'callHierarchy':
          return `Building call hierarchy`;
        case 'symbolContext':
          return `Extracting symbol context`;
        default:
          return `Performing LSP action: ${action} on ${language} code`;
      }
    }
    return null;
  }

  /**
   * 获取工具使用摘要
   */
  getToolUseSummary(input?: Partial<any>): string | null {
    const action = (input?.action as string) || '';
    const language = (input?.language as string) || '';
    if (action && language) {
      switch (action) {
        case 'completions':
          return `Get code completions for ${language}`;
        case 'definition':
          return `Find definition in ${language} code`;
        case 'references':
          return `Find references in ${language} code`;
        case 'diagnostics':
          return `Get diagnostics for ${language} code`;
        case 'format':
          return `Format ${language} code`;
        default:
          return `Perform LSP action: ${action} on ${language} code`;
      }
    }
    return null;
  }
}
