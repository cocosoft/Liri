// import React from 'react'
import { Box, Text } from 'ink';

export type NotebookOutput = {
  notebookPath?: string;
  cellId?: string;
  cellType?: string;
  result?: string;
  error?: string;
};

export function renderToolUseMessage(
  input: Partial<{
    notebook_path: string;
    cell_id: string;
    cell_type: string;
    new_source: string;
  }>,
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const { notebook_path, cell_id, cell_type, new_source } = input;
  if (!notebook_path) return null;

  if (verbose) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text dimColor>Notebook: </Text>
          <Text bold>{notebook_path}</Text>
        </Box>
        <Box marginTop={1} marginLeft={2}>
          <Text dimColor>
            Cell {cell_id} [{cell_type}]
          </Text>
        </Box>
        {new_source ? (
          <Box marginTop={1} marginLeft={2}>
            <Text dimColor>{new_source.slice(0, 40)}</Text>
          </Box>
        ) : null}
      </Box>
    );
  }

  return (
    <Box flexDirection="row">
      <Text dimColor>Notebook: </Text>
      <Text bold>{notebook_path}</Text>
    </Box>
  );
}

export function renderToolResultMessage(
  output: NotebookOutput,
  _progressMessages: any[],
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const { notebookPath, cellId, cellType, error, result } = output;

  if (error) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text color="red">
            ✗ {notebookPath || 'notebook'}@{cellId || '?'}
          </Text>
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
          <Text color="green">
            ✓ {notebookPath || 'notebook'}@{cellId || '?'}
          </Text>
          {cellType ? <Text dimColor> [{cellType}]</Text> : null}
        </Box>
        <Box marginTop={1} marginLeft={2}>
          <Text dimColor>{result.slice(0, 300)}</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="row">
      <Text color="green">✓ </Text>
      <Text>{notebookPath || 'notebook'} updated</Text>
    </Box>
  );
}

export function getToolUseSummary(
  input: Partial<{ notebook_path: string; cell_id: string }> | undefined
): string | null {
  if (!input?.notebook_path) return null;
  return input.cell_id
    ? `Notebook: ${input.notebook_path}@${input.cell_id}`
    : `Notebook: ${input.notebook_path}`;
}
