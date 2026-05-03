/**
 * Modal组件 - 模态框
 */

import React from 'react';
import { Text, Box } from '../ink.js';

export interface ModalProps {
  title: string;
  visible: boolean;
  onClose?: () => void;
  children: React.ReactNode;
  width?: number;
  borderColor?: string;
  titleColor?: string;
}

export function Modal({
  title,
  visible,
  onClose,
  children,
  width = 60,
  borderColor = 'cyan',
  titleColor = 'cyan',
}: ModalProps): React.ReactNode {
  if (!visible) return null;

  const border = '─'.repeat(width);
  const padding = 2;
  const innerWidth = width - 4;

  const wrapContent = (content: string): string => {
    const padded = content.padEnd(innerWidth);
    return `│ ${padded} │`;
  };

  return (
    <Box flexDirection="column">
      <Box>
        <Text dimColor>{' '.repeat(2)}</Text>
        <Text color={borderColor}>┌{border}┐</Text>
      </Box>
      <Box>
        <Text dimColor>{' '.repeat(2)}</Text>
        <Text color={borderColor}>{wrapContent(` ${title} `)}</Text>
      </Box>
      <Box>
        <Text dimColor>{' '.repeat(2)}</Text>
        <Text color={borderColor}>├{border}┤</Text>
      </Box>
      <Box flexDirection="column" paddingLeft={4} paddingRight={4}>
        {children}
      </Box>
      <Box>
        <Text dimColor>{' '.repeat(2)}</Text>
        <Text color={borderColor}>└{border}┘</Text>
      </Box>
      {onClose && (
        <Box marginTop={1} marginLeft={4}>
          <Text dimColor>Press ESC to close</Text>
        </Box>
      )}
    </Box>
  );
}
