import React from 'react';
import { Box, Text } from '../../ink';
import { MarkdownRenderer } from '../../components/ui/markdown';
import type { DisplayMessage } from './types';

interface MessageBubbleProps {
  message: DisplayMessage;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const isAssistant = message.role === 'assistant';

  return (
    <Box flexDirection="column" marginBottom={1} paddingX={2}>
      <Box flexDirection="row">
        <Text color={isUser ? 'cyan' : isSystem ? 'yellow' : 'green'} bold>
          {isUser ? 'You: ' : isSystem ? 'System: ' : 'AI: '}
        </Text>
      </Box>
      <Box flexDirection="row" paddingLeft={2}>
        {isAssistant ? (
          <Box flexDirection="column">
            <MarkdownRenderer content={message.content} />
          </Box>
        ) : (
          <Text>{message.content}</Text>
        )}
      </Box>
    </Box>
  );
};
