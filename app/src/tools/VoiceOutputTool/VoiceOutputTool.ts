/**
 * 语音输出工具
 */

import { Logger, LogLevel } from '@modules/monitoring';
import { Tool, ToolInfo, ToolTag, ValidationResult } from '../types/Tool';
import { ToolResult, ToolExecutionStatus } from '../types/ToolResult';
import { ToolUseContext } from '../types/ToolUseContext';
import { VOICE_OUTPUT_TOOL_NAME } from './constants';
import voiceService from '@modules/services/voice';

const logger = new Logger({
  module: 'tools:voiceOutput',
  level: LogLevel.INFO,
});

const VOICE_OUTPUT_PARAMS = [
  {
    name: 'action',
    type: 'string' as const,
    description: '操作类型：speak, stop, check',
    required: true,
    enum: ['speak', 'stop', 'check'],
  },
  {
    name: 'text',
    type: 'string' as const,
    description: '要朗读的文本',
    required: false,
  },
  {
    name: 'voice',
    type: 'string' as const,
    description: '语音名称',
    required: false,
  },
  {
    name: 'speed',
    type: 'number' as const,
    description: '语速（0.5-2.0）',
    required: false,
    default: 1.0,
  },
];

export class VoiceOutputTool implements Tool {
  name: string = VOICE_OUTPUT_TOOL_NAME;
  description: string = '语音输出工具，用于将文本转换为语音';
  params = VOICE_OUTPUT_PARAMS;
  private isSpeaking: boolean = false;

  async execute(
    input: Record<string, unknown>,
    _context?: ToolUseContext
  ): Promise<ToolResult> {
    const action = input.action as string;

    logger.info('VoiceOutputTool · 执行', {
      action,
      textLength: (input.text as string)?.length,
    });
    switch (action) {
      case 'speak':
        return await this.handleSpeak(input);
      case 'stop':
        return await this.handleStop();
      case 'check':
        return await this.handleCheck();
      default:
        logger.warn('VoiceOutputTool · 未知操作', { action });
        return {
          status: ToolExecutionStatus.FAILURE,
          result: null,
          error: `Unknown action: ${action}`,
          executionTime: 0,
          output: '',
          errorOutput: `未知操作: ${action}`,
          progress: [],
          metadata: {},
          executionId: '',
          toolName: this.name,
          timestamp: Date.now(),
        };
    }
  }

  private async handleSpeak(
    input: Record<string, unknown>
  ): Promise<ToolResult> {
    try {
      const text = input.text as string;

      if (!text) {
        logger.warn('VoiceOutputTool · 缺少朗读文本');
        return {
          status: ToolExecutionStatus.FAILURE,
          result: null,
          error: 'Missing text parameter',
          executionTime: 0,
          output: '',
          errorOutput: '缺少要朗读的文本',
          progress: [],
          metadata: {},
          executionId: '',
          toolName: this.name,
          timestamp: Date.now(),
        };
      }

      if (this.isSpeaking) {
        logger.warn('VoiceOutputTool · 正在朗读中');
        return {
          status: ToolExecutionStatus.FAILURE,
          result: null,
          error: 'Already speaking',
          executionTime: 0,
          output: '',
          errorOutput: '正在朗读，请先停止',
          progress: [],
          metadata: {},
          executionId: '',
          toolName: this.name,
          timestamp: Date.now(),
        };
      }

      const voice = input.voice as string | undefined;
      const speed = input.speed as number | undefined;

      this.isSpeaking = true;
      logger.info('VoiceOutputTool · 开始朗读', {
        textLength: text.length,
        voice,
        speed,
      });

      await voiceService.speak({
        text,
        voice,
        speed: speed ?? 1.0,
      });

      this.isSpeaking = false;
      logger.info('VoiceOutputTool · 朗读完成', { textLength: text.length });

      return {
        status: ToolExecutionStatus.SUCCESS,
        result: { spoken: true, textLength: text.length },
        error: undefined,
        executionTime: 0,
        output: '文本已朗读完成',
        errorOutput: '',
        progress: [],
        metadata: { textLength: text.length },
        executionId: `voice-output-${Date.now()}`,
        toolName: this.name,
        timestamp: Date.now(),
      };
    } catch (error) {
      this.isSpeaking = false;
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('VoiceOutputTool · 朗读失败', { error: errorMsg });
      return {
        status: ToolExecutionStatus.FAILURE,
        result: null,
        error: errorMsg,
        executionTime: 0,
        output: '',
        errorOutput: `朗读失败: ${error}`,
        progress: [],
        metadata: {},
        executionId: '',
        toolName: this.name,
        timestamp: Date.now(),
      };
    }
  }

