//
/**
 * Ink Spacer组件
 * 用于创建空间
 */

import React from 'react';
import { Box } from 'ink';

export interface SpacerProps {
  amount?: number;
  direction?: 'horizontal' | 'vertical';
}

export const Spacer: React.FC<SpacerProps> = ({
  amount = 1,
  direction = 'vertical',
}) => {
  return (
    <Box
      width={direction === 'horizontal' ? amount : undefined}
      height={direction === 'vertical' ? amount : undefined}
    />
  );
};
