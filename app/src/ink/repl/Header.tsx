import React, { useState, useEffect } from 'react';
import { Box, Text } from '../../ink';
import type { ChatManager } from '@modules/chat/ChatManager';

interface HeaderProps {
  chatManager: ChatManager;
  messageCount: number;
}

export const Header: React.FC<HeaderProps> = ({
  chatManager,
  messageCount,
}) => {
  const [sessionTitle, setSessionTitle] = useState('');

  useEffect(() => {
    const session = chatManager.getCurrentSession();
    if (session) {
      setSessionTitle(session.title || session.id.slice(0, 8));
    }
  }, [chatManager, messageCount]);

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="blue"
      paddingX={1}
    >
      <Box flexDirection="row" justifyContent="space-between">
        <Text color="cyan" bold>
          Liri
        </Text>
        <Text dimColor>
          {sessionTitle} | {messageCount} msgs
        </Text>
      </Box>
    </Box>
  );
};
