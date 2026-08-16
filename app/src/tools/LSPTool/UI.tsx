// import React from 'react'
import { Box, Text } from '@modules/ink';

export type LSPOutput = {
  symbolName?: string;
  symbolKind?: string;
  filePath?: string;
  references?: Array<{
    file: string;
    line: number;
    column: number;
    text: string;
  }>;
  definition?: { file: string; line: number; text: string };
  result?: string;
};

export function renderToolUseMessage(
  input: Partial<{ operation: string; symbol: string; file_path: string }>,
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const { operation, symbol, file_path } = input;

  if (verbose) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text dimColor>LSP {operation || 'query'}: </Text>
          <Text bold>{symbol || '?'}</Text>
        </Box>
        {file_path ? (
          <Box marginTop={1} marginLeft={2}>
            <Text dimColor>{file_path}</Text>
          </Box>
        ) : null}
      </Box>
    );
  }

  return (
    <Box flexDirection="row">
      <Text dimColor>LSP: </Text>
      <Text bold>{symbol || operation || 'query'}</Text>
    </Box>
  );
}

export function renderToolResultMessage(
  output: LSPOutput,
  _progressMessages: any[],
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const { symbolName, symbolKind, filePath, references, definition, result } =
    output;

  if (result) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text color="green">✓ </Text>
          <Text bold>{symbolName || ''}</Text>
          {symbolKind ? <Text dimColor> [{symbolKind}]</Text> : null}
        </Box>
        <Box marginTop={1} marginLeft={2}>
          <Text dimColor>{result.slice(0, 300)}</Text>
        </Box>
      </Box>
    );
  }

  if (verbose && references && references.length > 0) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text color="green">✓ </Text>
          <Text bold>{symbolName || 'symbol'}</Text>
          {symbolKind ? <Text dimColor> [{symbolKind}]</Text> : null}
          <Text dimColor>
            {' '}
            — {references.length} reference{references.length !== 1 ? 's' : ''}
          </Text>
        </Box>
        <Box marginTop={1} marginLeft={2} flexDirection="column">
          {references.slice(0, 8).map((ref, i) => (
            <Box key={i} flexDirection="row">
              <Text dimColor>
                {ref.file}:{ref.line}
              </Text>
              {ref.text ? <Text> {ref.text.slice(0, 60)}</Text> : null}
            </Box>
          ))}
        </Box>
      </Box>
    );
  }

  if (verbose && definition) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text color="green">✓ </Text>
          <Text bold>{symbolName || 'symbol'}</Text>
          {symbolKind ? <Text dimColor> [{symbolKind}]</Text> : null}
        </Box>
        <Box marginTop={1} marginLeft={2}>
          <Text dimColor>
            Defined in {definition.file}:{definition.line}
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="row">
      <Text color="green">✓ </Text>
      <Text>LSP query completed</Text>
    </Box>
  );
}

export function renderToolUseErrorMessage(
  error: string,
  _options: { verbose: boolean }
): React.ReactNode {
  return <Text color="red">LSP查询失败: {error}</Text>;
}

export function getToolUseSummary(
  input: Partial<{ operation: string; symbol: string }> | undefined
): string | null {
  if (!input?.symbol) return null;
  return `LSP ${input.operation || 'query'}: ${input.symbol}`;
}
