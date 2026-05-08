//
/**
 * 分隔线组件（基于CC源码）
 * 提供水平和垂直分隔线功能
 */

import React from 'react';
import { Box, Text } from '../../ink';
import { DividerProps } from '../types/UITypes';
import { useTheme } from './ThemeProvider';

/**
 * 分隔线组件（基于CC源码）
 */
export function Divider({
  color = 'border',
  orientation = 'horizontal',
  thickness = 1,
  margin = 1
}: DividerProps) {
  const { theme } = useTheme();

  if (orientation === 'horizontal') {
    return (
      <Box 
        height={thickness} 
        marginTop={margin} 
        marginBottom={margin}
        borderStyle="single"
        borderColor={theme.colors[color]}
      />
    );
  }

  // 垂直分隔线
  return (
    <Box 
      width={thickness} 
      marginLeft={margin} 
      marginRight={margin}
      borderStyle="single"
      borderColor={theme.colors[color]}
    />
  );
}

/**
 * 带文本的分隔线组件（基于CC源码）
 */
export function TextDivider({
  text,
  color = 'border',
  orientation = 'horizontal',
  thickness = 1,
  margin = 1
}: DividerProps & { text: string }) {
  const { theme } = useTheme();

  if (orientation === 'horizontal') {
    return (
      <Box flexDirection="row" alignItems="center" marginTop={margin} marginBottom={margin}>
        <Box 
          flexGrow={1} 
          height={thickness}
          borderStyle="single"
          borderColor={theme.colors[color]}
        />
        <Text color={theme.colors.textSecondary} marginLeft={1} marginRight={1}>
          {text}
        </Text>
        <Box 
          flexGrow={1} 
          height={thickness}
          borderStyle="single"
          borderColor={theme.colors[color]}
        />
      </Box>
    );
  }

  // 垂直分隔线带文本
  return (
    <Box flexDirection="column" alignItems="center" marginLeft={margin} marginRight={margin}>
      <Box 
        flexGrow={1} 
        width={thickness}
        borderStyle="single"
        borderColor={theme.colors[color]}
      />
      <Text color={theme.colors.textSecondary} marginTop={1} marginBottom={1}>
        {text}
      </Text>
      <Box 
        flexGrow={1} 
        width={thickness}
        borderStyle="single"
        borderColor={theme.colors[color]}
      />
    </Box>
  );
}

/**
 * 虚线分隔线组件（基于CC源码）
 */
export function DashedDivider({
  color = 'border',
  orientation = 'horizontal',
  thickness = 1,
  margin = 1
}: DividerProps) {
  const { theme } = useTheme();

  if (orientation === 'horizontal') {
    return (
      <Box 
        height={thickness} 
        marginTop={margin} 
        marginBottom={margin}
        borderStyle="dashed"
        borderColor={theme.colors[color]}
      />
    );
  }

  // 垂直虚线分隔线
  return (
    <Box 
      width={thickness} 
      marginLeft={margin} 
      marginRight={margin}
      borderStyle="dashed"
      borderColor={theme.colors[color]}
    />
  );
}

/**
 * 双线分隔线组件（基于CC源码）
 */
export function DoubleDivider({
  color = 'border',
  orientation = 'horizontal',
  thickness = 2,
  margin = 1
}: DividerProps) {
  const { theme } = useTheme();

  if (orientation === 'horizontal') {
    return (
      <Box flexDirection="column" marginTop={margin} marginBottom={margin}>
        <Box 
          height={thickness / 2} 
          borderStyle="single"
          borderColor={theme.colors[color]}
        />
        <Box 
          height={thickness / 2} 
          marginTop={0.5}
          borderStyle="single"
          borderColor={theme.colors[color]}
        />
      </Box>
    );
  }

  // 垂直双线分隔线
  return (
    <Box flexDirection="row" marginLeft={margin} marginRight={margin}>
      <Box 
        width={thickness / 2} 
        borderStyle="single"
        borderColor={theme.colors[color]}
      />
      <Box 
        width={thickness / 2} 
        marginLeft={0.5}
        borderStyle="single"
        borderColor={theme.colors[color]}
      />
    </Box>
  );
}

export default Divider;