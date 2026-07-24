import React from 'react';
import { Text, Box } from '../ink.js';
import { MarkdownRenderer } from './markdown.js';
import { LoadingDots } from './LoadingDots.js';
import { getToolUI } from './ToolUIRegistry.js';

export type MessageSender = 'user' | 'assistant' | 'system';

export interface ToolCallInfo {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResultInfo {
  toolName: string;
  success: boolean;
  result: string;
}

export interface ChatMessageProps {
  content: string;
  sender: MessageSender;
  timestamp?: Date;
  type?: 'text' | 'markdown';
  isLoading?: boolean;
  toolCall?: ToolCallInfo;
  toolResult?: ToolResultInfo;
  verbose?: boolean;
  knownFilePaths?: string[];
  onPreviewFile?: (path: string) => void;
}

const SENDER_LABELS: Record<MessageSender, string> = {
  user: 'You',
  assistant: 'Assistant',
  system: 'System',
};

const SENDER_COLORS: Record<MessageSender, string> = {
  user: 'blue',
  assistant: 'green',
  system: 'yellow',
};

const SENDER_BG_COLORS: Record<MessageSender, string> = {
  user: '#1E3A5F',
  assistant: '#1A3A1A',
  system: '#3A3A1A',
};

function formatTimestamp(date: Date): string {
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

function renderToolCall(toolCall: ToolCallInfo): React.ReactNode {
  return (
    <Box flexDirection="column" marginTop={1} marginLeft={2}>
      <Box flexDirection="row">
        <Text color="cyan">⚙ </Text>
        <Text bold color="cyan">
          {toolCall.name}
        </Text>
      </Box>
      <Box marginLeft={3}>
        <Text dimColor>
          {JSON.stringify(toolCall.args, null, 2).slice(0, 200)}
        </Text>
      </Box>
    </Box>
  );
}

function renderToolResult(toolResult: ToolResultInfo, verbose: boolean = false): React.ReactNode {
  // 终端兼容性：非 TTY 或无颜色支持时降级为纯文本
  const isPlain = !process.stdout.isTTY;

  // 优先使用 ToolUIRegistry 注册的专用渲染器
  const ui = getToolUI(toolResult.toolName);
  if (ui?.renderToolResultMessage) {
    try {
      return ui.renderToolResultMessage(toolResult.result, [], { verbose: verbose && !isPlain });
    } catch {
      // 专用渲染器异常时降级到通用渲染
    }
  }

  // plain 模式：纯文本，无 ANSI 颜色
  if (isPlain) {
    return (
      <Box flexDirection="column" marginTop={1} marginLeft={2}>
        <Text dimColor>
          [{toolResult.success ? 'OK' : 'ERR'}] {toolResult.toolName}
          {toolResult.result ? `: ${toolResult.result.slice(0, 500)}` : ''}
        </Text>
      </Box>
    );
  }

  // 通用渲染 fallback
  const color = toolResult.success ? 'green' : 'red';
  const icon = toolResult.success ? '✓' : '✗';
  return (
    <Box flexDirection="column" marginTop={1} marginLeft={2}>
      <Box flexDirection="row">
        <Text color={color}>
          {icon} {toolResult.toolName}
        </Text>
      </Box>
      <Box marginLeft={3}>
        <Text dimColor>
          {toolResult.result.slice(0, 300)}
          {toolResult.result.length > 300 ? '...' : ''}
        </Text>
      </Box>
    </Box>
  );
}

function getSenderBorderStyle(sender: MessageSender): 'round' | 'single' {
  switch (sender) {
    case 'user':
      return 'round';
    case 'assistant':
      return 'round';
    case 'system':
      return 'single';
    default:
      return 'single';
  }
}

export function ChatMessage({
  content,
  sender,
  timestamp,
  type = 'text',
  isLoading = false,
  toolCall,
  toolResult,
  verbose = false,
  knownFilePaths,
  onPreviewFile,
}: ChatMessageProps): React.ReactNode {
  const senderColor = SENDER_COLORS[sender];
  const borderStyle = getSenderBorderStyle(sender);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box
        flexDirection="column"
        borderStyle={borderStyle}
        borderColor={senderColor}
        paddingX={1}
        paddingY={1}
      >
        <Box flexDirection="row" marginBottom={1}>
          <Text bold color={senderColor}>
            {SENDER_LABELS[sender]}
          </Text>
          {timestamp && <Text dimColor> {formatTimestamp(timestamp)}</Text>}
        </Box>

        {isLoading ? (
          <LoadingDots />
        ) : type === 'markdown' && sender === 'assistant' ? (
          <MarkdownRenderer
            content={content}
            knownFilePaths={knownFilePaths}
            onPreviewFile={onPreviewFile}
          />
        ) : (
          <Text wrap="wrap">{content}</Text>
        )}

        {toolCall && renderToolCall(toolCall)}
        {toolResult && renderToolResult(toolResult, verbose)}
      </Box>
    </Box>
  );
}

export function createChatMessage(props: ChatMessageProps): React.ReactElement {
  return React.createElement(ChatMessage, props);
}
