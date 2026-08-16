// import React from 'react'
import { Box, Text } from '@modules/ink';

export type ListMcpResourcesOutput = Array<{
  uri: string;
  name: string;
  mimeType?: string;
  description?: string;
  server: string;
}>;

export function renderToolUseMessage(
  input: Partial<{ server: string }>,
  _options: { verbose: boolean }
): React.ReactNode {
  return (
    <Text dimColor>
      列出MCP资源{input.server ? ` (${input.server})` : ''}...
    </Text>
  );
}

export function renderToolResultMessage(
  output: ListMcpResourcesOutput,
  _progressMessages: any[],
  { verbose }: { verbose: boolean }
): React.ReactNode {
  if (!output || output.length === 0) {
    return (
      <Box flexDirection="row">
        <Text color="yellow">⚠ </Text>
        <Text dimColor>没有可用的MCP资源</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text color="green">✓ </Text>
        <Text>{output.length} 个MCP资源</Text>
      </Box>
      {output.map((r, i) => (
        <Box key={i} marginTop={1} marginLeft={2} flexDirection="column">
          <Box flexDirection="row">
            <Text color="blue">{r.name}</Text>
            <Text dimColor> [{r.server}]</Text>
          </Box>
          {verbose && (
            <>
              <Text dimColor> URI: {r.uri}</Text>
              {r.mimeType ? <Text dimColor> 类型: {r.mimeType}</Text> : null}
              {r.description ? (
                <Text dimColor> 描述: {r.description}</Text>
              ) : null}
            </>
          )}
        </Box>
      ))}
    </Box>
  );
}

export function renderToolUseErrorMessage(
  error: string,
  _options: { verbose: boolean }
): React.ReactNode {
  return <Text color="red">MCP资源列表获取失败: {error}</Text>;
}

export function getToolUseSummary(
  _input: Partial<{ server: string }> | undefined
): string | null {
  return 'MCP Resources';
}
