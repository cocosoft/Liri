/**
 * Tooltip组件 - 提示
 */

import React, { useState } from 'react';
import { Text, Box } from '../ink.js';

export interface TooltipProps {
  content: string;
  children: React.ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  color?: string;
  bgColor?: string;
  visible?: boolean;
}

export function Tooltip({
  content,
  children,
  position = 'top',
  color = 'white',
  bgColor = 'gray',
  visible: controlledVisible,
}: TooltipProps): React.ReactNode {
  const [internalVisible, setInternalVisible] = useState(controlledVisible ?? true);

  const visible = controlledVisible !== undefined ? controlledVisible : internalVisible;

  const renderTooltip = (): React.ReactNode => {
    if (!visible) return null;

    const tooltipContent = (
      <Box>
        <Text color={color}> {content} </Text>
      </Box>
    );

    switch (position) {
      case 'top':
        return (
          <Box flexDirection="column">
            {tooltipContent}
            {children}
          </Box>
        );
      case 'bottom':
        return (
          <Box flexDirection="column">
            {children}
            {tooltipContent}
          </Box>
        );
      case 'left':
        return (
          <Box>
            {tooltipContent}
            {children}
          </Box>
        );
      case 'right':
        return (
          <Box>
            {children}
            {tooltipContent}
          </Box>
        );
      default:
        return (
          <Box flexDirection="column">
            {tooltipContent}
            {children}
          </Box>
        );
    }
  };

  return (
    <Box>
      {renderTooltip()}
    </Box>
  );
}
