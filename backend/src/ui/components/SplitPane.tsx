/**
 * 分割面板组件
 * 用于创建可调整大小的分割布局
 */

import React, { useState, useRef, useEffect } from 'react';

export interface SplitPaneProps {
  /** 左侧面板内容 */
  left: React.ReactNode;
  /** 右侧面板内容 */
  right: React.ReactNode;
  /** 初始分割比例 (0-1) */
  defaultSplit?: number;
  /** 最小左侧宽度百分比 */
  minLeft?: number;
  /** 最小右侧宽度百分比 */
  minRight?: number;
  /** 分割方向 */
  direction?: 'horizontal' | 'vertical';
}

export const SplitPane: React.FC<SplitPaneProps> = ({
  left,
  right,
  defaultSplit = 0.5,
  minLeft = 0.1,
  minRight = 0.1,
  direction = 'vertical',
}) => {
  const [split, setSplit] = useState(defaultSplit);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging || !containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const totalSize = direction === 'vertical' ? rect.width : rect.height;
      const position = direction === 'vertical' ? e.clientX - rect.left : e.clientY - rect.top;
      const newSplit = position / totalSize;

      setSplit(Math.max(minLeft, Math.min(1 - minRight, newSplit)));
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, minLeft, minRight, direction]);

  return (
    <div
      ref={containerRef}
      className={`flex overflow-hidden ${direction === 'horizontal' ? 'flex-col' : 'flex-row'}`}
      style={{ height: direction === 'horizontal' ? '100%' : undefined }}
    >
      <div
        className="overflow-hidden"
        style={{
          [direction === 'vertical' ? 'width' : 'height']: `${split * 100}%`,
        }}
      >
        {left}
      </div>

      <div
        className={`cursor-col-resize bg-gray-200 hover:bg-gray-300 transition-colors flex items-center justify-center ${
          direction === 'horizontal' ? 'h-1' : 'w-1'
        }`}
        onMouseDown={() => setIsDragging(true)}
        style={{
          [direction === 'vertical' ? 'height' : 'width']: '100%',
        }}
      >
        <div className={`flex flex-col gap-0.5 ${direction === 'horizontal' ? 'rotate-90' : ''}`}>
          <div className="w-1.5 h-1.5 bg-gray-400 rounded-full" />
          <div className="w-1.5 h-1.5 bg-gray-400 rounded-full" />
          <div className="w-1.5 h-1.5 bg-gray-400 rounded-full" />
        </div>
      </div>

      <div
        className="overflow-hidden"
        style={{
          [direction === 'vertical' ? 'width' : 'height']: `${(1 - split) * 100}%`,
        }}
      >
        {right}
      </div>
    </div>
  );
};

/**
 * 创建分割面板组件
 */
export function createSplitPane(props: SplitPaneProps): React.ReactElement {
  return <SplitPane {...props} />;
}
