/**
 * Checkbox组件 - 复选框
 */

import React, { useState } from 'react';
import { Text, Box } from '../ink.js';

export interface CheckboxProps {
  label: string;
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  color?: string;
  checkedColor?: string;
}

export function Checkbox({
  label,
  checked: controlledChecked,
  onChange,
  disabled = false,
  color = 'white',
  checkedColor = 'green',
}: CheckboxProps): React.ReactNode {
  const [internalChecked, setInternalChecked] = useState(
    controlledChecked || false
  );

  const isChecked =
    controlledChecked !== undefined ? controlledChecked : internalChecked;

  const handleToggle = () => {
    if (disabled) return;
    const newValue = !isChecked;
    setInternalChecked(newValue);
    onChange?.(newValue);
  };

  const checkboxIcon = isChecked ? '◉' : '○';
  const checkboxColor = isChecked ? checkedColor : disabled ? 'gray' : color;

  return (
    <Box>
      <Text color={checkboxColor} bold={isChecked} dimColor={disabled}>
        {checkboxIcon} {label}
      </Text>
    </Box>
  );
}

export interface CheckboxGroupProps {
  items: Array<{ id: string; label: string; disabled?: boolean }>;
  values?: string[];
  onChange?: (values: string[]) => void;
  color?: string;
  checkedColor?: string;
}

export function CheckboxGroup({
  items,
  values: controlledValues,
  onChange,
  color = 'white',
  checkedColor = 'green',
}: CheckboxGroupProps): React.ReactNode {
  const [internalValues, setInternalValues] = useState<string[]>([]);

  const values =
    controlledValues !== undefined ? controlledValues : internalValues;

  const handleItemChange = (id: string, checked: boolean) => {
    const newValues = checked
      ? [...values, id]
      : values.filter((v) => v !== id);

    setInternalValues(newValues);
    onChange?.(newValues);
  };

  return (
    <Box flexDirection="column">
      {items.map((item) => (
        <Checkbox
          key={item.id}
          label={item.label}
          checked={values.includes(item.id)}
          disabled={item.disabled}
          onChange={(checked) => handleItemChange(item.id, checked)}
          color={color}
          checkedColor={checkedColor}
        />
      ))}
    </Box>
  );
}
