//
/**
 * Ink选择组件
 * 用于在终端中创建交互式选择器
 */

import React, { useState, useEffect } from 'react';
import Box from './Box';
import Text from './Text';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  /** 选项列表 */
  options: SelectOption[];
  /** 默认选中的值 */
  defaultValue?: string;
  /** 选中状态改变时的回调 */
  onChange?: (value: string) => void;
  /** 是否聚焦 */
  isFocused?: boolean;
  /** 提示文本 */
  placeholder?: string;
}

export const Select: React.FC<SelectProps> = ({
  options,
  defaultValue,
  onChange,
  isFocused = false,
  placeholder = 'Select an option',
}) => {
  const [selectedIndex, setSelectedIndex] = useState(
    options.findIndex((opt) => opt.value === defaultValue) || 0
  );
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (isFocused) {
      setIsOpen(true);
    }
  }, [isFocused]);

  const handleKeyDown = (key: string) => {
    if (!isOpen) {
      if (key === 'enter' || key === ' ') {
        setIsOpen(true);
      }
      return;
    }

    switch (key) {
      case 'arrowup':
      case 'k':
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : options.length - 1));
        break;
      case 'arrowdown':
      case 'j':
        setSelectedIndex((prev) => (prev < options.length - 1 ? prev + 1 : 0));
        break;
      case 'enter':
        onChange?.(options[selectedIndex].value);
        setIsOpen(false);
        break;
      case 'escape':
        setIsOpen(false);
        break;
    }
  };

  const selectedValue = options[selectedIndex]?.label || placeholder;

  return (
    <Box flexDirection="column">
      <Box
        borderStyle="single"
        paddingX={1}
        paddingY={0.5}
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={handleKeyDown}
        isFocused={isFocused}
      >
        <Text>{selectedValue}</Text>
      </Box>

      {isOpen && (
        <Box borderStyle="single" marginTop={1}>
          {options.map((option, index) => (
            <Box
              key={option.value}
              paddingX={1}
              paddingY={0.5}
              backgroundColor={index === selectedIndex ? 'blue' : undefined}
              onClick={() => {
                onChange?.(option.value);
                setIsOpen(false);
              }}
              onKeyDown={(key: string) => {
                if (key === 'enter') {
                  onChange?.(option.value);
                  setIsOpen(false);
                }
              }}
            >
              <Text color={index === selectedIndex ? 'white' : undefined}>
                {index === selectedIndex ? '●' : '○'} {option.label}
              </Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
};

/**
 * 创建选择组件
 */
export function createSelect(props: SelectProps): React.ReactElement {
  return <Select {...props} />;
}
