/**
 * REPL工具适配器
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
import { REPLToolImpl } from '../repl/REPLToolImpl.js';
import type { REPLSession } from '../repl/types/index.js';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'tools:adapters:REPLToolAdapter', level: LogLevel.INFO });

/**
 * REPL工具适配器
 */
export class REPLToolAdapter implements Tool {
  /**
   * 工具名称
   */
  name = 'repl';

  /**
   * 工具描述
   */
  description = '交互式编程环境，支持多种编程语言';

  /**
   * 工具参数
   */
  params: ToolParam[] = [
    {
      name: 'action',
      type: 'string',
      description: '操作类型：start, execute, stop, languages',
      required: true,
      enum: ['start', 'execute', 'stop', 'languages'],
      example: 'execute',
    },
    {
      name: 'language',
      type: 'string',
      description: '编程语言',
      required: false,
      example: 'python',
    },
    {
      name: 'code',
      type: 'string',
      description: '要执行的代码',
      required: false,
      example: 'print("Hello, World!")',
    },
    {
      name: 'sessionId',
      type: 'string',
      description: '会话ID',
      required: false,
      example: 'session-123',
    },
  ];

  /**
   * 工具别名
   */
  aliases = ['interactive', 'console'];

  /**
   * 搜索提示
   */
  searchHint = '交互式编程环境';

  /**
   * 搜索提示数组
   */
  searchTips = ['python', 'javascript', 'typescript', 'bash', 'powershell'];

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
   * REPL工具实例
   */
  private replTool: REPLToolImpl;

  /**
   * REPL会话映射
   */
  private sessions: Map<string, REPLSession> = new Map();

  /**
   * 构造函数
   */
  constructor() {
    this.replTool = new REPLToolImpl();
  }

  /**
   * 验证参数
   */
  validateParams(params: Record<string, unknown>): ValidationResult {
    if (!params.action) {
      return { result: false, message: 'Missing required parameter: action' };
    }

    if (params.action === 'start' && !params.language) {
      return {
        result: false,
        message: 'Missing required parameter: language for start action',
      };
    }

    if (params.action === 'execute' && (!params.code || !params.sessionId)) {
      return {
        result: false,
        message:
          'Missing required parameters: code and sessionId for execute action',
      };
    }

    if (params.action === 'stop' && !params.sessionId) {
      return {
        result: false,
        message: 'Missing required parameter: sessionId for stop action',
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
      const action = params.action as string;
      const language = params.language as string | undefined;
      const code = params.code as string | undefined;
      const sessionId = params.sessionId as string | undefined;

      switch (action) {
        case 'start':
          const session = await this.replTool.startREPL(language!);
          this.sessions.set(session.id, session);
          return {
            success: true,
            data: {
              sessionId: session.id,
              language: session.language,
            },
            output: `REPL session started for ${language}`,
          };

        case 'execute':
          const sessionToExecute = this.sessions.get(sessionId!);
          if (!sessionToExecute) {
            return {
              success: false,
              error: `Session not found: ${sessionId}`,
              output: `会话不存在: ${sessionId}`,
            };
          }
          const executionResult = await this.replTool.executeCode(
            sessionToExecute,
            code!
          );
          return {
            success: executionResult.success,
            data: executionResult,
            output: executionResult.success
              ? '代码执行成功'
              : `代码执行失败: ${executionResult.error}`,
          };

        case 'stop':
          const sessionToStop = this.sessions.get(sessionId!);
          if (!sessionToStop) {
            return {
              success: false,
              error: `Session not found: ${sessionId}`,
              output: `会话不存在: ${sessionId}`,
            };
          }
          await this.replTool.stopREPL(sessionToStop);
          this.sessions.delete(sessionId!);
          return {
            success: true,
            output: `REPL session stopped: ${sessionId}`,
          };

        case 'languages':
          const languages = this.replTool.getSupportedLanguages();
          return {
            success: true,
            data: { languages },
            output: `Supported languages: ${languages.join(', ')}`,
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
        output: `REPL tool failed: ${error}`,
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
    // 清理所有会话
    for (const session of this.sessions.values()) {
      await this.replTool.stopREPL(session);
    }
    this.sessions.clear();
  }
}
