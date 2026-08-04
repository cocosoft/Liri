/**
 * VoiceCommandRouter
 * 语音命令路由
 * 将语音唤醒 + 转录文本映射到具体命令/工具执行
 * 对标 OpenClaw 的 voice command routing 设计
 */

import { detectWakeWord } from './VoiceWakeManager';
import type { WakeDetectionResult } from './types';
import { VoiceToolBridge } from './VoiceToolBridge';
import type {
  ToolExecutorDelegate,
  ToolResultCallback,
  ToolProgressCallback,
} from './VoiceToolBridge';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';

const logger = new Logger({
  module: 'voice:commandRouter',
  level: LogLevel.INFO,
});

/** 命令动作类型 */
export type CommandActionType = 'tool_exec' | 'system_command' | 'custom';

/** 命令映射规则 */
export interface VoiceCommandRule {
  /** 匹配模式（正则或关键词） */
  pattern: string;
  /** 是否使用正则匹配 */
  isRegex: boolean;
  /** 命令动作类型 */
  actionType: CommandActionType;
  /** 动作参数 */
  action: Record<string, unknown>;
  /** 描述 */
  description?: string;
}

/** 命令路由配置 */
export interface VoiceCommandRouterConfig {
  /** 是否启用唤醒检测 */
  wakeDetectionEnabled: boolean;
  /** 命令映射规则列表 */
  rules: VoiceCommandRule[];
  /** 工具超时（毫秒） */
  toolTimeoutMs: number;
}

/** 命令路由结果 */
export interface CommandRoutingResult {
  /** 是否匹配到命令 */
  matched: boolean;
  /** 匹配的唤醒词 */
  matchedWakeTrigger: string | null;
  /** 匹配的命令规则 */
  matchedRule: VoiceCommandRule | null;
  /** 命令执行结果 */
  output: string | null;
  /** 错误信息 */
  error: string | null;
}

/** 默认命令映射规则 */
const DEFAULT_RULES: VoiceCommandRule[] = [
  {
    pattern: 'search (.*)',
    isRegex: true,
    actionType: 'tool_exec',
    action: { toolName: 'web_search', paramKey: 'query' },
    description: '搜索信息',
  },
  {
    pattern: 'open (.*)',
    isRegex: true,
    actionType: 'tool_exec',
    action: { toolName: 'browser_open', paramKey: 'url' },
    description: '打开链接',
  },
  {
    pattern: 'help',
    isRegex: false,
    actionType: 'system_command',
    action: { command: 'help' },
    description: '显示帮助信息',
  },
];

/** 默认路由配置 */
const DEFAULT_CONFIG: VoiceCommandRouterConfig = {
  wakeDetectionEnabled: true,
  rules: DEFAULT_RULES,
  toolTimeoutMs: 30000,
};

/**
 * 语音命令路由器
 * 检测唤醒词 → 匹配命令规则 → 执行工具/命令
 */
export class VoiceCommandRouter {
  private config: VoiceCommandRouterConfig;
  private toolBridge: VoiceToolBridge;
  private delegate: ToolExecutorDelegate | null = null;

