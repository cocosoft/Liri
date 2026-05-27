// import React from 'react'
import { Box, Text } from 'ink';

export type TaskOutput = {
  taskId?: string;
  taskType?: string;
  description?: string;
  status?: string;
  result?: string;
  error?: string;
};

export function renderToolUseMessage(
  input: Partial<{ description: string; task_type: string }>,
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const { description, task_type } = input;
  const label = task_type || 'task';

  if (verbose && description) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text dimColor>{label}: </Text>
          <Text bold>{description.slice(0, 80)}</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="row">
      <Text dimColor>Task: </Text>
      <Text bold>{description?.slice(0, 60) || label}</Text>
    </Box>
  );
}

export function renderToolResultMessage(
  output: TaskOutput,
  _progressMessages: any[],
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const { taskId, taskType, status, result, error } = output;

  if (error) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text color="red">✗ Task failed</Text>
          {taskId ? <Text dimColor> [{taskId}]</Text> : null}
        </Box>
        <Box marginTop={1} marginLeft={2}>
          <Text color="red">{error.slice(0, 300)}</Text>
        </Box>
      </Box>
    );
  }

  if (verbose && result) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text color="green">✓ Task {status || 'completed'}</Text>
          {taskType ? <Text dimColor> [{taskType}]</Text> : null}
          {taskId ? <Text dimColor> #{taskId}</Text> : null}
        </Box>
        <Box marginTop={1} marginLeft={2}>
          <Text dimColor>{result.slice(0, 500)}</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="row">
      <Text color="green">✓ </Text>
      <Text>Task {status || 'completed'}</Text>
      {taskId ? <Text dimColor> [{taskId}]</Text> : null}
    </Box>
  );
}

export function renderToolUseProgressMessage(
  data: Partial<{ message: string; progress: number }>
): React.ReactNode {
  return (
    <Box flexDirection="row">
      <Text dimColor>Task running</Text>
      {data.progress !== undefined ? (
        <Text dimColor> [{Math.round(data.progress * 100)}%]</Text>
      ) : null}
    </Box>
  );
}

export function getToolUseSummary(
  input: Partial<{ description: string; task_type: string }> | undefined
): string | null {
  if (!input?.description) return null;
  return input.description.slice(0, 60);
}
