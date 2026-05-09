//
/**
 * Ink进度条组件
 * 用于在终端中显示进度条
 */

import React from 'react';
import Text from './Text';
import Box from './Box';

export interface ProgressBarProps {
  /** 当前进度值 (0-100) */
  value: number;
  /** 进度条宽度 */
  width?: number;
  /** 进度条标签 */
  label?: string;
  /** 显示百分比 */
  showPercent?: boolean;
  /** 完成字符 */
  filledChar?: string;
  /** 未完成字符 */
  emptyChar?: string;
  /** 自定义样式 */
  style?: React.CSSProperties;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  width = 40,
  label,
  showPercent = true,
  filledChar = '█',
  emptyChar = '░',
  style,
}) => {
  const clampedValue = Math.max(0, Math.min(100, value));
  const filledLength = Math.round((clampedValue / 100) * width);
  const emptyLength = width - filledLength;

  const bar = filledChar.repeat(filledLength) + emptyChar.repeat(emptyLength);

  return (
    <Box style={style} flexDirection="column" gap={1}>
      {label && <Text bold>{label}</Text>}
      <Box flexDirection="row" alignItems="center" gap={2}>
        <Text>{bar}</Text>
        {showPercent && <Text bold>{Math.round(clampedValue)}%</Text>}
      </Box>
    </Box>
  );
};

/**
 * 创建进度条组件
 */
export function createProgressBar(props: ProgressBarProps): React.ReactElement {
  return <ProgressBar {...props} />;
}
