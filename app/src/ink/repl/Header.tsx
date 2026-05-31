import React, { useState, useEffect } from 'react';
import { Box, Text } from '../../ink';
import type { ChatManager } from '@modules/chat/ChatManager';
import {
  getTotalInputTokens,
  getTotalOutputTokens,
  getTotalCacheReadInputTokens,
  getTotalCacheCreationInputTokens,
  getTotalCostUSD,
} from '@modules/cost/CostTracker.js';

interface HeaderProps {
  chatManager: ChatManager;
  messageCount: number;
}

function formatCount(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export const Header: React.FC<HeaderProps> = ({
  chatManager,
  messageCount,
}) => {
  const [sessionTitle, setSessionTitle] = useState('');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const session = chatManager.getCurrentSession();
    if (session) {
      setSessionTitle(session.title || session.id.slice(0, 8));
    }
  }, [chatManager, messageCount]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const totalInput = getTotalInputTokens();
  const totalOutput = getTotalOutputTokens();
  const totalCacheRead = getTotalCacheReadInputTokens();
  const totalCacheCreation = getTotalCacheCreationInputTokens();
  const totalCost = getTotalCostUSD();

  const showSessionStats = totalInput > 0 || totalOutput > 0;

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
      {showSessionStats && (
        <Box flexDirection="row" gap={1}>
          <Text color="gray" dimColor>In:</Text>
          <Text color="blue">{formatCount(totalInput)}</Text>
          <Text color="gray" dimColor>Out:</Text>
          <Text color="green">{formatCount(totalOutput)}</Text>
          {totalCacheRead > 0 && (
            <>
              <Text color="gray" dimColor>CR:</Text>
              <Text color="cyan">{formatCount(totalCacheRead)}</Text>
            </>
          )}
          {totalCacheCreation > 0 && (
            <>
              <Text color="gray" dimColor>CW:</Text>
              <Text color="yellow">{formatCount(totalCacheCreation)}</Text>
            </>
          )}
          <Text color="gray" dimColor>Cost:</Text>
          <Text color="red">${totalCost.toFixed(4)}</Text>
        </Box>
      )}
    </Box>
  );
};
