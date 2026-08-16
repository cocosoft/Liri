/**
 * Ink CommandPalette 组件
 * 用于在 CLI 中搜索和执行命令
 */

import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput } from '@modules/ink';
import { Text as InkTextInput } from './Text';

export interface CommandItem {
  id: string;
  label: string;
  description?: string;
  category: string;
  action: () => void;
}

export interface CommandPaletteProps {
  commands: CommandItem[];
  isOpen: boolean;
  onClose: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  commands,
  isOpen,
  onClose,
}) => {
  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<string>('');

  useEffect(() => {
    if (isOpen) {
      setSearch('');
      setSelectedIndex(0);
      inputRef.current = '';
    }
  }, [isOpen]);

  const filteredCommands = commands.filter((cmd) => {
    const searchLower = search.toLowerCase();
    return (
      cmd.label.toLowerCase().includes(searchLower) ||
      cmd.description?.toLowerCase().includes(searchLower) ||
      cmd.category.toLowerCase().includes(searchLower)
    );
  });

  const groupedCommands = filteredCommands.reduce(
    (acc, cmd) => {
      if (!acc[cmd.category]) {
        acc[cmd.category] = [];
      }
      acc[cmd.category].push(cmd);
      return acc;
    },
    {} as Record<string, CommandItem[]>
  );

  const flatIndex = filteredCommands.reduce(
    (acc, cmd, idx) => {
      acc[cmd.id] = idx;
      return acc;
    },
    {} as Record<string, number>
  );

  useInput((input, key) => {
    if (!isOpen) return;

    if (key.escape) {
      onClose();
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((prev) =>
        prev > 0 ? prev - 1 : filteredCommands.length - 1
      );
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((prev) =>
        prev < filteredCommands.length - 1 ? prev + 1 : 0
      );
      return;
    }

    if (key.return) {
      if (filteredCommands[selectedIndex]) {
        filteredCommands[selectedIndex].action();
        onClose();
      }
      return;
    }

    if (key.backspace || key.delete) {
      const newValue = search.slice(0, -1);
      setSearch(newValue);
      inputRef.current = newValue;
      setSelectedIndex(0);
      return;
    }

    if (input && input.length === 1 && !key.ctrl && !key.meta) {
      const newValue = search + input;
      setSearch(newValue);
      inputRef.current = newValue;
      setSelectedIndex(0);
    }
  });

  if (!isOpen) return null;

  const categories = Object.keys(groupedCommands);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      padding={1}
    >
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Text bold color="cyan">
            ⚡ Command Palette
          </Text>
        </Box>

        <Box borderStyle="single" borderColor="gray" paddingX={1}>
          <Text color="gray">search&gt; </Text>
          <Text>{search || <Text color="gray">Type to filter...</Text>}</Text>
        </Box>

        <Box flexDirection="column" marginTop={1} minHeight={5}>
          {filteredCommands.length === 0 ? (
            <Box justifyContent="center">
              <Text color="gray">No commands found</Text>
            </Box>
          ) : (
            categories.map((category) => (
              <Box key={category} flexDirection="column">
                <Box marginTop={1} marginBottom={0}>
                  <Text bold color="yellow">
                    {category}
                  </Text>
                </Box>
                {groupedCommands[category].map((cmd) => {
                  const globalIndex = flatIndex[cmd.id];
                  const isSelected = globalIndex === selectedIndex;
                  return (
                    <Box
                      key={cmd.id}
                      flexDirection="row"
                      paddingX={1}
                      {...(isSelected ? {} : {})}
                    >
                      <Text
                        color={isSelected ? 'cyan' : undefined}
                        inverse={isSelected}
                      >
                        {isSelected ? ' ▸ ' : '   '}
                        {cmd.label}
                      </Text>
                      {cmd.description ? (
                        <Text color="gray">
                          {'  '}— {cmd.description}
                        </Text>
                      ) : null}
                    </Box>
                  );
                })}
              </Box>
            ))
          )}
        </Box>

        <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
          <Text color="gray">
            ↑↓ Navigate ↵ Select ESC Close {filteredCommands.length} commands
          </Text>
        </Box>
      </Box>
    </Box>
  );
};
