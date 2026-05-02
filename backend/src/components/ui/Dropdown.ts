/**
 * Dropdown组件 - 下拉菜单
 */

import React, { useState } from 'react';
import { Text, Box } from '../ink.js';

export interface DropdownItem {
  id: string;
  label: string;
  disabled?: boolean;
}

export interface DropdownProps {
  items: DropdownItem[];
  placeholder?: string;
  onSelect?: (item: DropdownItem) => void;
  color?: string;
  selectedColor?: string;
}

export function Dropdown({
  items,
  placeholder = 'Select...',
  onSelect,
  color = 'white',
  selectedColor = 'cyan',
}: DropdownProps): React.ReactNode {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedItem, setSelectedItem] = useState<DropdownItem | null>(null);

  const handleToggle = () => {
    setIsOpen(!isOpen);
    setSelectedIndex(0);
  };

  const handleSelect = (item: DropdownItem, index: number) => {
    if (item.disabled) return;
    setSelectedItem(item);
    setIsOpen(false);
    onSelect?.(item);
  };

  const displayText = selectedItem ? selectedItem.label : placeholder;

  return (
    <Box flexDirection="column">
      <Box>
        <Text
          color={isOpen ? selectedColor : color}
          underline={isOpen}
          onMouseDown={handleToggle}
        >
          {displayText} {isOpen ? '▲' : '▼'}
        </Text>
      </Box>
      {isOpen && (
        <Box flexDirection="column" marginTop={1}>
          {items.map((item, idx) => {
            const isSelected = idx === selectedIndex;
            const itemColor = item.disabled
              ? 'gray'
              : isSelected
              ? selectedColor
              : color;

            return (
              <Box key={item.id}>
                <Text color={itemColor} bold={isSelected}>
                  {isSelected ? '▸ ' : '  '}
                  {item.label}
                  {item.disabled && <Text dimColor> (disabled)</Text>}
                </Text>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
