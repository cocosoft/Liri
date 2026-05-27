/**
 * TagTabs组件 - 标签式选项卡
 * 将选项卡渲染为可选择标签样式，用于终端UI分类筛选
 */

import React, { useState } from 'react';
import { Text, Box } from '../ink.js';

export interface TagTabItem {
  id: string;
  label: string;
  count?: number;
  disabled?: boolean;
}

export interface TagTabsProps {
  tabs: TagTabItem[];
  activeTab?: string;
  onChange?: (tabId: string) => void;
  color?: string;
  activeColor?: string;
  showCount?: boolean;
}

export function TagTabs({
  tabs,
  activeTab,
  onChange,
  color = 'cyan',
  activeColor = 'green',
  showCount = false,
}: TagTabsProps): React.ReactNode {
  const [internalActive, setInternalActive] = useState(
    activeTab || tabs[0]?.id
  );

  const currentActive = activeTab || internalActive;

  const handleTabClick = (tabId: string) => {
    if (tabs.find((t) => t.id === tabId)?.disabled) return;
    setInternalActive(tabId);
    onChange?.(tabId);
  };

  return (
    <Box flexDirection="row" gap={1} flexWrap="wrap">
      {tabs.map((tab) => {
        const isActive = tab.id === currentActive;
        const isDisabled = tab.disabled;

        if (isActive) {
          return (
            <Box
              key={tab.id}
              paddingX={1}
              borderStyle="round"
              borderColor={activeColor}
            >
              <Text color={activeColor} bold>
                {tab.label}
              </Text>
              {showCount && tab.count !== undefined && (
                <Text color={activeColor}> ({tab.count})</Text>
              )}
            </Box>
          );
        }

        return (
          <Box
            key={tab.id}
            paddingX={1}
            onPress={isDisabled ? undefined : () => handleTabClick(tab.id)}
            focusable={!isDisabled}
          >
            <Text color={isDisabled ? 'gray' : color}>{tab.label}</Text>
            {showCount && tab.count !== undefined && (
              <Text color={isDisabled ? 'gray' : 'gray'}> ({tab.count})</Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

export interface FilterableTagTabsProps extends TagTabsProps {
  filterLabel?: string;
  onFilter?: (query: string) => void;
}

export function FilterableTagTabs({
  tabs,
  activeTab,
  onChange,
  color = 'cyan',
  activeColor = 'green',
  showCount = false,
  filterLabel = 'Filter:',
  onFilter,
}: FilterableTagTabsProps): React.ReactNode {
  const [filterQuery, setFilterQuery] = useState('');

  const filteredTabs = filterQuery
    ? tabs.filter(
        (tab) =>
          tab.label.toLowerCase().includes(filterQuery.toLowerCase()) ||
          tab.id.toLowerCase().includes(filterQuery.toLowerCase())
      )
    : tabs;

  return (
    <Box flexDirection="column" gap={1}>
      {onFilter && (
        <Box flexDirection="row" alignItems="center" gap={1}>
          <Text dimColor>{filterLabel}</Text>
          <Text>/</Text>
        </Box>
      )}
      <TagTabs
        tabs={filteredTabs}
        activeTab={activeTab}
        onChange={onChange}
        color={color}
        activeColor={activeColor}
        showCount={showCount}
      />
    </Box>
  );
}

export default TagTabs;
