/**
 * Tabs组件 - 标签页
 */

import React, { useState } from 'react';
import { Text, Box } from '../ink.js';

export interface TabItem {
  id: string;
  label: string;
  content: React.ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  tabs: TabItem[];
  activeTab?: string;
  onChange?: (tabId: string) => void;
  color?: string;
  activeColor?: string;
  disabledColor?: string;
}

export function Tabs({
  tabs,
  activeTab,
  onChange,
  color = 'gray',
  activeColor = 'cyan',
  disabledColor = 'gray',
}: TabsProps): React.ReactNode {
  const [internalActive, setInternalActive] = useState(
    activeTab || tabs[0]?.id
  );

  const currentActive = activeTab || internalActive;

  const handleTabClick = (tab: TabItem) => {
    if (tab.disabled) return;
    setInternalActive(tab.id);
    onChange?.(tab.id);
  };

  return (
    <Box flexDirection="column">
      <Box>
        {tabs.map((tab, idx) => {
          const isActive = tab.id === currentActive;
          const tabColor = tab.disabled
            ? disabledColor
            : isActive
              ? activeColor
              : color;

          return (
            <Box key={tab.id}>
              {idx > 0 && <Text color={color}> │ </Text>}
              <Text color={tabColor} bold={isActive} underline={isActive}>
                {tab.label}
              </Text>
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        {tabs.find((t) => t.id === currentActive)?.content}
      </Box>
    </Box>
  );
}
