/**
 * Avatar组件 - 头像
 */

import React from 'react';
import { Text, Box } from '../ink.js';

type AvatarSize = 'sm' | 'md' | 'lg';
type AvatarShape = 'circle' | 'square';

export interface AvatarProps {
  name?: string;
  initials?: string;
  size?: AvatarSize;
  shape?: AvatarShape;
  color?: string;
}

const SIZE_CONFIG: Record<AvatarSize, { width: number; height: number }> = {
  sm: { width: 4, height: 4 },
  md: { width: 6, height: 6 },
  lg: { width: 8, height: 8 },
};

const COLORS = [
  'red', 'green', 'blue', 'yellow', 'purple', 'cyan', 'magenta', 'orange',
];

function getColorFromName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((word) => word[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function Avatar({
  name,
  initials,
  size = 'md',
  shape = 'circle',
  color,
}: AvatarProps): React.ReactNode {
  const { width, height } = SIZE_CONFIG[size];
  const avatarColor = color || (name ? getColorFromName(name) : 'gray');
  const displayInitials = initials || (name ? getInitials(name) : '?');

  const borderChar = shape === 'circle' ? '◉' : '■';

  return (
    <Box>
      <Text color={avatarColor} bold>
        {displayInitials}
      </Text>
    </Box>
  );
}
