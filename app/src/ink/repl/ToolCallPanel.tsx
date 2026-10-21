import React from 'react';
import { Box, Text } from '../../ink';
import type { ToolCallInfo, ActiveToolCall } from './types';
import { summarizeToolResult } from './toolResultPreview';
// 状态字面量的**唯一事实源**（G14 + 状态字面量棘轮）：UI 不得裸写 'failed'/'unknown'
import {
  TOOL_CALL_FAILED_STATUS,
  TOOL_CALL_UNKNOWN_STATUS,
} from '@modules/execution';

interface ToolCallPanelProps {
  activeToolCalls: ActiveToolCall[];
  completedToolCalls?: ToolCallInfo[];
}

export const ToolCallPanel: React.FC<ToolCallPanelProps> = ({
  activeToolCalls,
  completedToolCalls,
}) => {
  if (
    activeToolCalls.length === 0 &&
    (!completedToolCalls || completedToolCalls.length === 0)
  ) {
    return null;
  }

  return (
    <Box flexDirection="column" marginBottom={1} paddingX={2}>
      {activeToolCalls.map((tc) => (
        <Box key={tc.toolCallId} flexDirection="row">
          <Text color="cyan">🔧 {tc.toolName}</Text>
          <Text color="gray"> [{tc.toolCallId.slice(0, 8)}]</Text>
          <Text color="yellow">
            {' '}
            {tc.status === 'running' ? '执行中...' : '已完成'}
          </Text>
        </Box>
      ))}
      {completedToolCalls?.map((tc) => (
        <CompletedToolCallRow key={tc.id || tc.name} toolCall={tc} />
      ))}
    </Box>
  );
};

/**
 * 已完成工具：状态（成功/失败/未知）+ **单行结果预览**
 *
 * 结果只经流内 `tool_call` 完成块下发（`tool_end`），此前被 REPL 整体丢弃 ⇒
 * 这里把它渲染出来；失败时优先显示 `error`（比空结果更有信息量）。
 */
const CompletedToolCallRow: React.FC<{ toolCall: ToolCallInfo }> = ({
  toolCall,
}) => {
  const failed = toolCall.status === TOOL_CALL_FAILED_STATUS;
  const unknown = toolCall.status === TOOL_CALL_UNKNOWN_STATUS;
  const preview = failed
    ? (toolCall.error ?? '工具执行失败')
    : summarizeToolResult(toolCall.result);

  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text color="cyan">🔧 {toolCall.name}</Text>
        <Text color="gray"> [{toolCall.id.slice(0, 8)}]</Text>
        {failed ? (
          <Text color="red"> 失败</Text>
        ) : unknown ? (
          <Text color="yellow"> 结果未知</Text>
        ) : (
          <Text color="green"> 已完成</Text>
        )}
      </Box>
      {preview ? (
        <Box paddingLeft={2}>
          <Text dimColor>{preview}</Text>
        </Box>
      ) : null}
    </Box>
  );
};
