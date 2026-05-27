//
/**
 * OAuth状态指示器组件
 */

import React from 'react';
import { Box, Text } from 'ink';

interface OAuthStatusIndicatorProps {
  status: 'authenticated' | 'unauthenticated' | 'refreshing' | 'error';
  serverName?: string;
  expiresIn?: number;
}

export const OAuthStatusIndicator: React.FC<OAuthStatusIndicatorProps> = ({
  status,
  serverName,
  expiresIn,
}) => {
  const getStatusIcon = () => {
    switch (status) {
      case 'authenticated':
        return '✓';
      case 'unauthenticated':
        return '○';
      case 'refreshing':
        return '⟳';
      case 'error':
        return '✗';
      default:
        return '?';
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case 'authenticated':
        return 'green';
      case 'unauthenticated':
        return 'yellow';
      case 'refreshing':
        return 'cyan';
      case 'error':
        return 'red';
      default:
        return 'white';
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'authenticated':
        return 'Authenticated';
      case 'unauthenticated':
        return 'Not authenticated';
      case 'refreshing':
        return 'Refreshing token...';
      case 'error':
        return 'Authentication error';
      default:
        return 'Unknown';
    }
  };

  const formatExpiresIn = (ms: number): string => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  };

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={getStatusColor()}>{getStatusIcon()}</Text>
        {serverName && <Text> {serverName}</Text>}
        <Text> {getStatusText()}</Text>
      </Box>
      {expiresIn !== undefined && status === 'authenticated' && (
        <Box marginLeft={2}>
          <Text color="gray">Expires in: {formatExpiresIn(expiresIn)}</Text>
        </Box>
      )}
    </Box>
  );
};
