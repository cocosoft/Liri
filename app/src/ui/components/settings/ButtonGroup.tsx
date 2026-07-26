import React from 'react';

interface ButtonGroupOption<T extends string> {
  value: T;
  label: string;
}

interface ButtonGroupProps<T extends string> {
  options: ButtonGroupOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

/**
 * 统一的分段按钮组组件
 * 从 AppearanceSettings / NotificationSettings / SystemSettings 抽取
 */
export const ButtonGroup = <T extends string>({
  options,
  value,
  onChange,
}: ButtonGroupProps<T>) => (
  <div className="flex gap-1.5 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
    {options.map((opt) => (
      <button
        key={opt.value}
        onClick={() => onChange(opt.value)}
        className={`px-3 py-1.5 text-xs rounded-md font-medium transition-colors duration-150 ${
          value === opt.value
            ? 'bg-white dark:bg-gray-700 shadow-sm text-blue-600 dark:text-blue-400'
            : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
        }`}
      >
        {opt.label}
      </button>
    ))}
  </div>
);
