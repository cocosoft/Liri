/**
 * 侧边栏组件
 * 用于导航和快速访问功能
 */

import React from 'react';

export interface SidebarItem {
  id: string;
  label: string;
  icon: string;
  badge?: number;
  isActive?: boolean;
  onClick?: () => void;
}

export interface SidebarProps {
  items: SidebarItem[];
  activeItemId?: string;
  onItemClick: (itemId: string) => void;
  collapsed?: boolean;
  onCollapseChange?: (collapsed: boolean) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  items,
  activeItemId,
  onItemClick,
  collapsed = false,
  onCollapseChange,
}) => {
  return (
    <div
      className={`flex flex-col bg-gray-800 text-white transition-all duration-300 ${
        collapsed ? 'w-16' : 'w-56'
      }`}
    >
      {/* Logo */}
      <div className="flex items-center justify-center h-16 border-b border-gray-700">
        {!collapsed && (
          <span className="text-xl font-bold text-blue-400">Liri</span>
        )}
        {collapsed && <span className="text-xl">🚀</span>}
      </div>

      {/* Navigation Items */}
      <nav className="flex-1 py-4 overflow-y-auto">
        {items.map((item) => {
          const isActive = activeItemId === item.id;

          return (
            <button
              key={item.id}
              onClick={() => onItemClick(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 transition-colors relative group ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-300 hover:bg-gray-700 hover:text-white'
              }`}
            >
              {/* Active indicator */}
              {isActive && (
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-400" />
              )}

              {/* Icon */}
              <span className="text-lg flex-shrink-0">{item.icon}</span>

              {/* Label */}
              {!collapsed && (
                <span className="text-sm font-medium truncate">
                  {item.label}
                </span>
              )}

              {/* Badge */}
              {item.badge !== undefined && (
                <span
                  className={`ml-auto flex-shrink-0 px-2 py-0.5 text-xs rounded-full ${
                    item.badge > 0
                      ? 'bg-red-500 text-white'
                      : 'bg-gray-600 text-gray-300'
                  }`}
                >
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              )}

              {/* Tooltip when collapsed */}
              {collapsed && (
                <span className="absolute left-full ml-2 px-2 py-1 bg-gray-900 text-white text-sm rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                  {item.label}
                  {item.badge !== undefined && ` (${item.badge})`}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Collapse Button */}
      {onCollapseChange && (
        <button
          onClick={() => onCollapseChange(!collapsed)}
          className="flex items-center justify-center h-12 border-t border-gray-700 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
        >
          {collapsed ? '▶' : '◀'}
        </button>
      )}
    </div>
  );
};

/**
 * 创建侧边栏组件
 */
export function createSidebar(props: SidebarProps): React.ReactElement {
  return <Sidebar {...props} />;
}
