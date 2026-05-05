/**
 * Radio组件 - 单选框
 */

import React, { useState } from 'react';
import { Text, Box } from '../ink.js';

export interface RadioItem {
  id: string;
  label: string;
  disabled?: boolean;
}

export interface RadioProps {
  items: RadioItem[];
  value?: string;
  onChange?: (value: string) => void;
  color?: string;
  selectedColor?: string;
}

export function Radio({
  items,
  value: controlledValue,
  onChange,
  color = 'white',
  selectedColor = 'cyan',
}: RadioProps): React.ReactNode {
  const [internalValue, setInternalValue] = useState('');

  const currentValue = controlledValue !== undefined ? controlledValue : internalValue;

  const handleSelect = (item: RadioItem) => {
    if (item.disabled) return;
    setInternalValue(item.id);
    onChange?.(item.id);
  };

  return (
    <Box flexDirection="column">
      {items.map((item) => {
        const isSelected = item.id === currentValue;
        const radioIcon = isSelected ? '◉' : '○';
        const itemColor = item.disabled
          ? 'gray'
          : isSelected
          ? selectedColor
          : color;

        return (
          <Box key={item.id}>
            <Text
              color={itemColor}
              bold={isSelected}
              dimColor={item.disabled}
            >
              {radioIcon} {item.label}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
