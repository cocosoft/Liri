//
/**
 * OAuth回调处理组件
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { Input } from '../Input';

interface OAuthCallbackHandlerProps {
  onSubmit: (authCode: string) => void;
  onCancel: () => void;
  authUrl: string;
}

export const OAuthCallbackHandler: React.FC<OAuthCallbackHandlerProps> = ({
  onSubmit,
  onCancel,
  authUrl,
}) => {
  const [authCode, setAuthCode] = useState('');

  useInput((input) => {
    if (input === 'escape') {
      onCancel();
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>OAuth Authorization</Text>
      <Box marginTop={1} flexDirection="column">
        <Text>Please open the following URL in your browser:</Text>
        <Text color="cyan">{authUrl}</Text>
        <Box marginTop={1}>
          <Text>After authorization, enter the authorization code:</Text>
        </Box>
        <Input
          value={authCode}
          onChange={setAuthCode}
          onSubmit={() => {
            if (authCode) onSubmit(authCode);
          }}
          placeholder="Enter authorization code..."
        />
      </Box>
      <Box marginTop={1}>
        <Text color="yellow">Press ESC to cancel</Text>
      </Box>
    </Box>
  );
};
