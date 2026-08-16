/**
 * Ink SplitPane 组件
 * 用于在 CLI 中创建分割布局
 */

import React from 'react';
import { Box } from '@modules/ink';

export interface SplitPaneProps {
  left: React.ReactNode;
  right: React.ReactNode;
  defaultSplit?: number;
  direction?: 'horizontal' | 'vertical';
}

export const SplitPane: React.FC<SplitPaneProps> = ({
  left,
  right,
  defaultSplit = 0.5,
  direction = 'vertical',
}) => {
  const leftRatio = Math.max(0.1, Math.min(0.9, defaultSplit));
  const rightRatio = 1 - leftRatio;

  return (
    <Box
      flexDirection={direction === 'horizontal' ? 'column' : 'row'}
      width="100%"
    >
      <Box
        flexGrow={0}
        flexShrink={0}
        width={
          direction === 'vertical' ? `${Math.floor(leftRatio * 100)}%` : '100%'
        }
        height={
          direction === 'horizontal'
            ? `${Math.floor(leftRatio * 100)}%`
            : '100%'
        }
        borderStyle="round"
        borderColor="gray"
      >
        {left}
      </Box>

      <Box
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
        width={direction === 'vertical' ? 1 : '100%'}
        height={direction === 'horizontal' ? 1 : '100%'}
      >
        <Box
          width={direction === 'vertical' ? 1 : '100%'}
          height={direction === 'horizontal' ? 1 : '100%'}
        >
          {' '}
        </Box>
      </Box>

      <Box
        flexGrow={0}
        flexShrink={0}
        width={
          direction === 'vertical' ? `${Math.floor(rightRatio * 100)}%` : '100%'
        }
        height={
          direction === 'horizontal'
            ? `${Math.floor(rightRatio * 100)}%`
            : '100%'
        }
        borderStyle="round"
        borderColor="gray"
      >
        {right}
      </Box>
    </Box>
  );
};
