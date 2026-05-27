// import React from 'react'
import { Box, Text } from 'ink';

export type BrowserOutput = {
  success: boolean;
  message: string;
  data?: any;
  tabs?: any[];
  screenshot?: string;
};

export function renderToolUseMessage(
  input: Partial<{ action: string; url: string }>,
  _options: { verbose: boolean }
): React.ReactNode {
  const { action, url } = input;
  if (action === 'get_tabs') {
    return <Text dimColor>获取标签页列表...</Text>;
  }
  return (
    <Text dimColor>
      浏览器: {action}
      {url ? ` ${url}` : ''}
    </Text>
  );
}

export function renderToolResultMessage(
  output: BrowserOutput,
  _progressMessages: any[],
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const { success, message, tabs, screenshot } = output;

  if (!success) {
    return <Text color="red">浏览器操作失败: {message}</Text>;
  }

  if (tabs) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text color="green">✓ </Text>
          <Text>{tabs.length} 个标签页</Text>
        </Box>
        {verbose &&
          tabs.map((tab, i) => (
            <Box key={i} marginTop={1} marginLeft={2}>
              <Text dimColor>{tab.id || i}: </Text>
              <Text>{tab.url || tab.title || 'unknown'}</Text>
            </Box>
          ))}
      </Box>
    );
  }

  if (screenshot) {
    return (
      <Box flexDirection="row">
        <Text color="green">✓ </Text>
        <Text>截图已获取 ({screenshot.length} chars)</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="row">
      <Text color="green">✓ </Text>
      <Text dimColor>{message}</Text>
    </Box>
  );
}

export function getToolUseSummary(
  input: Partial<{ action: string; url: string }> | undefined
): string | null {
  if (!input?.action) return null;
  return `${input.action}${input.url ? `: ${input.url}` : ''}`;
}