  constructor(config?: Partial<VoiceCommandRouterConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.toolBridge = new VoiceToolBridge(this.config.toolTimeoutMs);
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<VoiceCommandRouterConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取当前配置
   */
  getConfig(): VoiceCommandRouterConfig {
    return { ...this.config };
  }

  /**
   * 设置工具执行委托
   */
  setToolDelegate(delegate: ToolExecutorDelegate): void {
    this.delegate = delegate;
    this.toolBridge.setDelegate(delegate);
  }

  /**
   * 设置工具结果回调
   */
  setOnToolResult(callback: ToolResultCallback): void {
    this.toolBridge.setOnToolResult(callback);
  }

  /**
   * 设置工具进度回调
   */
  setOnToolProgress(callback: ToolProgressCallback): void {
    this.toolBridge.setOnToolProgress(callback);
  }

  /**
   * 获取 VoiceToolBridge 实例
   */
  getToolBridge(): VoiceToolBridge {
    return this.toolBridge;
  }

  /**
   * 处理语音转录文本
   * 检测唤醒词 → 匹配命令规则 → 执行动作
   */
  async processTranscript(
    transcript: string,
    wakeTriggers?: string[]
  ): Promise<CommandRoutingResult> {
    if (!transcript || transcript.trim().length === 0) {
      return {
        matched: false,
        matchedWakeTrigger: null,
        matchedRule: null,
        output: null,
        error: null,
      };
    }

    // 检测唤醒词
    const wakeResult = await this.detectWakeIfEnabled(transcript, wakeTriggers);

    // 匹配命令规则
    const commandText = wakeResult.remainingText || transcript;
    const matchedRule = this.matchCommandRule(commandText);

    if (!matchedRule) {
      return {
        matched: false,
        matchedWakeTrigger: wakeResult.detected
          ? wakeResult.matchedTrigger
          : null,
        matchedRule: null,
        output: null,
        error: null,
      };
    }

    // 执行匹配的动作
    return this.executeAction(matchedRule, commandText, wakeResult);
  }

  /**
   * 检测唤醒词（如果启用）
   */
  private async detectWakeIfEnabled(
    transcript: string,
    wakeTriggers?: string[]
  ): Promise<WakeDetectionResult> {
    if (!this.config.wakeDetectionEnabled) {
      return { detected: false, matchedTrigger: null, remainingText: null };
    }
    return detectWakeWord(transcript, wakeTriggers);
  }

  /**
   * 匹配命令规则
   * 遍历规则列表，返回第一个匹配项
   */
  private matchCommandRule(text: string): VoiceCommandRule | null {
    const normalized = text.trim().toLowerCase();

    for (const rule of this.config.rules) {
      if (rule.isRegex) {
        try {
          const regex = new RegExp(rule.pattern, 'i');
          const match = normalized.match(regex);
          if (match) {
            return rule;
          }
        } catch (e) {
          void handleError(e, {
            module: 'voice:commandrouter',
            action: 'matchRule',
          });
          logger.warning('命令规则正则编译失败', { pattern: rule.pattern });
        }
      } else {
        if (normalized.startsWith(rule.pattern.toLowerCase())) {
          return rule;
        }
      }
    }

    return null;
  }

  /**
   * 执行匹配的动作
   */
  private async executeAction(
    rule: VoiceCommandRule,
    _commandText: string,
    wakeResult: WakeDetectionResult
  ): Promise<CommandRoutingResult> {
    try {
      switch (rule.actionType) {
        case 'tool_exec': {
          return await this.executeToolAction(rule, _commandText, wakeResult);
        }

        case 'system_command': {
          return this.executeSystemAction(rule, wakeResult);
        }

        case 'custom': {
          return {
            matched: true,
            matchedWakeTrigger: wakeResult.matchedTrigger,
            matchedRule: rule,
            output: `自定义命令: ${rule.action.command ?? rule.pattern}`,
            error: null,
          };
        }

        default:
          return {
            matched: true,
            matchedWakeTrigger: wakeResult.matchedTrigger,
            matchedRule: rule,
            output: null,
            error: `不支持的命令类型: ${rule.actionType}`,
          };
      }
    } catch (error) {
      void handleError(error, {
        module: 'voice:commandrouter',
        action: 'executeAction',
      });
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('命令执行失败', { error: errorMsg, pattern: rule.pattern });
      return {
        matched: true,
        matchedWakeTrigger: wakeResult.matchedTrigger,
        matchedRule: rule,
        output: null,
        error: errorMsg,
      };
    }
  }

  /**
   * 执行工具动作
   */
  private async executeToolAction(
    rule: VoiceCommandRule,
    commandText: string,
    wakeResult: WakeDetectionResult
  ): Promise<CommandRoutingResult> {
    let toolInput: Record<string, unknown>;

    const paramKey = (rule.action.paramKey as string) || 'input';
    if (rule.isRegex) {
      const regex = new RegExp(rule.pattern, 'i');
      const match = commandText.match(regex);
      if (match && match[1]) {
        toolInput = { [paramKey]: match[1].trim() };
      } else {
        toolInput = { [paramKey]: commandText };
      }
    } else {
      const withoutPrefix = commandText.slice(rule.pattern.length).trim();
      toolInput = { [paramKey]: withoutPrefix || commandText };
    }

    const toolName = (rule.action.toolName as string) || 'unknown_tool';

    if (!this.delegate) {
      return {
        matched: true,
        matchedWakeTrigger: wakeResult.matchedTrigger,
        matchedRule: rule,
        output: null,
        error: '工具系统未就绪（未设置 ToolExecutorDelegate）',
      };
    }

    try {
      const output = await this.delegate.executeTool(toolName, toolInput);
      return {
        matched: true,
        matchedWakeTrigger: wakeResult.matchedTrigger,
        matchedRule: rule,
        output,
        error: null,
      };
    } catch (error) {
      void handleError(error, {
        module: 'voice:commandrouter',
        action: 'executeToolAction',
      });
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        matched: true,
        matchedWakeTrigger: wakeResult.matchedTrigger,
        matchedRule: rule,
        output: null,
        error: errorMsg,
      };
    }
  }

  /**
   * 执行系统命令动作
   */
  private executeSystemAction(
    rule: VoiceCommandRule,
    wakeResult: WakeDetectionResult
  ): CommandRoutingResult {
    const command = (rule.action.command as string) || '';

    return {
      matched: true,
      matchedWakeTrigger: wakeResult.matchedTrigger,
      matchedRule: rule,
      output: `系统命令: ${command}`,
      error: null,
    };
  }
}
