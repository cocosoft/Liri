//
/**
 * 标签页组件（基于CC源码）
 * 提供标签页导航功能
 */

import React from 'react';
import { Box, Text } from '../../ink';
import { TabsProps } from '../types/UITypes';
import { useTheme } from '../design-system/ThemeProvider';

/**
 * 标签页组件（基于CC源码）
 */
export function Tabs({
  tabs,
  activeTab,
  onChange,
  orientation = 'horizontal',
  size = 'md',
  color = 'primary'
}: TabsProps) {
  const { theme } = useTheme();

  /**
   * 处理标签切换（基于CC源码）
   */
  const handleTabChange = (tabId: string) => {
    if (tabId !== activeTab) {
      onChange(tabId);
    }
  };

  /**
   * 获取标签页样式（基于CC源码）
   */
  const getTabStyle = (tabId: string) => {
    const isActive = tabId === activeTab;

    if (isActive) {
      return {
        backgroundColor: theme.colors[color],
        color: theme.colors.background,
        borderColor: theme.colors[color]
      };
    }

    return {
      backgroundColor: theme.colors.background,
      color: theme.colors.text,
      borderColor: theme.colors.border
    };
  };

  /**
   * 渲染标签页头（基于CC源码）
   */
  const renderTabHeaders = () => {
    return (
      <Box flexDirection={orientation === 'vertical' ? 'column' : 'row'}>
        {tabs.map((tab) => {
          const style = getTabStyle(tab.id);
          
          return (
            <Box
              key={tab.id}
              paddingLeft={2}
              paddingRight={2}
              paddingTop={1}
              paddingBottom={1}
              borderStyle="round"
              borderColor={style.borderColor}
              backgroundColor={style.backgroundColor}
              onPress={() => handleTabChange(tab.id)}
              focusable={!tab.disabled}
            >
              <Text color={style.color}>
                {tab.label}
              </Text>
            </Box>
          );
        })}
      </Box>
    );
  };

  /**
   * 渲染活动标签页内容（基于CC源码）
   */
  const renderActiveTabContent = () => {
    const activeTabItem = tabs.find(tab => tab.id === activeTab);
    
    if (!activeTabItem) {
      return null;
    }

    return (
      <Box marginTop={1}>
        {activeTabItem.content}
      </Box>
    );
  };

  return (
    <Box flexDirection="column">
      {renderTabHeaders()}
      {renderActiveTabContent()}
    </Box>
  );
}

/**
 * 带图标的标签页组件（基于CC源码）
 */
export function IconTabs({
  tabs,
  activeTab,
  onChange,
  orientation = 'horizontal',
  size = 'md',
  color = 'primary'
}: TabsProps & { tabs: Array<{ id: string; label: string; icon: string; content: React.ReactNode; disabled?: boolean }> }) {
  return (
    <Tabs
      tabs={tabs.map(tab => ({
        ...tab,
        label: (
          <Box flexDirection="row" alignItems="center" gap={1}>
            <Text>{tab.icon}</Text>
            <Text>{tab.label}</Text>
          </Box>
        )
      }))}
      activeTab={activeTab}
      onChange={onChange}
      orientation={orientation}
      size={size}
      color={color}
    />
  );
}

/**
 * 可滚动标签页组件（基于CC源码）
 */
