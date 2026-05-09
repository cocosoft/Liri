/**
 * Alert组件 - 警告提示
 */

import React from 'react';
import { Text, Box } from '../ink.js';

type AlertType = 'info' | 'success' | 'warning' | 'error';

export interface AlertProps {
  type?: AlertType;
  title?: string;
  message: string;
  showIcon?: boolean;
}

const ALERT_CONFIG: Record<
  AlertType,
  { icon: string; color: string; label: string }
> = {
  info: { icon: 'ℹ', color: 'cyan', label: 'INFO' },
  success: { icon: '✓', color: 'green', label: 'SUCCESS' },
  warning: { icon: '⚠', color: 'yellow', label: 'WARNING' },
  error: { icon: '✗', color: 'red', label: 'ERROR' },
};

export function Alert({
  type = 'info',
  title,
  message,
  showIcon = true,
}: AlertProps): React.ReactNode {
  const config = ALERT_CONFIG[type];

  return (
    <Box flexDirection="column">
      <Box>
        {showIcon && (
          <Text color={config.color} bold>
            {config.icon}{' '}
          </Text>
        )}
        <Text color={config.color} bold>
          [{config.label}]
        </Text>
        {title && <Text color={config.color}> {title}</Text>}
      </Box>
      <Box marginLeft={showIcon ? 2 : 0}>
        <Text>{message}</Text>
      </Box>
    </Box>
  );
}
