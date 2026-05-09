/**
 * Slider组件 - 滑块
 */

import React, { useState } from 'react';
import { Text, Box } from '../ink.js';

export interface SliderProps {
  min?: number;
  max?: number;
  value?: number;
  onChange?: (value: number) => void;
  step?: number;
  label?: string;
  showValue?: boolean;
  width?: number;
  color?: string;
  fillColor?: string;
}

export function Slider({
  min = 0,
  max = 100,
  value: controlledValue,
  onChange,
  step = 1,
  label,
  showValue = true,
  width = 30,
  color = 'gray',
  fillColor = 'cyan',
}: SliderProps): React.ReactNode {
  const [internalValue, setInternalValue] = useState(min);

  const currentValue =
    controlledValue !== undefined ? controlledValue : internalValue;
  const percentage = ((currentValue - min) / (max - min)) * 100;
  const filledWidth = Math.round((width * percentage) / 100);

  const handleIncrement = () => {
    const newValue = Math.min(currentValue + step, max);
    setInternalValue(newValue);
    onChange?.(newValue);
  };

  const handleDecrement = () => {
    const newValue = Math.max(currentValue - step, min);
    setInternalValue(newValue);
    onChange?.(newValue);
  };

  const filledBar = '█'.repeat(filledWidth);
  const emptyBar = '░'.repeat(width - filledWidth);

  return (
    <Box>
      {label && (
        <Box marginRight={2}>
          <Text color={color}>{label}</Text>
        </Box>
      )}
      <Box>
        <Text color={fillColor}>{filledBar}</Text>
        <Text color={color}>{emptyBar}</Text>
      </Box>
      {showValue && (
        <Box marginLeft={2}>
          <Text color={fillColor} bold>
            {currentValue}
          </Text>
        </Box>
      )}
    </Box>
  );
}
