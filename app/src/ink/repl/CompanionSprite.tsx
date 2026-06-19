import React, { useState, useEffect } from 'react';
import { Box, Text } from '../../ink';
import type { StreamState } from './types';

interface CompanionSpriteProps {
  streamState: StreamState;
  hasContent: boolean;
}

export const CompanionSprite: React.FC<CompanionSpriteProps> = ({
  streamState,
  hasContent,
}) => {
  const [showDone, setShowDone] = useState(false);

  useEffect(() => {
    if (streamState === 'done') {
      setShowDone(true);
      const timer = setTimeout(() => setShowDone(false), 2000);
      return () => clearTimeout(timer);
    }
    if (streamState === 'idle') {
      setShowDone(false);
    }
    return;
  }, [streamState]);

  if (streamState === 'idle' && !showDone) {
    return null;
  }

  if (showDone) {
    return (
      <Box paddingX={2}>
        <Text color="green"> Done</Text>
      </Box>
    );
  }

  if (streamState === 'paused') {
    return (
      <Box paddingX={2}>
        <Text color="yellow"> ⏸ Paused (ESC to resume)</Text>
      </Box>
    );
  }

  if (hasContent) {
    return (
      <Box paddingX={2}>
        <Text color="cyan"> Streaming...</Text>
      </Box>
    );
  }

  return (
    <Box paddingX={2}>
      <Text color="magenta"> Thinking...</Text>
    </Box>
  );
};
