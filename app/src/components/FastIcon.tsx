/**
 * FastIcon组件 - 快速模式图标
 * 显示当前运行模式的视觉指示
 */

import React from 'react';
import { Text, Box } from '@modules/ink';

export type FastMode = 'fast' | 'balanced' | 'quality';

export interface FastIconProps {
  /** 模式 */
  mode?: FastMode;
  /** 激活状态 */
  active?: boolean;
  /** 闪烁动画（通过外部状态控制） */
  animate?: boolean;
  /** 尺寸 */
  size?: 'small' | 'medium' | 'large';
  /** 显示标签 */
  showLabel?: boolean;
}

const modeConfig: Record<
  FastMode,
  { icon: string; label: string; color: string; speed: string }
> = {
  fast: { icon: '⚡', label: '快速', color: 'yellow', speed: '高' },
  balanced: { icon: '⚖', label: '均衡', color: 'cyan', speed: '中' },
  quality: { icon: '✦', label: '质量', color: 'magenta', speed: '低' },
};

export function FastIcon({
  mode = 'balanced',
  active = true,
  animate = false,
  size = 'medium',
  showLabel = true,
}: FastIconProps): React.ReactNode {
  const config = modeConfig[mode];
  const iconColor = active ? config.color : 'gray';

  if (!active) {
    return (
      <Box>
        <Text color="gray" dim>
          {config.icon}
        </Text>
        {showLabel && (
          <Text color="gray" dim>
            {' '}
            {config.label}
          </Text>
        )}
      </Box>
    );
  }

  if (size === 'small') {
    return (
      <Box>
        <Text color={iconColor}>{animate ? '⚡' : config.icon}</Text>
      </Box>
    );
  }

  if (size === 'large') {
    return (
      <Box
        borderStyle="round"
        borderColor={iconColor as any}
        paddingX={1}
        paddingY={0}
      >
        <Text color={iconColor} bold>
          {config.icon}
        </Text>
        {showLabel && <Text color={iconColor}> {config.label}</Text>}
        <Text color="gray" dim>
          {' 速度:'}
          {config.speed}
        </Text>
      </Box>
    );
  }

  return (
    <Box>
      <Text color={iconColor} bold>
        {config.icon}
      </Text>
      {showLabel && <Text color={iconColor}> {config.label}</Text>}
    </Box>
  );
}
