// @ts-nocheck
/**
 * TaskOutput UI 组件
 *
 * 在终端内实时展示子任务输出，支持进度条和流式更新
 *
 * 参考: cc_code/backend/tools/TaskOutputTool/TaskOutputTool.tsx
 */

import React from 'react';
import { Box, Text } from '../../ink.js';

export type TaskOutputData = {
  task_id: string;
  task_type: string;
  status: string;
  description: string;
  output: string;
  exitCode?: number | null;
  error?: string;
  prompt?: string;
  result?: string;
};

export function renderToolUseMessage(
  input: Partial<{ task_id: string; block?: boolean; timeout?: number }>,
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const { task_id } = input;
  if (!task_id) return null;

  return (
    <Box flexDirection="row">
      <Text dimColor>Get output from </Text>
      <Text bold>{task_id}</Text>
      {verbose && input.timeout ? (
        <Text dimColor> (timeout: {input.timeout}ms)</Text>
      ) : null}
    </Box>
  );
}

export function renderToolResultMessage(
  output: TaskOutputData,
  _progressMessages: unknown[],
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const {
    task_id,
    task_type,
    status,
    output: content,
    exitCode,
    error,
  } = output;

  if (error) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text color="red">✗ </Text>
          <Text color="red">Task {task_id} error</Text>
        </Box>
        <Box marginTop={1} marginLeft={2}>
          <Text dimColor>{error.slice(0, 500)}</Text>
        </Box>
      </Box>
    );
  }

  if (exitCode !== null && exitCode !== undefined && exitCode !== 0) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text color="yellow">⚠ </Text>
          <Text>
            Task {task_id} exited with code {exitCode}
          </Text>
        </Box>
        {verbose && content ? (
          <Box marginTop={1} marginLeft={2}>
            <Text dimColor>{content.slice(0, 1000)}</Text>
          </Box>
        ) : null}
      </Box>
    );
  }

  if (verbose && content) {
    const outputLines = content.split('\n');
    const displayLines = outputLines.slice(0, 50);

    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text color="green">✓ </Text>
          <Text>
            Task [{task_type}] {status}
          </Text>
          <Text dimColor> #{task_id}</Text>
        </Box>
        <Box marginTop={1} marginLeft={2} flexDirection="column">
          {displayLines.map((line, i) => (
            <Text key={i} dimColor>
              {line || ' '}
            </Text>
          ))}
          {outputLines.length > 50 ? (
            <Text dimColor>… ({outputLines.length - 50} more lines)</Text>
          ) : null}
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="row">
      <Text color="green">✓ </Text>
      <Text>
        Task [{task_type}] {status}
      </Text>
      <Text dimColor> #{task_id}</Text>
      {exitCode === 0 ? <Text dimColor> (exit 0)</Text> : null}
    </Box>
  );
}

export function renderToolUseProgressMessage(
  data: Partial<{ status: string; message: string }>
): React.ReactNode {
  return (
    <Box flexDirection="row">
      <Text dimColor>Waiting for task output</Text>
      {data.status ? <Text dimColor> [{data.status}]</Text> : null}
      {data.message ? (
        <Text dimColor> — {data.message.slice(0, 60)}</Text>
      ) : null}
    </Box>
  );
}

export function getToolUseSummary(
  input: Partial<{ task_id: string }> | undefined
): string | null {
  if (!input?.task_id) return null;
  return `Output: ${input.task_id}`;
}
