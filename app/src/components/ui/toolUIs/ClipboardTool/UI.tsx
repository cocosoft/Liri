import { Box, Text } from '@modules/ink';

// 2026-10-01 子批 A：UI 组件由 `tools/` 归位到 ui 层（`components/ui/toolUIs/`）⇒ 原
// 相对导入改为经**模块规范子入口** `@modules/tools/types` 取工具输出类型（ui -> app 合法；
// `types` 段对 R03-002 豁免，不能直插 `tools/<Tool>/<Tool>` 子目录）。
import type { ClipboardOutput } from '@modules/tools/types';

export function renderToolUseMessage(
  input: { action?: string; content?: string },
  _options: { verbose: boolean }
): React.ReactNode {
  if (input.action === 'write') {
    const preview = (input.content || '').slice(0, 80);
    return (
      <Text dimColor>
        写入剪贴板: {preview}
        {preview.length < (input.content || '').length ? '...' : ''}
      </Text>
    );
  }
  return <Text dimColor>读取剪贴板...</Text>;
}

export function renderToolResultMessage(
  output: ClipboardOutput,
  _progressMessages: any[],
  options: { verbose: boolean }
): React.ReactNode {
  if (output.action === 'read') {
    const preview = output.content.slice(
      0,
      options.verbose ? output.content.length : 200
    );
    return (
      <Box flexDirection="column">
        <Box>
          <Text bold>剪贴板</Text>
          <Text dimColor>
            {' '}
            ({output.length} 字符{output.truncated ? ', 已截断' : ''})
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text>
            {preview}
            {output.truncated && !options.verbose ? '\n...' : ''}
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box>
      <Text dimColor>已写入剪贴板</Text>
      <Text> ({output.length} 字符)</Text>
    </Box>
  );
}

export function renderToolUseErrorMessage(
  error: string,
  _options: { verbose: boolean }
): React.ReactNode {
  return (
    <Box>
      <Text color="red">剪贴板操作失败: {error}</Text>
    </Box>
  );
}

export function getToolUseSummary(
  input: { action?: string; content?: string } | undefined
): string | null {
  if (!input?.action) return null;
  if (input.action === 'write') {
    const preview = (input.content || '').slice(0, 40);
    return `写入剪贴板: ${preview}${preview.length < (input.content || '').length ? '...' : ''}`;
  }
  return '读取剪贴板';
}
