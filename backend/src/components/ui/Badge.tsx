/**
 * Badge组件 - 徽章
 */

import React from 'react';
import { Text, Box } from '../ink.js';

type BadgeVariant = 'info' | 'success' | 'warning' | 'error' | 'default';

interface BadgeProps {
  text: string;
  variant?: BadgeVariant;
}

const VARIANT_COLORS: Record<BadgeVariant, string> = {
  info: 'cyan',
  success: 'green',
  warning: 'yellow',
  error: 'red',
  default: 'white',
};

export function Badge({ text, variant = 'default' }: BadgeProps): React.ReactNode {
  const color = VARIANT_COLORS[variant];

  return (
    <Box>
      <Text color={color} bold>
        [{text}]
      </Text>
    </Box>
  );
}
