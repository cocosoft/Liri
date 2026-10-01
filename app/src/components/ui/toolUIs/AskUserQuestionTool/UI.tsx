// import React from 'react'
import { Box, Text } from '@modules/ink';

export type AskUserQuestionOutput = {
  questionId: string;
  question: string;
  answers: string[];
  timestamp: number;
};

export function renderToolUseMessage(
  input: Partial<{ question: string; header: string }>,
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const { question, header } = input;

  if (verbose && question) {
    return (
      <Box flexDirection="row">
        <Text bold color="cyan">
          [{header}]
        </Text>
        <Text> {question}</Text>
      </Box>
    );
  }

  return <Text dimColor>询问用户...</Text>;
}

export function renderToolResultMessage(
  output: AskUserQuestionOutput,
  _progressMessages: any[],
  { verbose }: { verbose: boolean }
): React.ReactNode {
  const { question, answers } = output;

  if (verbose) {
    return (
      <Box flexDirection="column">
        <Text bold>用户问题:</Text>
        <Text> {question}</Text>
        <Box marginTop={1} flexDirection="column">
          <Text bold>可用选项:</Text>
          {answers.map((answer, i) => (
            <Text key={i} dimColor>
              {' '}
              ({i + 1}) {answer}
            </Text>
          ))}
        </Box>
      </Box>
    );
  }

  return (
    <Text>
      <Text bold>{answers.length}</Text> 个选项等待用户选择
    </Text>
  );
}

export function renderToolUseErrorMessage(
  error: string,
  _options: { verbose: boolean }
): React.ReactNode {
  return <Text color="red">提问失败: {error}</Text>;
}

export function getToolUseSummary(
  input: Partial<{ question: string }> | undefined
): string | null {
  if (!input?.question) return null;
  return `Ask: ${input.question.slice(0, 60)}`;
}
