// import React from 'react'
import { Box, Text } from '@modules/ink';

export type ReadMcpResourceOutput = {
  contents: Array<{
    uri: string;
    mimeType?: string;
    text?: string;
    blobSavedTo?: string;
  }>;
};

export function renderToolUseMessage(
  input: Partial<{ server: string; uri: string }>,
  _options: { verbose: boolean }
): React.ReactNode {
  const { server, uri } = input;
  return (
    <Text dimColor>
      读取MCP资源: {uri} ({server})
    </Text>
  );
}

export function renderToolResultMessage(
  output: ReadMcpResourceOutput,
  _progressMessages: any[],
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const { contents } = output;

  if (!contents || contents.length === 0) {
    return <Text color="yellow">MCP资源为空</Text>;
  }

  return (
    <Box flexDirection="column">
      <Text color="green">✓ {contents.length} 个资源</Text>
      {contents.map((c, i) => (
        <Box key={i} marginTop={1} marginLeft={2} flexDirection="column">
          <Text dimColor>{c.uri}</Text>
          {c.mimeType ? <Text dimColor> [{c.mimeType}]</Text> : null}
          {verbose && c.text ? (
            <Box marginTop={1}>
              <Text dimColor>{c.text.slice(0, 500)}</Text>
            </Box>
          ) : null}
          {c.blobSavedTo ? (
            <Box marginTop={1}>
              <Text dimColor>二进制文件已保存: {c.blobSavedTo}</Text>
            </Box>
          ) : null}
        </Box>
      ))}
    </Box>
  );
}

export function renderToolUseErrorMessage(
  error: string,
  _options: { verbose: boolean }
): React.ReactNode {
  return <Text color="red">MCP资源读取失败: {error}</Text>;
}

export function getToolUseSummary(
  input: Partial<{ server: string; uri: string }> | undefined
): string | null {
  if (!input?.uri) return null;
  return `MCP: ${input.uri}`;
}
