/**
 * 工具栏组件
 * 提供常用操作按钮
 */

import React from 'react';

export interface ToolbarButton {
  id: string;
  icon: string;
  label: string;
  shortcut?: string;
  onClick?: () => void;
  isActive?: boolean;
  isDisabled?: boolean;
}

export interface ToolbarProps {
  buttons: ToolbarButton[];
  onButtonClick: (buttonId: string) => void;
  align?: 'left' | 'center' | 'right';
}

export const Toolbar: React.FC<ToolbarProps> = ({
  buttons,
  onButtonClick,
  align = 'left',
}) => {
  return (
    <div
      className={`flex items-center px-4 h-12 bg-gray-100 border-b border-gray-200 ${
        align === 'left' ? 'justify-start' : align === 'center' ? 'justify-center' : 'justify-end'
      }`}
    >
      <div className="flex items-center gap-1">
        {buttons.map((button) => (
          <button
            key={button.id}
            onClick={() => onButtonClick(button.id)}
            disabled={button.isDisabled}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
              button.isActive
                ? 'bg-blue-100 text-blue-700'
                : button.isDisabled
                ? 'bg-gray-50 text-gray-400 cursor-not-allowed'
                : 'bg-white text-gray-700 hover:bg-gray-50 hover:text-gray-900'
            }`}
            title={`${button.label}${button.shortcut ? ` (${button.shortcut})` : ''}`}
          >
            <span className="text-lg">{button.icon}</span>
            <span className="text-sm font-medium">{button.label}</span>
            {button.shortcut && (
              <span className="text-xs text-gray-400 px-1.5 py-0.5 bg-gray-100 rounded">
                {button.shortcut}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
};

/**
 * 创建工具栏组件
 */
export function createToolbar(props: ToolbarProps): React.ReactElement {
  return <Toolbar {...props} />;
}
