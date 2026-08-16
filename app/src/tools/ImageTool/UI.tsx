import { Box, Text } from '@modules/ink';

import type { ImageEditOutput } from './ImageTool';

export function renderToolUseMessage(
  input: { action?: string; inputPath?: string },
  _options: { verbose: boolean }
): React.ReactNode {
  const actionLabels: Record<string, string> = {
    resize: '调整大小',
    convert: '格式转换',
    info: '查看信息',
    grayscale: '灰度化',
  };

  const label = actionLabels[input.action || ''] || input.action;
  return (
    <Text dimColor>
      {label}: {input.inputPath || ''}
    </Text>
  );
}

export function renderToolResultMessage(
  output: ImageEditOutput,
  _progressMessages: any[],
  _options: { verbose: boolean }
): React.ReactNode {
  if (!output) return null;

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>图片操作: </Text>
        <Text>{output.action}</Text>
      </Box>

      <Box>
        <Text dimColor>输入: </Text>
        <Text>{output.inputPath}</Text>
      </Box>

      {output.outputPath && (
        <Box>
          <Text dimColor>输出: </Text>
          <Text>{output.outputPath}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        {output.width && output.height && (
          <Text>
            尺寸: {output.width}×{output.height}
            &nbsp;
          </Text>
        )}
        {output.aspectRatio && (
          <Text dimColor>比例: {output.aspectRatio.toFixed(2)}</Text>
        )}
      </Box>

      {output.format && (
        <Box>
          <Text dimColor>格式: </Text>
          <Text>{output.format}</Text>
        </Box>
      )}

      {output.originalSize !== undefined &&
        output.processedSize !== undefined && (
          <Box>
            <Text dimColor>大小: </Text>
            <Text>
              {(output.originalSize / 1024).toFixed(1)}KB →{' '}
              {(output.processedSize / 1024).toFixed(1)}KB
            </Text>
          </Box>
        )}
    </Box>
  );
}

export function renderToolUseErrorMessage(
  error: string,
  _options: { verbose: boolean }
): React.ReactNode {
  return (
    <Box>
      <Text color="red">图片操作失败: {error}</Text>
    </Box>
  );
}

export function getToolUseSummary(
  input: { action?: string; inputPath?: string } | undefined
): string | null {
  if (!input?.action) return null;
  const actionLabels: Record<string, string> = {
    resize: '调整大小',
    convert: '格式转换',
    info: '查看信息',
    grayscale: '灰度化',
  };
  const label = actionLabels[input.action] || input.action;
  return `${label}: ${input.inputPath || ''}`;
}
