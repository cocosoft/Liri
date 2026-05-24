/**
 * 加载状态组件
 * 显示加载动画和状态信息
 */

import React, { useState, useEffect } from 'react';
import { Box, Text } from '../ink';
import { LoadingStateProps, UITheme } from '../types/UITypes';
import { useTheme } from './ThemeProvider';

/**
 * 加载状态组件
 */
export function LoadingState({
  text = '加载中...',
  size = 'md',
  color = 'primary',
  type = 'spinner',
}: LoadingStateProps) {
  const { theme } = useTheme();

  /**
   * 渲染旋转加载器
   */
  const renderSpinner = () => {
    const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    const [frameIndex, setFrameIndex] = useState(0);

    useEffect(() => {
      const interval = setInterval(() => {
        setFrameIndex((prev) => (prev + 1) % spinnerFrames.length);
      }, 100);

      return () => clearInterval(interval);
    }, []);

    return <Text color={theme.colors[color]}>{spinnerFrames[frameIndex]}</Text>;
  };

  /**
   * 渲染点加载器
   */
  const renderDots = () => {
    const dotFrames = ['.  ', '.. ', '...', ' ..', '  .', '   '];
    const [frameIndex, setFrameIndex] = useState(0);

    useEffect(() => {
      const interval = setInterval(() => {
        setFrameIndex((prev) => (prev + 1) % dotFrames.length);
      }, 300);

      return () => clearInterval(interval);
    }, []);

    return <Text color={theme.colors[color]}>{dotFrames[frameIndex]}</Text>;
  };

  /**
   * 渲染进度条加载器
   */
  const renderBar = () => {
    const barFrames = [
      '[=   ]',
      '[ =  ]',
      '[  = ]',
      '[   =]',
      '[  = ]',
      '[ =  ]',
    ];
    const [frameIndex, setFrameIndex] = useState(0);

    useEffect(() => {
      const interval = setInterval(() => {
        setFrameIndex((prev) => (prev + 1) % barFrames.length);
      }, 200);

      return () => clearInterval(interval);
    }, []);

    return <Text color={theme.colors[color]}>{barFrames[frameIndex]}</Text>;
  };

  /**
   * 根据类型渲染加载动画
   */
  const renderLoader = () => {
    switch (type) {
      case 'spinner':
        return renderSpinner();
      case 'dots':
        return renderDots();
      case 'bar':
        return renderBar();
      default:
        return renderSpinner();
    }
  };

  return (
    <Box flexDirection="row" alignItems="center">
      {renderLoader()}
      <Text color={theme.colors.text}>{text}</Text>
    </Box>
  );
}

/**
 * 全屏加载状态组件
 */
export function FullScreenLoadingState({
  text = '加载中...',
  color = 'primary',
  type = 'spinner',
}: Omit<LoadingStateProps, 'size'>) {
  const { theme } = useTheme();

  return (
    <Box flexDirection="column" justifyContent="center" alignItems="center">
      <LoadingState text={text} color={color} type={type} size="lg" />
      <Text color={theme.colors.textSecondary}>请稍候...</Text>
    </Box>
  );
}

/**
 * 内联加载状态组件
 */
export function InlineLoadingState({
  text,
  color = 'primary',
  type = 'spinner',
}: Omit<LoadingStateProps, 'size'>) {
  return <LoadingState text={text} color={color} type={type} size="sm" />;
}

/**
 * 骨架屏加载状态组件
 */
export function SkeletonLoadingState({
  width = 20,
  height = 1,
  color = 'border',
}: {
  width?: number;
  height?: number;
  color?: keyof UITheme['colors'];
}) {
  const { theme } = useTheme();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setIsVisible((prev) => !prev);
    }, 500);

    return () => clearInterval(interval);
  }, []);

  return (
    <Box
      width={width}
      height={height}
      borderStyle="single"
      borderColor={isVisible ? theme.colors[color] : theme.colors.background}
    />
  );
}

/**
 * 进度加载状态组件
 */
export function ProgressLoadingState({
  progress,
  total,
  text,
  color = 'primary',
}: {
  progress: number;
  total: number;
  text?: string;
  color?: keyof UITheme['colors'];
}) {
  const percentage = Math.round((progress / total) * 100);
  const displayText = text || `处理中... ${progress}/${total}`;

  return (
    <Box flexDirection="column">
      <LoadingState text={displayText} color={color} type="bar" />
      <Text color="textSecondary">进度: {percentage}%</Text>
    </Box>
  );
}

export default LoadingState;
