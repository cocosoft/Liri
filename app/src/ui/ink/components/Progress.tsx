//
/**
 * Ink Progress组件
 * 用于显示进度条
 */

import React from 'react';
import { Box, Text } from '@modules/ink';

export interface ProgressProps {
  value: number;
  total?: number;
  label?: string;
  barColor?: string;
  width?: number;
}

export const Progress: React.FC<ProgressProps> = ({
  value,
  total = 100,
  label,
  barColor = 'green',
  width = 20,
}) => {
  const percentage = Math.min(100, Math.max(0, (value / total) * 100));
  const filledWidth = Math.floor((percentage / 100) * width);
  const emptyWidth = width - filledWidth;

  return (
    <Box flexDirection="column">
      {label && <Text>{label}</Text>}
      <Box flexDirection="row">
        <Text color={barColor as any}>{'='.repeat(filledWidth)}</Text>
        <Text color={'gray' as any}>{'-'.repeat(emptyWidth)}</Text>
        <Text color={'gray' as any}>{Math.round(percentage)}%</Text>
      </Box>
    </Box>
  );
};
