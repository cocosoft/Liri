/**
 * Divider组件 - 分隔线
 */

import React from 'react';
import { Text } from '../ink.js';

interface DividerProps {
  char?: string;
  color?: string;
  width?: number;
}

export function Divider({ char = '─', color = 'gray', width = 50 }: DividerProps): React.ReactNode {
  return <Text color={color}>{char.repeat(width)}</Text>;
}
