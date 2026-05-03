// @ts-nocheck
/**
 * Ink滚动视图组件
 * 用于在终端中显示可滚动内容
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text } from './Box';

export interface ScrollViewProps {
  children: React.ReactNode;
  height?: number;
  width?: number;
  onScroll?: (scrollTop: number) => void;
}

export const ScrollView: React.FC<ScrollViewProps> = ({
  children,
  height = 10,
  width,
  onScroll,
}) => {
  const [scrollTop, setScrollTop] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);

  const handleKeyDown = useCallback((key: string) => {
    const maxScroll = Math.max(0, contentHeight - height);
    
    switch (key) {
      case 'arrowup':
      case 'k':
        setScrollTop((prev) => Math.max(0, prev - 1));
        break;
      case 'arrowdown':
      case 'j':
        setScrollTop((prev) => Math.min(maxScroll, prev + 1));
        break;
      case 'pageup':
      case 'u':
        setScrollTop((prev) => Math.max(0, prev - Math.floor(height / 2)));
        break;
      case 'pagedown':
      case 'd':
        setScrollTop((prev) => Math.min(maxScroll, prev + Math.floor(height / 2)));
        break;
      case 'home':
        setScrollTop(0);
        break;
      case 'end':
        setScrollTop(maxScroll);
        break;
    }
  }, [contentHeight, height]);

  useEffect(() => {
    onScroll?.(scrollTop);
  }, [scrollTop, onScroll]);

  // 计算内容高度（简化版本）
  useEffect(() => {
    // 在实际实现中，这里会测量内容高度
    // 为了简化，我们假设内容高度是固定的
    setContentHeight(20);
  }, [children]);

  const maxScroll = Math.max(0, contentHeight - height);
  const canScroll = contentHeight > height;
  const scrollPercent = contentHeight > 0 ? (scrollTop / maxScroll) * 100 : 0;

  return (
    <Box
      flexDirection="column"
      height={height}
      width={width}
      borderStyle="single"
      onKeyDown={handleKeyDown}
      overflow="hidden"
    >
      {/* 滚动内容 */}
      <Box
        flexDirection="column"
        marginTop={-scrollTop}
        minHeight={contentHeight}
      >
        {children}
      </Box>

      {/* 滚动条 */}
      {canScroll && (
        <Box
          flexDirection="row"
          justifyContent="flex-end"
          paddingRight={1}
          paddingY={0.5}
          backgroundColor="gray"
        >
          <Box
            width={1}
            height={Math.max(1, (height / contentHeight) * height)}
            backgroundColor="blue"
            marginTop={scrollPercent / 100 * (height - (height / contentHeight) * height)}
          />
        </Box>
      )}
    </Box>
  );
};

/**
 * 创建滚动视图组件
 */
export function createScrollView(props: ScrollViewProps): React.ReactElement {
  return <ScrollView {...props} />;
}
