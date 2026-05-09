//
/**
 * OAuth登录对话框组件
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Button } from '../Button';

interface OAuthLoginDialogProps {
  onLogin: (mode: 'automatic' | 'manual') => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export const OAuthLoginDialog: React.FC<OAuthLoginDialogProps> = ({
  onLogin,
  onCancel,
  isLoading = false,
}) => {
  const [selectedMode, setSelectedMode] = useState<'automatic' | 'manual'>('automatic');

  useInput((input) => {
    if (input === 'escape') {
      onCancel();
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>OAuth Login</Text>
      <Box marginTop={1} flexDirection="column">
        <Text>Select login mode:</Text>
        <Box marginTop={1} flexDirection="column">
          <Button
            variant={selectedMode === 'automatic' ? 'primary' : 'outline'}
            onPress={() => setSelectedMode('automatic')}
          >
            Automatic (Browser)
          </Button>
          <Button
            variant={selectedMode === 'manual' ? 'primary' : 'outline'}
            onPress={() => setSelectedMode('manual')}
          >
            Manual (Copy URL)
          </Button>
        </Box>
      </Box>
      <Box marginTop={2}>
        <Button
          onPress={() => onLogin(selectedMode)}
          disabled={isLoading}
        >
          {isLoading ? 'Loading...' : 'Login'}
        </Button>
        <Box marginLeft={1}>
          <Button onPress={onCancel}>Cancel</Button>
        </Box>
      </Box>
    </Box>
  );
};
