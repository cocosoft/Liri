/**
 * Bash 工具 UI 组件
 */

import React from 'react';
import { Box, Text } from 'ink';

export interface BashOutput {
  command?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  description?: string;
}

export function renderToolUseMessage(
  input: Partial<{ command: string; description: string }>,
  _options: { verbose: boolean }
): React.ReactNode {
  const { command, description } = input;
  if (!command) return null;

  const label = description || command;
  const display = label.length > 100 ? label.slice(0, 97) + '...' : label;
  return <Text dimColor>{display}</Text>;
}

export function renderToolResultMessage(
  output: BashOutput,
  _progressMessages: any[],
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const { exitCode, stdout, stderr } = output;

  if (exitCode !== undefined && exitCode !== 0) {
    return (
      <Box flexDirection="column">
        <Text color="red">Exit code: {exitCode}</Text>
        {stderr ? (
          <Box marginTop={1}>
            <Text dimColor>{stderr.slice(0, 500)}</Text>
          </Box>
        ) : null}
      </Box>
    );
  }

  if (verbose && stdout) {
    const lines = stdout.split('\n');
    const preview = lines.slice(0, 20).join('\n');
    const truncated = lines.length > 20;
    return (
      <Box flexDirection="column">
        <Text>{preview}</Text>
        {truncated ? (
          <Box marginTop={1}>
            <Text dimColor>... ({lines.length - 20} more lines)</Text>
          </Box>
        ) : null}
      </Box>
    );
  }

  if (stdout && stdout.length > 200) {
    return <Text dimColor>{stdout.slice(0, 200)}...</Text>;
  }

  return stdout ? <Text>{stdout}</Text> : null;
}
