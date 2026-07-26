/**
 * 伙伴设置子组件
 * 管理 AI 助手人设：名称、灵魂描述、是否静音
 */

import React from 'react';
import { useSettings } from '@modules/hooks/useSettings';
import { SettingRow } from './SettingRow';
import { Toggle } from './Toggle';

/**
 * 伙伴设置面板
 */
export const CompanionSettings: React.FC = () => {
  const { settings, update, set } = useSettings();

  const companion = settings.companion || { name: '', soul: '' };
  const companionMuted = settings.companionMuted === true;

  /**
   * 更新伙伴人设
   */
  const handleCompanionChange = (key: string, value: string) => {
    update({
      companion: {
        ...companion,
        [key]: value,
      },
    });
  };

  return (
    <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 px-1 pb-2">AI 伙伴</h2>
    <div className="space-y-0 divide-y divide-gray-100 dark:divide-gray-700">
      {/* 助手名称 */}
      <SettingRow label="助手名称" hint="设置 AI 助手在对话中的显示名称">
        <input
          type="text"
          value={companion.name || ''}
          onChange={(e) => handleCompanionChange('name', e.target.value)}
          placeholder="如：Liri"
          className="px-3 py-1.5 w-48 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </SettingRow>

      {/* 灵魂描述 */}
      <SettingRow
        label="灵魂描述"
        hint="定义 AI 助手的个性和行为风格（英文 Prompt）"
      >
        <div className="w-48">
        <textarea
          value={companion.soul || ''}
          onChange={(e) => handleCompanionChange('soul', e.target.value)}
          rows={2}
          placeholder="如：You are a helpful coding assistant..."
          className="px-3 py-2 w-full text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y font-mono"
        />
        </div>
      </SettingRow>

      {/* 静音模式 */}
      <SettingRow label="静音模式" hint="关闭 AI 助手的自动发言和推送通知">
        <Toggle
          value={companionMuted}
          onChange={(v) => set('companionMuted', v)}
        />
      </SettingRow>
    </div>
  );
};
