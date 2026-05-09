// import React from 'react'
import { Box, Text } from 'ink';

export type CodeAnalysisOutput = {
  analysis: {
    type: string;
    stats: Record<string, any>;
    details?: any;
  };
  filesAnalyzed: number;
  analysisTime: number;
};

export function renderToolUseMessage(
  input: Partial<{ target: string; analysisType: string }>,
  _options: { verbose: boolean }
): React.ReactNode {
  const { target, analysisType } = input;
  return (
    <Text dimColor>
      分析代码: {analysisType} @ {target}
    </Text>
  );
}

export function renderToolResultMessage(
  output: CodeAnalysisOutput,
  _progressMessages: any[],
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const { analysis, filesAnalyzed, analysisTime } = output;

  if (verbose) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Text color="green">✓ </Text>
          <Text>{analysis.type} 分析完成</Text>
        </Box>
        <Box marginTop={1} marginLeft={2}>
          <Text dimColor>文件数: {filesAnalyzed}</Text>
        </Box>
        <Box marginLeft={2}>
          <Text dimColor>耗时: {analysisTime}ms</Text>
        </Box>
        {analysis.details && (
          <Box marginTop={1} marginLeft={2}>
            <Text dimColor>
              {JSON.stringify(analysis.details).slice(0, 200)}
            </Text>
          </Box>
        )}
      </Box>
    );
  }

  return (
    <Box flexDirection="row">
      <Text color="green">✓ </Text>
      <Text dimColor>
        {analysis.type} ({filesAnalyzed} files, {analysisTime}ms)
      </Text>
    </Box>
  );
}

export function getToolUseSummary(
  input: Partial<{ target: string; analysisType: string }> | undefined
): string | null {
  if (!input?.target) return null;
  return `${input.analysisType || 'analyze'}: ${input.target}`;
}
