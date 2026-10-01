// import React from 'react'
import { Box, Text } from '@modules/ink';

export type ToolSearchOutput = {
  matches: string[];
  query: string;
  total_deferred_tools: number;
  deferredToolNames: string[];
};

export function renderToolUseMessage(
  input: Partial<{ query: string }>,
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const { query } = input;

  if (verbose && query) {
    return (
      <Box flexDirection="row">
        <Text dimColor>搜索延迟加载工具: </Text>
        <Text bold>{query}</Text>
      </Box>
    );
  }

  return <Text dimColor>搜索工具...</Text>;
}

export function renderToolResultMessage(
  output: ToolSearchOutput,
  _progressMessages: any[],
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const { matches, query, total_deferred_tools, deferredToolNames } = output;

  if (matches.length === 0) {
    // G4：空结果时列出可用延迟工具，区分「关键词未命中」与「工具确实不存在」
    return (
      <Box flexDirection="column">
        <Text>
          <Text color="yellow">未找到</Text>匹配工具 (共 {total_deferred_tools}{' '}
          个延迟工具)
          {deferredToolNames.length > 0 ? ': ' : ''}
        </Text>
        {verbose && deferredToolNames.length > 0 && (
          <Box marginLeft={2}>
            <Text dimColor>{deferredToolNames.join(', ')}</Text>
          </Box>
        )}
      </Box>
    );
  }

  if (verbose) {
    return (
      <Box flexDirection="column">
        <Text>
          搜索 "<Text italic>{query}</Text>" 找到{' '}
          <Text bold>{matches.length}</Text> 个匹配工具
        </Text>
        <Box marginTop={1} marginLeft={2} flexDirection="column">
          {matches.map((name, i) => (
            <Text key={i}>
              <Text color="cyan">{i + 1}.</Text> {name}
            </Text>
          ))}
        </Box>
      </Box>
    );
  }

  return (
    <Text>
      找到 <Text bold>{matches.length}</Text> 个匹配工具 (共{' '}
      {total_deferred_tools} 个延迟工具)
    </Text>
  );
}

export function renderToolUseErrorMessage(
  error: string,
  _options: { verbose: boolean }
): React.ReactNode {
  return <Text color="red">工具搜索失败: {error}</Text>;
}

export function getToolUseSummary(
  input: Partial<{ query: string }> | undefined
): string | null {
  if (!input?.query) return null;
  return `Search tools: ${input.query.slice(0, 60)}`;
}