  private async handleStop(): Promise<ToolResult> {
    try {
      voiceService.stopSpeaking();
      this.isSpeaking = false;
      logger.info('VoiceOutputTool · 已停止朗读');

      return {
        status: ToolExecutionStatus.SUCCESS,
        result: { stopped: true },
        error: undefined,
        executionTime: 0,
        output: '已停止朗读',
        errorOutput: '',
        progress: [],
        metadata: {},
        executionId: `voice-output-stop-${Date.now()}`,
        toolName: this.name,
        timestamp: Date.now(),
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('VoiceOutputTool · 停止朗读失败', { error: errorMsg });
      return {
        status: ToolExecutionStatus.FAILURE,
        result: null,
        error: errorMsg,
        executionTime: 0,
        output: '',
        errorOutput: `停止朗读失败: ${error}`,
        progress: [],
        metadata: {},
        executionId: '',
        toolName: this.name,
        timestamp: Date.now(),
      };
    }
  }

  private async handleCheck(): Promise<ToolResult> {
    return {
      status: ToolExecutionStatus.SUCCESS,
      result: {
        speaking: this.isSpeaking,
        available: true,
        languages: voiceService.getSupportedLanguages(),
      },
      error: undefined,
      executionTime: 0,
      output: '语音输出就绪',
      errorOutput: '',
      progress: [],
      metadata: {},
      executionId: `voice-output-check-${Date.now()}`,
      toolName: this.name,
      timestamp: Date.now(),
    };
  }

  getInfo(): ToolInfo {
    return {
      name: this.name,
      description: this.description,
      params: this.params,
      enabled: true,
      readOnly: false,
      destructive: false,
      concurrencySafe: true,
      deferred: false,
      alwaysLoad: false,
      interruptBehavior: 'block',
      tags: [ToolTag.AI],
    };
  }

  isEnabled(): boolean {
    return true;
  }

  isReadOnly(_input?: Record<string, unknown>): boolean {
    return false;
  }

  isDestructive(_input?: Record<string, unknown>): boolean {
    return false;
  }

  isConcurrencySafe(_input?: Record<string, unknown>): boolean {
    return true;
  }

  validateInput(input: Record<string, unknown>): ValidationResult {
    if (!input.action) {
      return { result: false, message: 'Missing required parameter: action' };
    }

    const validActions = ['speak', 'stop', 'check'];
    if (!validActions.includes(input.action as string)) {
      return {
        result: false,
        message: `action must be one of: ${validActions.join(', ')}`,
      };
    }

    if (input.action === 'speak' && !input.text) {
      return { result: false, message: 'text is required for speak action' };
    }

    return { result: true };
  }

  userFacingName(input?: Partial<any>): string {
    const action = input?.action as string;
    if (action === 'speak') {
      return 'Voice Output (Speaking)';
    }
    if (action === 'stop') {
      return 'Voice Output (Stopping)';
    }
    return 'Voice Output';
  }

  getActivityDescription(input?: Partial<any>): string | null {
    const action = input?.action as string;
    if (action === 'speak') {
      return 'Speaking text';
    }
    if (action === 'stop') {
      return 'Stopping speech';
    }
    if (action === 'check') {
      return 'Checking voice output status';
    }
    return null;
  }

  getToolUseSummary(input?: Partial<any>): string | null {
    const action = input?.action as string;
    if (action === 'speak') {
      return 'Speak text';
    }
    if (action === 'stop') {
      return 'Stop speaking';
    }
    if (action === 'check') {
      return 'Check voice output availability';
    }
    return null;
  }
}

export const voiceOutputTool = new VoiceOutputTool();
export default voiceOutputTool;
