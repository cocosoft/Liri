/**
 * Tab栏组件
 * 用于管理多个标签页
 */

import React from 'react';

export interface Tab {
  id: string;
  label: string;
  icon?: string;
  isActive?: boolean;
  hasError?: boolean;
  isModified?: boolean;
  onClose?: () => void;
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
    <div className="flex items-center bg-gray-100 border-b border-gray-200 overflow-x-auto">
      {tabs.map((tab) => {
        const isActive = activeTabId === tab.id;
        
        return (
          <div
            key={tab.id}
            className={`flex items-center gap-1 px-3 py-2 cursor-pointer transition-colors flex-shrink-0 ${
              isActive
                ? 'bg-white border-b-2 border-blue-500 text-gray-800'
                : 'text-gray-600 hover:text-gray-800 hover:bg-gray-50'
            }`}
            onClick={() => onTabChange(tab.id)}
          >
            {tab.icon && (
              <span className="text-sm">{tab.icon}</span>
            )}
            <span className="text-sm font-medium">{tab.label}</span>
            
            {tab.isModified && (
              <span className="w-2 h-2 bg-blue-500 rounded-full" />
            )}
            
            {tab.hasError && (
              <span className="w-2 h-2 bg-red-500 rounded-full" />
            )}
            
            {onTabClose && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onTabClose(tab.id);
                }}
                className="ml-1 p-0.5 hover:bg-gray-200 rounded transition-colors"
              >
                <span className="text-xs">×</span>
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
};

/**
 * 创建Tab栏组件
 */
export function createTabBar(props: TabBarProps): React.ReactElement {
  return <TabBar {...props} />;
}
