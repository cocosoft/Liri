/**
 * ClipboardTool
 * 剪贴板读写工具
 * 跨平台支持：Windows(macOS/Linux 使用 pbpaste/pbcopy/xclip)
 */

import * as os from 'os';
import { spawnSync } from 'child_process';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { BaseTool } from '../BaseTool';
import type { ToolResult, ToolUseContext, ToolParam } from '../types/index';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'tools\ClipboardTool\ClipboardTool',
  level: LogLevel.INFO,
});

/**
 * 剪贴板操作参数
 */
export interface ClipboardInput {
  action: 'read' | 'write';
  content?: string;
  full?: boolean;
}

/**
 * 剪贴板操作结果
 */
export interface ClipboardOutput {
  action: 'read' | 'write';
  content: string;
  truncated: boolean;
  length: number;
}

const MAX_DEFAULT_CHARS = 1000;
const PLATFORM = os.platform();

/**
 * 获取系统剪贴板读取命令
 */
function getReadCommand(): string[] {
  switch (PLATFORM) {
    case 'win32':
      return ['powershell', '-Command', 'Get-Clipboard'];
    case 'darwin':
      return ['pbpaste'];
    case 'linux':
      return ['xclip', '-o', '-selection', 'clipboard'];
    default:
      throw new AppError(
        `Unsupported platform: ${PLATFORM}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'INVALID_INPUT',
        { platform: PLATFORM }
      );
  }
}

/**
 * 获取系统剪贴板写入命令
 */
function getWriteCommand(): string[] {
  switch (PLATFORM) {
    case 'win32':
      return ['powershell', '-Command', 'Set-Clipboard'];
    case 'darwin':
      return ['pbcopy'];
    case 'linux':
      return ['xclip', '-i', '-selection', 'clipboard'];
    default:
      throw new AppError(
        `Unsupported platform: ${PLATFORM}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'INVALID_INPUT',
        { platform: PLATFORM }
      );
  }
}

/**
 * 读取剪贴板内容
 */
function readClipboard(): string {
  const cmd = getReadCommand();
  const result = spawnSync(cmd[0], cmd.slice(1), {
    encoding: 'utf-8',
    timeout: 5000,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: PLATFORM === 'win32' ? 'cmd.exe' : true,
  });

  if (result.error) {
    throw result.error;
  }

  return (result.stdout || '').trim();
}

/**
 * 写入剪贴板内容
 */
function writeClipboard(content: string): void {
  const cmd = getWriteCommand();
  const result = spawnSync(cmd[0], cmd.slice(1), {
    input: content,
    encoding: 'utf-8',
    timeout: 5000,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: PLATFORM === 'win32' ? 'cmd.exe' : true,
  });

  if (result.error) {
    throw result.error;
  }
}

export class ClipboardTool extends BaseTool {
  name = 'clipboard';

  description =
    'Read or write system clipboard content. Supports text operations across Windows, macOS, and Linux.';

  params: ToolParam[] = [
    {
      name: 'action',
      type: 'string',
      enum: ['read', 'write'],
      description:
        'Clipboard operation: read (get content) or write (set content)',
      required: true,
    },
    {
      name: 'content',
      type: 'string',
      description: 'Content to write to clipboard (required for write action)',
      required: false,
    },
    {
      name: 'full',
      type: 'boolean',
      description:
        'Read full clipboard content without truncation (only for read action)',
      required: false,
      default: false,
    },
  ];

  async execute(input: any, _context: ToolUseContext): Promise<ToolResult> {
    try {
      const params = input as ClipboardInput;
      const action = params.action;

      switch (action) {
        case 'read':
          return this.handleRead(params);
        case 'write':
          return this.handleWrite(params);
        default:
          return {
            success: false,
            error: `Unknown action: ${action}. Supported: read, write`,
          };
      }
    } catch (error) {
      return {
        success: false,
        error: `Clipboard operation failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * 读取剪贴板内容
   */
  private handleRead(params: ClipboardInput): ToolResult {
    const content = readClipboard();
    const maxChars = params.full ? content.length : MAX_DEFAULT_CHARS;
    const truncated = content.length > maxChars;
    const displayContent = truncated ? content.substring(0, maxChars) : content;

    const data: ClipboardOutput = {
      action: 'read',
      content: displayContent,
      truncated,
      length: content.length,
    };

    return {
      success: true,
      data,
      output: truncated
        ? `Clipboard content (${content.length} chars, showing first ${maxChars}):\n${displayContent}`
        : `Clipboard content (${content.length} chars):\n${displayContent}`,
    };
  }

  /**
   * 写入剪贴板内容
   */
  private handleWrite(params: ClipboardInput): ToolResult {
    if (!params.content) {
      return {
        success: false,
        error: 'Content is required for write action',
      };
    }

    writeClipboard(params.content);

    const data: ClipboardOutput = {
      action: 'write',
      content: params.content,
      truncated: false,
      length: params.content.length,
    };

    return {
      success: true,
      data,
      output: `Clipboard written (${params.content.length} chars)`,
    };
  }
}

/**
 * 创建 ClipboardTool 实例
 */
export function createClipboardTool(): ClipboardTool {
  return new ClipboardTool();
}
