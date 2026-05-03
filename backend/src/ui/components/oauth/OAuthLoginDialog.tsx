// @ts-nocheck
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
            label="Automatic (Browser)"
            selected={selectedMode === 'automatic'}
            onClick={() => setSelectedMode('automatic')}
          />
          <Button
            label="Manual (Copy URL)"
            selected={selectedMode === 'manual'}
            onClick={() => setSelectedMode('manual')}
          />
        </Box>
      </Box>
      <Box marginTop={2}>
        <Button
          label={isLoading ? 'Loading...' : 'Login'}
          onClick={() => onLogin(selectedMode)}
          disabled={isLoading}
        />
        <Box marginLeft={1}>
          <Button label="Cancel" onClick={onCancel} />
        </Box>
      </Box>
    </Box>
  );
};