export function ScrollableTabs({
  tabs,
  activeTab,
  onChange,
  orientation = 'horizontal',
  size = 'md',
  color = 'primary',
  maxWidth = 80
}: TabsProps & { maxWidth?: number }) {
  const { theme } = useTheme();

  /**
   * 渲染可滚动标签页头（基于CC源码）
   */
  const renderScrollableTabHeaders = () => {
    return (
      <Box
        flexDirection={orientation === 'vertical' ? 'column' : 'row'}
        width={maxWidth}
        overflow="hidden"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab;
          const style = getTabStyle(tab.id);
          
          return (
            <Box
              key={tab.id}
              paddingLeft={2}
              paddingRight={2}
              paddingTop={1}
              paddingBottom={1}
              borderStyle="round"
              borderColor={style.borderColor}
              backgroundColor={style.backgroundColor}
              onPress={() => handleTabChange(tab.id)}
              focusable={!tab.disabled}
              flexShrink={0}
            >
              <Text color={style.color}>
                {tab.label}
              </Text>
            </Box>
          );
        })}
      </Box>
    );
  };

  /**
   * 获取标签页样式（基于CC源码）
   */
  const getTabStyle = (tabId: string) => {
    const isActive = tabId === activeTab;

    if (isActive) {
      return {
        backgroundColor: theme.colors[color],
        color: theme.colors.background,
        borderColor: theme.colors[color]
      };
    }

    return {
      backgroundColor: theme.colors.background,
      color: theme.colors.text,
      borderColor: theme.colors.border
    };
  };

  /**
   * 处理标签切换（基于CC源码）
   */
  const handleTabChange = (tabId: string) => {
    if (tabId !== activeTab) {
      onChange(tabId);
    }
  };

  /**
   * 渲染活动标签页内容（基于CC源码）
   */
  const renderActiveTabContent = () => {
    const activeTabItem = tabs.find(tab => tab.id === activeTab);
    
    if (!activeTabItem) {
      return null;
    }

    return (
      <Box marginTop={1}>
        {activeTabItem.content}
      </Box>
    );
  };

  return (
    <Box flexDirection="column">
      {renderScrollableTabHeaders()}
      {renderActiveTabContent()}
    </Box>
  );
}

/**
 * 步骤标签页组件（基于CC源码）
 */
export function StepTabs({
  steps,
  currentStep,
  onChange,
  color = 'primary'
}: {
  steps: Array<{ id: string; label: string; description?: string }>;
  currentStep: string;
  onChange: (stepId: string) => void;
  color?: keyof UITheme['colors'];
}) {
  const { theme } = useTheme();

  return (
    <Box flexDirection="column" gap={1}>
      {/* 步骤指示器（基于CC源码） */}
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        {steps.map((step, index) => {
          const isActive = step.id === currentStep;
          const isCompleted = steps.findIndex(s => s.id === currentStep) > index;
          
          return (
            <Box key={step.id} flexDirection="column" alignItems="center" gap={0.5}>
              {/* 步骤圆点（基于CC源码） */}
              <Box
                width={3}
                height={3}
                borderStyle="round"
                borderColor={isActive || isCompleted ? theme.colors[color] : theme.colors.border}
                backgroundColor={isActive ? theme.colors[color] : 'transparent'}
                justifyContent="center"
                alignItems="center"
                onPress={() => onChange(step.id)}
                focusable={true}
              >
                <Text color={isActive ? theme.colors.background : theme.colors[color]}>
                  {isCompleted ? '✓' : index + 1}
                </Text>
              </Box>

              {/* 步骤标签（基于CC源码） */}
              <Text 
                color={isActive || isCompleted ? theme.colors[color] : theme.colors.textSecondary}
                bold={isActive}
                fontSize="sm"
              >
                {step.label}
              </Text>

              {/* 步骤描述（基于CC源码） */}
              {step.description && (
                <Text 
                  color={theme.colors.textSecondary}
                  fontSize="xs"
                  textAlign="center"
                >
                  {step.description}
                </Text>
              )}
            </Box>
          );
        })}
      </Box>

      {/* 连接线（基于CC源码） */}
      <Box flexDirection="row" alignItems="center" paddingLeft={1} paddingRight={1}>
        {steps.map((_, index) => (
          <React.Fragment key={index}>
            {index > 0 && (
              <Box
                flexGrow={1}
                height={1}
                borderStyle="single"
                borderColor={index <= steps.findIndex(s => s.id === currentStep) ? theme.colors[color] : theme.colors.border}
                marginLeft={0.5}
                marginRight={0.5}
              />
            )}
          </React.Fragment>
        ))}
      </Box>
    </Box>
  );
}

export default Tabs;