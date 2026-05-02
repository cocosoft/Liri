/**
 * Tag组件 - 标签
 */

import React from 'react';
import { Text, Box } from '../ink.js';

type TagVariant = 'default' | 'primary' | 'success' | 'warning' | 'error' | 'info';

export interface TagProps {
  text: string;
  variant?: TagVariant;
  closable?: boolean;
  onClose?: () => void;
}

const VARIANT_COLORS: Record<TagVariant, { bg: string; text: string }> = {
  default: { bg: 'gray', text: 'white' },
  primary: { bg: 'blue', text: 'white' },
  success: { bg: 'green', text: 'white' },
  warning: { bg: 'yellow', text: 'black' },
  error: { bg: 'red', text: 'white' },
  info: { bg: 'cyan', text: 'black' },
};

export function Tag({
  text,
  variant = 'default',
  closable = false,
  onClose,
}: TagProps): React.ReactNode {
  const colors = VARIANT_COLORS[variant];

  return (
    <Box>
      <Text color={colors.text}>
        {' '}
        {text}
        {' '}
      </Text>
      {closable && onClose && (
        <Text color={colors.text} onMouseDown={onClose}>
          ✕ 
        </Text>
      )}
    </Box>
  );
}

export interface TagGroupProps {
  tags: Array<{ id: string; text: string; variant?: TagVariant }>;
  closable?: boolean;
  onClose?: (id: string) => void;
}

export function TagGroup({ tags, closable, onClose }: TagGroupProps): React.ReactNode {
  return (
    <Box>
      {tags.map((tag) => (
        <Box key={tag.id} marginRight={1}>
          <Tag
            text={tag.text}
            variant={tag.variant}
            closable={closable}
            onClose={onClose ? () => onClose(tag.id) : undefined}
          />
        </Box>
      ))}
    </Box>
  );
}
