/**
 * 系统设置子组件
 * 管理自动更新、差异工具等系统级配置
 */

import React from 'react';
import { useSettings } from '@modules/hooks/useSettings';
import { SettingRow } from './SettingRow';

/**
 * 开关按钮组件
 */
const Toggle: React.FC<{
  value: boolean;
  onChange: (v: boolean) => void;
}> = ({ value, onChange }) => (
  <button
    onClick={() => onChange(!value)}
    className={`relative w-11 h-6 rounded-full transition-colors ${
      value ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'
    }`}
  >
    <span
      className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
        value ? 'translate-x-[22px]' : 'translate-x-0.5'
      }`}
    />
  </button>
);

/**
 * 系统设置面板
 */
export const SystemSettings: React.FC = () => {
  const { settings, update, set } = useSettings();

  const autoUpdate = settings.autoUpdate || {};

  /**
   * 更新自动更新配置
   */
  const handleAutoUpdateChange = (key: string, value: unknown) => {
    update({
      autoUpdate: {
        ...autoUpdate,
        [key]: value,
      },
    });
  };

  /**
   * 更新差异工具
   */
  const handleDiffToolChange = (tool: string) => {
    set('diffTool', tool);
  };

  /**
   * 更新伴侣配置
   */
  const handleCompanionChange = (key: string, value: unknown) => {
    const companion = settings.companion || { name: '', soul: '' };
    update({
      companion: {
        ...companion,
        [key]: value,
      },
    });
  };

  const companion = settings.companion || { name: '', soul: '' };
  const diffTool = (settings.diffTool as string) || 'auto';

  return (
    <div className="space-y-0 divide-y divide-gray-100 dark:divide-gray-700">
      {/* 自动更新开关 */}
      <SettingRow
        label="自动检查更新"
        hint="启动时自动检查是否有新版本"
      >
        <Toggle
          value={autoUpdate.enabled !== false}
          onChange={(v) => handleAutoUpdateChange('enabled', v)}
        />
      </SettingRow>

      {/* 更新通道 */}
      <SettingRow
        label="更新通道"
        hint="选择稳定版或测试版更新通道"
      >
        <div className="flex gap-1.5 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
          {(['stable', 'beta'] as const).map((ch) => (
            <button
              key={ch}
              onClick={() => handleAutoUpdateChange('channel', ch)}
              className={`px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${
                (autoUpdate.channel || 'stable') === ch
                  ? 'bg-white dark:bg-gray-700 shadow-sm text-blue-600 dark:text-blue-400'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
              }`}
            >
              {ch === 'stable' ? '稳定版' : '测试版'}
            </button>
          ))}
        </div>
      </SettingRow>

      {/* 差异工具 */}
      <SettingRow
        label="差异工具"
        hint="选择代码差异对比的渲染工具"
      >
        <select
          value={diffTool}
          onChange={(e) => handleDiffToolChange(e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="auto">自动选择</option>
          <option value="terminal">终端渲染</option>
        </select>
      </SettingRow>

      {/* 伴侣名称 */}
      <SettingRow
        label="AI 助手名称"
        hint="设置 AI 助手的显示名称"
      >
        <input
          type="text"
          value={companion.name || ''}
          onChange={(e) => handleCompanionChange('name', e.target.value)}
          placeholder="如：Liri"
          className="px-3 py-1.5 w-48 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </SettingRow>
    </div>
  );
};
