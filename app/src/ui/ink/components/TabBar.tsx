/**
 * Ink TabBar 组件
 * 用于在 CLI 中管理多个标签页
 */

import React from 'react';
import { Box, Text } from '@modules/ink';

export interface Tab {
  id: string;
  label: string;
  isActive?: boolean;
  hasError?: boolean;
  isModified?: boolean;
}

export interface TabBarProps {
  tabs: Tab[];
  activeTabId: string;
  onTabChange: (tabId: string) => void;
  onTabClose?: (tabId: string) => void;
}

export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTabId,
  onTabChange,
  onTabClose,
}) => {
  return (
    <Box
      flexDirection="row"
      borderStyle="single"
      borderColor="gray"
      paddingX={0}
      paddingY={0}
    >
      {tabs.map((tab) => {
        const isActive = activeTabId === tab.id;

        return (
          <Box key={tab.id} flexDirection="row" paddingX={1} marginRight={0}>
            <Text
              color={isActive ? 'white' : 'gray'}
              inverse={isActive}
              bold={isActive}
              underline={isActive}
            >
              {` ${tab.label} `}
            </Text>

            {tab.isModified ? <Text color="yellow">●</Text> : null}

            {tab.hasError ? <Text color="red">●</Text> : null}

            {onTabClose ? (
              <Text color="gray" dimColor>
                ×
              </Text>
            ) : null}
          </Box>
        );
      })}
    </Box>
  );
};
