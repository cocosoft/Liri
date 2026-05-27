import { Box, Text } from 'ink';

interface ThinkingData {
  step?: number;
  totalSteps?: number;
  thought?: string;
  original?: string;
  revised?: string;
}

interface ThinkingReflectData {
  thoughts: Array<{ step: number; thought: string; tags: string[] }>;
  count: number;
}

interface ThinkingSummaryData {
  totalSteps: number;
  tags: string[];
  steps: Array<{ step: number; thought: string; tags: string[] }>;
}

export function renderToolUseMessage(
  input: { action?: string; thought?: string },
  _options: { verbose: boolean }
): React.ReactNode {
  const actionLabels: Record<string, string> = {
    think: '思考',
    reflect: '回顾',
    summarize: '总结',
    revise: '修正',
  };

  const label = actionLabels[input.action || ''] || input.action;
  const thoughtPreview = (input.thought || '').slice(0, 100);
  return (
    <Text dimColor>
      {label}
      {thoughtPreview
        ? `: ${thoughtPreview}${thoughtPreview.length < (input.thought || '').length ? '...' : ''}`
        : '...'}
    </Text>
  );
}

export function renderToolResultMessage(
  output: ThinkingData | ThinkingReflectData | ThinkingSummaryData,
  _progressMessages: any[],
  _options: { verbose: boolean }
): React.ReactNode {
  if (!output) return null;

  // Think action: single step added
  if ('step' in output && 'totalSteps' in output && !('thoughts' in output)) {
    const data = output as ThinkingData;
    return (
      <Box flexDirection="column">
        <Box>
          <Text bold>步骤 {data.step}</Text>
          <Text dimColor> / {data.totalSteps}</Text>
        </Box>
      </Box>
    );
  }

  // Reflect action: show all thoughts
  if (
    'thoughts' in output &&
    Array.isArray((output as ThinkingReflectData).thoughts)
  ) {
    const data = output as ThinkingReflectData;
    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text bold>思考过程</Text>
          <Text dimColor> ({data.count} 步)</Text>
        </Box>
        {data.thoughts.map((t) => (
          <Box key={t.step} flexDirection="column" marginBottom={1}>
            <Box>
              <Text bold>#{t.step}</Text>
              {t.tags.length > 0 && (
                <Text dimColor> [{t.tags.join(', ')}]</Text>
              )}
            </Box>
            <Box marginLeft={2}>
              <Text>{t.thought}</Text>
            </Box>
          </Box>
        ))}
      </Box>
    );
  }

  // Summarize action
  if ('totalSteps' in output && 'tags' in output) {
    const data = output as ThinkingSummaryData;
    return (
      <Box flexDirection="column">
        <Box>
          <Text bold>思考总结</Text>
        </Box>
        <Box>
          <Text dimColor>总步骤: </Text>
          <Text>{data.totalSteps}</Text>
        </Box>
        {data.tags.length > 0 && (
          <Box>
            <Text dimColor>标签: </Text>
            <Text>{data.tags.join(', ')}</Text>
          </Box>
        )}
      </Box>
    );
  }

  // Revise action
  if ('original' in output && 'revised' in output) {
    const data = output as ThinkingData;
    return (
      <Box flexDirection="column">
        <Box>
          <Text bold>步骤 {data.step} 已修正</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>原内容: </Text>
          <Text>{(data.original || '').slice(0, 200)}</Text>
        </Box>
        <Box>
          <Text dimColor>修正后: </Text>
          <Text>{(data.revised || '').slice(0, 200)}</Text>
        </Box>
      </Box>
    );
  }

  return null;
}

export function renderToolUseErrorMessage(
  error: string,
  _options: { verbose: boolean }
): React.ReactNode {
  return (
    <Box>
      <Text color="red">思考过程记录失败: {error}</Text>
    </Box>
  );
}
