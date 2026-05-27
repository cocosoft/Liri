// import React from 'react'
import { Box, Text } from 'ink';

export type BashOutput = {
  command?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  description?: string;
};

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
          <Text dimColor>... ({lines.length - 20} more lines)</Text>
        ) : null}
      </Box>
    );
  }

  if (stdout) {
    const firstLine = stdout.split('\n')[0] || '';
    return <Text>{firstLine.slice(0, 200)}</Text>;
  }

  return <Text dimColor>Command completed</Text>;
}

export function renderToolUseProgressMessage(): React.ReactNode {
  return <Text dimColor>Running...</Text>;
}

export function getToolUseSummary(
  input: Partial<{ command: string; description: string }> | undefined
): string | null {
  if (!input?.command) return null;
  return input.description || input.command.slice(0, 80);
}
