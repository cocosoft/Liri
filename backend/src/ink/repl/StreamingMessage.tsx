import React from 'react';
import { Box, Text } from '../../ink';
import { MarkdownRenderer } from '../../components/ui/markdown';

interface StreamingMessageProps {
  content: string;
}

export const StreamingMessage: React.FC<StreamingMessageProps> = ({
  content,
}) => {
  return (
    <Box flexDirection="column" marginBottom={1} paddingX={2}>
      <Box flexDirection="row">
        <Text color="green" bold>
          AI:{' '}
        </Text>
      </Box>
      <Box flexDirection="row" paddingLeft={2}>
        <Box flexDirection="column">
          <MarkdownRenderer content={content} />
        </Box>
        <Text color="green">▊</Text>
      </Box>
    </Box>
  );
};
