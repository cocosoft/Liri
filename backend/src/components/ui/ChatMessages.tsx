import React, { useRef, useEffect, useMemo } from 'react';
import { Box, Text } from '../ink.js';
import {
  ChatMessage,
  createChatMessage,
  type ChatMessageProps,
  type MessageSender,
  type ToolCallInfo,
  type ToolResultInfo,
} from './ChatMessage.js';
import { LoadingDots } from './LoadingDots.js';

export interface ChatMessageData {
  id: string;
  content: string;
  sender: MessageSender;
  timestamp?: Date;
  type?: 'text' | 'markdown';
  isLoading?: boolean;
  toolCall?: ToolCallInfo;
  toolResult?: ToolResultInfo;
}

export interface ChatMessagesProps {
  messages: ChatMessageData[];
  isLoading?: boolean;
  emptyText?: string;
  maxVisible?: number;
  verbose?: boolean;
  showTimestamps?: boolean;
}

export function ChatMessages({
  messages,
  isLoading = false,
  emptyText = 'No messages yet',
  maxVisible,
  verbose = false,
  showTimestamps = true,
}: ChatMessagesProps): React.ReactNode {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const displayMessages = useMemo(
    () => (maxVisible ? messages.slice(-maxVisible) : messages),
    [messages, maxVisible]
  );

  if (displayMessages.length === 0 && !isLoading) {
    return (
      <Box flexDirection="column" alignItems="center" marginTop={2}>
        <Text dimColor>{emptyText}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      {displayMessages.map((msg, index) => {
        const messageKey =
          msg.id && msg.id.length > 0
            ? msg.id
            : `${msg.sender}-${msg.timestamp?.getTime() ?? index}-${index}`;

        return (
          <Box key={messageKey} flexDirection="column">
            {createChatMessage({
              content: msg.content,
              sender: msg.sender,
              timestamp: showTimestamps ? msg.timestamp : undefined,
              type: msg.type,
              isLoading: msg.isLoading,
              toolCall: msg.toolCall,
              toolResult: msg.toolResult,
              verbose,
            })}
          </Box>
        );
      })}

      {isLoading && displayMessages.length > 0 && (
        <Box marginTop={1} marginLeft={2}>
          <LoadingDots />
        </Box>
      )}
    </Box>
  );
}

export function createChatMessages(
  props: ChatMessagesProps
): React.ReactElement {
  return React.createElement(ChatMessages, props);
}

export default ChatMessages;
