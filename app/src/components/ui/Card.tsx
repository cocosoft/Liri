/**
 * Card组件 - 内容卡片容器
 */

import React from 'react';
import { Text, Box } from '../ink.js';

export interface CardProps {
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  borderColor?: string;
  width?: number;
  padding?: number;
}

export function Card({
  title,
  children,
  footer,
  borderColor = 'cyan',
  width = 60,
  padding = 1,
}: CardProps): React.ReactNode {
  const border = '─'.repeat(width);
  const innerWidth = width - 4 - padding * 2;

  const wrapLine = (content: string): string => {
    const truncated =
      content.length > innerWidth
        ? content.slice(0, innerWidth - 1) + '…'
        : content;
    const padded = truncated.padEnd(innerWidth);
    return `│ ${' '.repeat(padding)}${padded}${' '.repeat(padding)} │`;
  };

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={borderColor}>┌{border}┐</Text>
      </Box>
      {title && (
        <Box>
          <Text color={borderColor}>{wrapLine(` ${title} `)}</Text>
        </Box>
      )}
      {title && (
        <Box>
          <Text color={borderColor}>├{border}┤</Text>
        </Box>
      )}
      <Box>
        <Text color={borderColor}>{wrapLine('')}</Text>
      </Box>
      <Box flexDirection="column" paddingLeft={4 + padding} paddingRight={4 + padding}>
        {children}
      </Box>
      <Box>
        <Text color={borderColor}>{wrapLine('')}</Text>
      </Box>
      {footer && (
        <>
          <Box>
            <Text color={borderColor}>├{border}┤</Text>
          </Box>
          <Box>
            <Text color={borderColor}>{wrapLine('')}</Text>
          </Box>
          <Box flexDirection="column" paddingLeft={4 + padding} paddingRight={4 + padding}>
            {footer}
          </Box>
          <Box>
            <Text color={borderColor}>{wrapLine('')}</Text>
          </Box>
        </>
      )}
      <Box>
        <Text color={borderColor}>└{border}┘</Text>
      </Box>
    </Box>
  );
}
