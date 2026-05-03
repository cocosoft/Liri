// @ts-nocheck
/**
 * Ink Text组件
 * 用于显示文本
 */

import React from 'react';
import { Text as InkText } from 'ink';

export interface TextProps {
  children?: React.ReactNode;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  inverse?: boolean;
  color?: string;
  bgColor?: string;
  className?: string;
}

export const Text: React.FC<TextProps> = ({
  children,
  bold = false,
  italic = false,
  underline = false,
  strikethrough = false,
  inverse = false,
  color,
  bgColor,
  className,
}) => {
  return (
    <InkText
      bold={bold}
      italic={italic}
      underline={underline}
      strikethrough={strikethrough}
      inverse={inverse}
      color={color}
      backgroundColor={bgColor}
      className={className}
    >
      {children}
    </InkText>
  );
};