// @ts-nocheck
/**
 * Ink复选框组件
 * 用于在终端中创建复选框
 */

import React from 'react';
import { Text, Box } from './Box';

export interface CheckboxProps {
  /** 是否选中 */
  checked?: boolean;
  /** 标签文本 */
  label?: string;
  /** 选中状态改变时的回调 */
  onChange?: (checked: boolean) => void;
  /** 是否禁用 */
  disabled?: boolean;
}

export const Checkbox: React.FC<CheckboxProps> = ({
  checked = false,
  label,
  onChange,
  disabled = false,
}) => {
  const handleClick = () => {
    if (!disabled) {
      onChange?.(!checked);
    }
  };

  const handleKeyDown = (key: string) => {
    if (!disabled && (key === 'enter' || key === ' ')) {
      onChange?.(!checked);
    }
  };

  return (
    <Box
      flexDirection="row"
      alignItems="center"
      gap={1}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      isFocused={!disabled}
      disabled={disabled}
    >
      <Box
        borderStyle="single"
        width={3}
        height={1}
        justifyContent="center"
        alignItems="center"
        backgroundColor={checked ? 'blue' : undefined}
      >
        <Text color={checked ? 'white' : undefined}>
          {checked ? '✓' : ' '}
        </Text>
      </Box>
      {label && <Text>{label}</Text>}
    </Box>
  );
};

/**
 * 创建复选框组件
 */
export function createCheckbox(props: CheckboxProps): React.ReactElement {
  return <Checkbox {...props} />;
}
