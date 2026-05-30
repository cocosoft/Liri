/**
 * EmptyState组件 - 空状态占位
 */

import React from 'react';
import { Text, Box } from '../ink.js';

export type EmptyStateVariant = 'default' | 'search' | 'error' | 'loading';

export interface EmptyStateProps {
  icon?: string;
  title?: string;
  description?: string;
  variant?: EmptyStateVariant;
  action?: string;
}

const VARIANT_CONFIG: Record<
  EmptyStateVariant,
  { icon: string; color: string }
> = {
  default: { icon: '📭', color: 'gray' },
  search: { icon: '🔍', color: 'yellow' },
  error: { icon: '⚠', color: 'red' },
  loading: { icon: '⏳', color: 'cyan' },
};

export function EmptyState({
  icon,
  title,
  description,
  variant = 'default',
  action,
}: EmptyStateProps): React.ReactNode {
  const config = VARIANT_CONFIG[variant];
  const displayIcon = icon || config.icon;

  return (
    <Box flexDirection="column" alignItems="center">
      <Box marginBottom={1}>
        <Text color={config.color} dimColor>
          {displayIcon}
        </Text>
      </Box>
      {title && (
        <Box marginBottom={description ? 1 : 0}>
          <Text color={config.color} dimColor>
            {title}
          </Text>
        </Box>
      )}
      {description && (
        <Box marginBottom={action ? 1 : 0}>
          <Text dimColor>{description}</Text>
        </Box>
      )}
      {action && (
        <Box>
          <Text color="cyan" dimColor>
            {action}
          </Text>
        </Box>
      )}
    </Box>
  );
}
