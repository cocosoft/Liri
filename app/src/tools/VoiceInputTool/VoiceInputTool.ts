/**
 * 语音输入工具
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { Tool, ToolInfo, ToolTag, ValidationResult } from '../types/Tool';
import { ToolResult, ToolExecutionStatus } from '../types/ToolResult';
import { ToolUseContext } from '../types/ToolUseContext';
import { VOICE_INPUT_TOOL_NAME } from './constants';
import { VoiceInputOutputSchema } from './schemas';
import voiceService from '@modules/services/voice';

const logger = getLogger('tools:voiceInput');

const VOICE_INPUT_PARAMS = [
  {
    name: 'action',
    type: 'string' as const,
    description: '操作类型：start, stop, check',
    required: true,
    enum: ['start', 'stop', 'check'],
  },
  {
    name: 'language',
    type: 'string' as const,
    description: '识别语言',
    required: false,
    default: 'zh-CN',
  },
];

export class VoiceInputTool implements Tool {
  name: string = VOICE_INPUT_TOOL_NAME;

  /**
   * 出参契约（P1-3 A 档；2026-09-29 **T6 批次 3 接线**）。
   *
   * 该 schema **早已存在却零消费者**；且本工具**手写 `ToolResult`、载荷放在 `result`**（非 `data`）
   * —— 这正是本次顺带补上「载荷缺省**回退 `result`**」的原因（否则声明的契约会**静默永不校验**）。
   * 实测三个成功分支的 `result` 分别是 `{recording, language}`（`start`）、识别结果对象（`stop`）、
   * `{recording, available, dependenciesAvailable, missing}`（`check`）——**全在 schema 的 8 个
   * 可选字段之内**（这就是它把字段全写成 optional 的原因：三个 action 形态的并集）⇒ 接线。
   * 失败分支 `result: null` ⇒ 命中「**无载荷不校验**」⇒ 不会误报。
   *
   * 2026-09-30（P1-3 **B2-a**，spec `architecture-benchmark-20260928.md` §2.2.1）：载荷已由
   * `result` **迁至 `data`**（对齐 `createToolResult` 家族）⇒ 不再依赖"校验器回退读 `result`"；
   * 上文的历史说明保留作沿革。
   */
  outputSchema = VoiceInputOutputSchema;
  description: string = '语音输入工具，用于将语音转换为文本';
  params = VOICE_INPUT_PARAMS;
  private isActive: boolean = false;
  private audioChunks: Buffer[] = [];

  async execute(
    input: Record<string, unknown>,
    _context?: ToolUseContext
  ): Promise<ToolResult> {
    const action = input.action as string;

    logger.info('VoiceInputTool · 执行', { action, language: input.language });
    switch (action) {
      case 'start':
        return await this.handleStart(input);
      case 'stop':
        return await this.handleStop(input);
      case 'check':
        return await this.handleCheck();
      default:
        logger.warn('VoiceInputTool · 未知操作', { action });
        return {
          status: ToolExecutionStatus.FAILURE,
          data: null,
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

  private async handleStart(
    input: Record<string, unknown>
  ): Promise<ToolResult> {
    try {
      const language = (input.language as string) || 'zh-CN';

      if (this.isActive) {
        logger.warn('VoiceInputTool · 录音已在进行中');
        return {
          status: ToolExecutionStatus.FAILURE,
          data: null,
          error: 'Recording already in progress',
          executionTime: 0,
          output: '',
          errorOutput: '录音已经在进行中',
          progress: [],
          metadata: {},
          executionId: '',
          toolName: this.name,
          timestamp: Date.now(),
        };
      }

      const started = await voiceService.startRecording(
        (chunk: Buffer) => {
          this.audioChunks.push(chunk);
        },
        () => {
          this.isActive = false;
        }
      );

      if (!started) {
        logger.error('VoiceInputTool · 启动录音失败');
        return {
          status: ToolExecutionStatus.FAILURE,
          data: null,
          error: 'Failed to start recording',
          executionTime: 0,
          output: '',
          errorOutput: '启动录音失败',
          progress: [],
          metadata: {},
          executionId: '',
          toolName: this.name,
          timestamp: Date.now(),
        };
      }

      this.isActive = true;
      this.audioChunks = [];
      logger.info('VoiceInputTool · 录音已启动', { language });

      return {
        status: ToolExecutionStatus.SUCCESS,
        data: { recording: true, language },
        error: undefined,
        executionTime: 0,
        output: '语音输入已启动，请开始说话',
        errorOutput: '',
        progress: [],
        metadata: { language },
        executionId: `voice-input-${Date.now()}`,
        toolName: this.name,
        timestamp: Date.now(),
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      void handleError(error, {
        module: 'tools:voiceInput',
        action: '启动录音异常',
      });
      return {
        status: ToolExecutionStatus.FAILURE,
        data: null,
        error: errorMsg,
        executionTime: 0,
        output: '',
        errorOutput: `启动语音输入失败: ${error}`,
        progress: [],
        metadata: {},
        executionId: '',
        toolName: this.name,
        timestamp: Date.now(),
      };
    }
  }

  private async handleStop(
    input: Record<string, unknown>
  ): Promise<ToolResult> {
    try {
      if (!this.isActive) {
        logger.warn('VoiceInputTool · 没有正在进行的录音');
        return {
          status: ToolExecutionStatus.FAILURE,
          data: null,
          error: 'No recording in progress',
          executionTime: 0,
          output: '',
          errorOutput: '没有正在进行的录音',
          progress: [],
          metadata: {},
          executionId: '',
          toolName: this.name,
          timestamp: Date.now(),
        };
      }

      voiceService.stopRecording();
      this.isActive = false;

      const audioData = Buffer.concat(this.audioChunks);
      const result = await voiceService.recognize(audioData);

      this.audioChunks = [];
      logger.info('VoiceInputTool · 语音识别完成', {
        text: result.text,
        confidence: result.confidence,
      });

      return {
        status: ToolExecutionStatus.SUCCESS,
        data: result,
        error: undefined,
        executionTime: 0,
        output: `识别结果: ${result.text}`,
        errorOutput: '',
        progress: [],
        metadata: { confidence: result.confidence, duration: result.duration },
        executionId: `voice-input-${Date.now()}`,
        toolName: this.name,
        timestamp: Date.now(),
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      void handleError(error, {
        module: 'tools:voiceInput',
        action: '停止录音异常',
      });
      return {
        status: ToolExecutionStatus.FAILURE,
        data: null,
        error: errorMsg,
        executionTime: 0,
        output: '',
        errorOutput: `停止语音输入失败: ${error}`,
        progress: [],
        metadata: {},
        executionId: '',
        toolName: this.name,
        timestamp: Date.now(),
      };
    }
  }

  private async handleCheck(): Promise<ToolResult> {
    const availability = await voiceService.checkRecordingAvailability();
    const dependencies = await voiceService.checkVoiceDependencies();

    return {
      status: ToolExecutionStatus.SUCCESS,
      data: {
        recording: this.isActive,
        available: availability.available,
        dependenciesAvailable: dependencies.available,
        missing: dependencies.missing,
      },
      error: undefined,
      executionTime: 0,
      output: availability.reason || '语音输入就绪',
      errorOutput: '',
      progress: [],
      metadata: {},
      executionId: `voice-input-check-${Date.now()}`,
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

    const validActions = ['start', 'stop', 'check'];
    if (!validActions.includes(input.action as string)) {
      return {
        result: false,
        message: `action must be one of: ${validActions.join(', ')}`,
      };
    }

    return { result: true };
  }

  userFacingName(input?: Partial<any>): string {
    const action = input?.action as string;
    if (action === 'start') {
      return 'Voice Input (Recording)';
    }
    if (action === 'stop') {
      return 'Voice Input (Processing)';
    }
    return 'Voice Input';
  }

  getActivityDescription(input?: Partial<any>): string | null {
    const action = input?.action as string;
    if (action === 'start') {
      return 'Starting voice input';
    }
    if (action === 'stop') {
      return 'Processing voice input';
    }
    if (action === 'check') {
      return 'Checking voice input status';
    }
    return null;
  }

  getToolUseSummary(input?: Partial<any>): string | null {
    const action = input?.action as string;
    if (action === 'start') {
      return 'Start voice recording';
    }
    if (action === 'stop') {
      return 'Stop recording and recognize speech';
    }
    if (action === 'check') {
      return 'Check voice input availability';
    }
    return null;
  }
}

export const voiceInputTool = new VoiceInputTool();
export default voiceInputTool;
