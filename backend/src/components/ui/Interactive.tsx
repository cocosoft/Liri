//
/**
 * 交互式Confirm组件
 */

import React, { useState } from 'react';
import { Text, Box, useInput } from '../ink.js';

interface ConfirmProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function Confirm({ message, onConfirm, onCancel }: ConfirmProps) {
  const [answer, setAnswer] = useState<string | null>(null);

  useInput((input, key) => {
    if (key.return) {
      if (answer === 'y' || answer === 'Y') {
        onConfirm();
      } else {
        onCancel();
      }
    } else if (input === 'y' || input === 'Y' || input === 'n' || input === 'N') {
      setAnswer(input);
    }
  });

  return (
    <Box>
      <Text>{message} </Text>
      <Text bold color={answer === 'y' ? 'green' : 'white'}>[Y]</Text>
      <Text>/</Text>
      <Text bold color={answer === 'n' ? 'green' : 'white'}>[N]</Text>
    </Box>
  );
}

interface SelectProps {
  message: string;
  options: string[];
  onSelect: (index: number) => void;
}

export function Select({ message, options, onSelect }: SelectProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (key.return) {
      onSelect(selectedIndex);
    } else if (key.upArrow) {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : options.length - 1));
    } else if (key.downArrow) {
      setSelectedIndex((prev) => (prev < options.length - 1 ? prev + 1 : 0));
    }
  });

  return (
    <Box flexDirection="column">
      <Text>{message}</Text>
      {options.map((option, index) => (
        <Box key={index}>
          <Text color={selectedIndex === index ? 'green' : 'white'}>
            {selectedIndex === index ? '> ' : '  '}
            {option}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
