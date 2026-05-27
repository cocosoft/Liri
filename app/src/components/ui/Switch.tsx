/**
 * Switch组件 - 开关
 */

import React, { useState } from 'react';
import { Text, Box } from '../ink.js';

export interface SwitchProps {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  onColor?: string;
  offColor?: string;
}

export function Switch({
  checked: controlledChecked,
  onChange,
  label,
  disabled = false,
  onColor = 'green',
  offColor = 'gray',
}: SwitchProps): React.ReactNode {
  const [internalChecked, setInternalChecked] = useState(false);

  const isChecked =
    controlledChecked !== undefined ? controlledChecked : internalChecked;

  const handleToggle = () => {
    if (disabled) return;
    const newValue = !isChecked;
    setInternalChecked(newValue);
    onChange?.(newValue);
  };

  const switchOn = '●━━━';
  const switchOff = '○━━━';
  const switchColor = isChecked ? onColor : offColor;

  return (
    <Box>
      <Text color={switchColor} dimColor={disabled}>
        {isChecked ? switchOn : switchOff}
      </Text>
      {label && (
        <Box marginLeft={1}>
          <Text color={switchColor} dimColor={disabled}>
            {label}
          </Text>
        </Box>
      )}
    </Box>
  );
}
