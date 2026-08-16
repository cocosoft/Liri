/**
 * Ink Box组件
 * 用于布局和容器
 */

import React from 'react';
import { Box as InkBox } from '@modules/ink';

export interface BoxProps {
  children?: React.ReactNode;
  flexDirection?: 'row' | 'column';
  alignItems?: 'flex-start' | 'flex-end' | 'center' | 'stretch';
  justifyContent?:
    | 'flex-start'
    | 'flex-end'
    | 'center'
    | 'space-between'
    | 'space-around';
  padding?: number;
  margin?: number;
  borderStyle?: 'single' | 'double' | 'round' | 'bold' | 'none';
  borderColor?: string;
  backgroundColor?: string;
  width?: number | '100%';
  height?: number;
  minHeight?: number;
  className?: string;
}

export const Box: React.FC<BoxProps> = ({
  children,
  flexDirection = 'column',
  alignItems = 'stretch',
  justifyContent = 'flex-start',
  padding = 0,
  margin = 0,
  borderStyle = 'none',
  borderColor,
  backgroundColor,
  width,
  height,
  minHeight,
  className,
}) => {
  return (
    <InkBox
      {...({
        flexDirection,
        alignItems,
        justifyContent,
        padding,
        margin,
        borderStyle,
        borderColor,
        backgroundColor,
        width,
        height,
        minHeight,
        className,
      } as any)}
    >
      {children}
    </InkBox>
  );
};
