/**
 * 设置行布局组件
 * 统一每个设置项的 label + hint + 控件布局
 */

import React from 'react';

/**
 * 设置行属性
 */
export interface SettingRowProps {
  /** 设置项标题 */
  label: string;
  /** 设置项描述（可选） */
  hint?: string;
  /** 控件内容 */
  children: React.ReactNode;
  /** 是否使用紧凑布局 */
  compact?: boolean;
}

/**
 * 设置行共享布局组件
 * 对标 P2 hermes-web-ui SettingRow.vue
 */
export const SettingRow: React.FC<SettingRowProps> = ({
  label,
  hint,
  children,
  compact = false,
}) => {
  return (
    <div className={`setting-row ${compact ? 'setting-row-compact' : ''}`}>
      <div className="flex items-center justify-between py-2.5">
        <div className="flex-1 mr-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
            {label}
          </label>
          {hint && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {hint}
            </p>
          )}
        </div>
        <div className="flex-shrink-0 flex items-center">
          {children}
        </div>
      </div>
    </div>
  );
};
