// @ts-nocheck
/**
 * TaskStopTool UI 组件
 *
 * 显示被停止任务的状态信息，包括命令截断和停止状态
 *
 * 参考: cc_code/backend/tools/TaskStopTool/UI.tsx
 */

import React from 'react';
import { Box, Text } from '../../ink.js';

export type TaskStopOutput = {
  task_id: string;
  task_type: string;
  command?: string;
  message?: string;
};

const MAX_COMMAND_DISPLAY_LINES = 2;
const MAX_COMMAND_DISPLAY_CHARS = 160;

function truncateCommand(command: string): string {
  const lines = command.split('\n');
  let truncated = command;
  if (lines.length > MAX_COMMAND_DISPLAY_LINES) {
    truncated = lines.slice(0, MAX_COMMAND_DISPLAY_LINES).join('\n');
  }
  if (truncated.length > MAX_COMMAND_DISPLAY_CHARS) {
    truncated = truncated.slice(0, MAX_COMMAND_DISPLAY_CHARS);
  }
  return truncated.trim();
}

export function renderToolUseMessage(
  _input: Record<string, unknown>,
  _options: { verbose: boolean }
): React.ReactNode {
  return '';
}

export function renderToolResultMessage(
  output: TaskStopOutput,
  _progressMessages: unknown[],
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const rawCommand = output.command || output.message || '';
  const command = verbose ? rawCommand : truncateCommand(rawCommand);
  const statusText = command !== rawCommand ? '… · stopped' : ' · stopped';

  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text dimColor>✗ </Text>
        <Text>
          {command}
          {statusText}
        </Text>
      </Box>
      {output.task_id ? (
        <Box marginLeft={2}>
          <Text dimColor>
            Task: [{output.task_type}] #{output.task_id}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

export function renderToolUseRejectedMessage(
  _input: Record<string, unknown>,
  { verbose }: { verbose: boolean }
): React.ReactNode {
  return (
    <Box flexDirection="row">
      <Text dimColor>✗ </Text>
      <Text dimColor>Stop task request was rejected</Text>
    </Box>
  );
}

export function getToolUseSummary(
  input: Partial<{ task_id: string }> | undefined
): string | null {
  if (!input?.task_id) return null;
  return `Stop: ${input.task_id}`;
}
