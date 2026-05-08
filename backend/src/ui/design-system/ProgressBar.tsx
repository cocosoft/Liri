//
/**
 * 进度条组件（基于CC源码）
 * 显示任务进度和状态
 */

import React from 'react';
import { Box, Text } from '../../ink';
import { ProgressBarProps } from '../types/UITypes';
import { useTheme } from './ThemeProvider';

/**
 * 进度条组件（基于CC源码）
 */
export function ProgressBar({
  value,
  max = 100,
  color = 'primary',
  size = 'md',
  showPercentage = true,
  label
}: ProgressBarProps) {
  const { theme } = useTheme();
  
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));
  const barWidth = 20; // 进度条宽度
  const filledWidth = Math.round((percentage / 100) * barWidth);
  const emptyWidth = barWidth - filledWidth;

  /**
   * 渲染进度条（基于CC源码）
   */
  const renderBar = () => {
    const filledChar = '█';
    const emptyChar = '░';

    return (
      <Box flexDirection="row">
        <Text color={theme.colors[color]}>
          {filledChar.repeat(filledWidth)}
        </Text>
        <Text color={theme.colors.border}>
          {emptyChar.repeat(emptyWidth)}
        </Text>
      </Box>
    );
  };

  /**
   * 渲染百分比文本（基于CC源码）
   */
  const renderPercentage = () => {
    if (!showPercentage) return null;

    return (
      <Text color={theme.colors.textSecondary}>
        {Math.round(percentage)}%
      </Text>
    );
  };

  /**
   * 渲染标签（基于CC源码）
   */
  const renderLabel = () => {
    if (!label) return null;

    return (
      <Text color={theme.colors.text} bold={true}>
        {label}
      </Text>
    );
  };

  return (
    <Box flexDirection="column" gap={0.5}>
      {/* 标签和进度信息（基于CC源码） */}
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        {renderLabel()}
        {renderPercentage()}
      </Box>

      {/* 进度条（基于CC源码） */}
      {renderBar()}

      {/* 数值显示（基于CC源码） */}
      <Box flexDirection="row" justifyContent="space-between">
        <Text color={theme.colors.textSecondary} fontSize={theme.typography.fontSize.xs}>
          {value}/{max}
        </Text>
      </Box>
    </Box>
  );
}

/**
 * 不确定进度条组件（基于CC源码）
 */
export function IndeterminateProgressBar({
  color = 'primary',
  size = 'md',
  label
}: Omit<ProgressBarProps, 'value' | 'max' | 'showPercentage'>) {
  const { theme } = useTheme();

  /**
   * 渲染动画进度条（基于CC源码）
   */
  const renderAnimatedBar = () => {
    const barWidth = 20;
    const animationChars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    const animationIndex = Math.floor(Date.now() / 100) % animationChars.length;

    return (
      <Box flexDirection="row" alignItems="center" gap={1}>
        <Text color={theme.colors[color]}>
          {animationChars[animationIndex]}
        </Text>
        <Text color={theme.colors.border}>
          {'░'.repeat(barWidth)}
        </Text>
      </Box>
    );
  };

  return (
    <Box flexDirection="column" gap={0.5}>
      {/* 标签（基于CC源码） */}
      {label && (
        <Text color={theme.colors.text} bold={true}>
          {label}
        </Text>
      )}

      {/* 动画进度条（基于CC源码） */}
      {renderAnimatedBar()}
    </Box>
  );
}

/**
 * 步骤进度条组件（基于CC源码）
 */
export function StepProgressBar({
  steps,
  currentStep,
  color = 'primary',
  size = 'md'
}: {
  steps: string[];
  currentStep: number;
  color?: keyof UITheme['colors'];
  size?: keyof UITheme['typography']['fontSize'];
}) {
  const { theme } = useTheme();

  return (
    <Box flexDirection="column" gap={1}>
      {/* 步骤指示器（基于CC源码） */}
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        {steps.map((step, index) => (
          <Box key={index} flexDirection="row" alignItems="center" gap={0.5}>
            {/* 步骤圆点（基于CC源码） */}
            <Box
              width={2}
              height={2}
              borderStyle="round"
              borderColor={index <= currentStep ? theme.colors[color] : theme.colors.border}
              justifyContent="center"
              alignItems="center"
            >
              {index < currentStep && (
                <Text color={theme.colors[color]} fontSize={theme.typography.fontSize.xs}>
                  ✓
                </Text>
              )}
              {index === currentStep && (
                <Text color={theme.colors[color]} fontSize={theme.typography.fontSize.xs}>
                  ●
                </Text>
              )}
            </Box>

            {/* 步骤标签（基于CC源码） */}
            <Text 
              color={index <= currentStep ? theme.colors[color] : theme.colors.textSecondary}
              bold={index === currentStep}
              fontSize={theme.typography.fontSize[size]}
            >
              {step}
            </Text>
          </Box>
        ))}
      </Box>

      {/* 连接线（基于CC源码） */}
      <Box flexDirection="row" alignItems="center" paddingLeft={1} paddingRight={1}>
        {steps.map((_, index) => (
          <React.Fragment key={index}>
            {index > 0 && (
              <Box
                flexGrow={1}
                height={1}
                borderStyle="single"
                borderColor={index <= currentStep ? theme.colors[color] : theme.colors.border}
                marginLeft={0.5}
                marginRight={0.5}
              />
            )}
          </React.Fragment>
        ))}
      </Box>
    </Box>
  );
}

export default ProgressBar;