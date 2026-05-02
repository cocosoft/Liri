/**
 * MCP认证对话框组件
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Button } from '../Button';
import { Input } from '../Input';

interface MCPAuthDialogProps {
  serverName: string;
  onAuthenticate: (authCode: string) => void;
  onCancel: () => void;
  authUrl?: string;
}

export const MCPAuthDialog: React.FC<MCPAuthDialogProps> = ({
  serverName,
  onAuthenticate,
  onCancel,
  authUrl,
}) => {
  const [authCode, setAuthCode] = useState('');
  const [step, setStep] = useState<'prompt' | 'input' | 'success' | 'error'>('prompt');
  const [errorMessage, setErrorMessage] = useState('');

  useInput((input) => {
    if (input === 'escape') {
      onCancel();
    }
  });

  const handleStartAuth = () => {
    if (authUrl) {
      setStep('input');
    } else {
      setErrorMessage('No auth URL available');
      setStep('error');
    }
  };

  const handleSubmit = () => {
    if (authCode) {
      onAuthenticate(authCode);
      setStep('success');
    }
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>MCP Server Authentication</Text>
      <Box marginTop={1}>
        <Text>Server: {serverName}</Text>
      </Box>

      {step === 'prompt' && (
        <Box flexDirection="column" marginTop={1}>
          <Text>This server requires OAuth authentication.</Text>
          <Button label="Start Authentication" onClick={handleStartAuth} />
        </Box>
      )}

      {step === 'input' && (
        <Box flexDirection="column" marginTop={1}>
          <Text>Opening browser for authentication...</Text>
          <Box marginTop={1}>
            <Text color="cyan">{authUrl}</Text>
          </Box>
          <Box marginTop={1}>
            <Text>Enter authorization code:</Text>
          </Box>
          <Input
            value={authCode}
            onChange={setAuthCode}
            onSubmit={handleSubmit}
            placeholder="Authorization code..."
          />
        </Box>
      )}

      {step === 'success' && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="green">✓ Authentication successful!</Text>
        </Box>
      )}

      {step === 'error' && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="red">✗ Authentication failed: {errorMessage}</Text>
          <Text>Press ESC to cancel or try again</Text>
        </Box>
      )}
    </Box>
  );
};
