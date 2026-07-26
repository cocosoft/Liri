/**
 * 系统设置子组件
 * 管理自动更新、差异工具等系统级配置
 */

import React from 'react';
import { useSettings } from '@modules/hooks/useSettings';
import { SettingRow } from './SettingRow';
import { Toggle } from './Toggle';
import { ButtonGroup } from './ButtonGroup';

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

  const diffTool = (settings.diffTool as string) || 'auto';

  return (
    <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 px-1 pb-2">系统</h2>
    <div className="space-y-0 divide-y divide-gray-100 dark:divide-gray-700">
      {/* 自动更新开关 */}
      <SettingRow label="自动检查更新" hint="启动时自动检查是否有新版本">
        <Toggle
          value={autoUpdate.enabled !== false}
          onChange={(v) => handleAutoUpdateChange('enabled', v)}
        />
      </SettingRow>

      {/* 更新通道 */}
      <SettingRow label="更新通道" hint="选择稳定版或测试版更新通道">
        <ButtonGroup
          options={[
            { value: 'stable', label: '稳定版' },
            { value: 'beta', label: '测试版' },
          ]}
          value={(autoUpdate.channel || 'stable') as 'stable' | 'beta'}
          onChange={(v) => handleAutoUpdateChange('channel', v)}
        />
      </SettingRow>

      {/* 差异工具 */}
      <SettingRow label="差异工具" hint="选择代码差异对比的渲染工具">
        <select
          value={diffTool}
          onChange={(e) => handleDiffToolChange(e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="auto">自动选择</option>
          <option value="terminal">终端渲染</option>
        </select>
      </SettingRow>

      {/* 伴侣名称 — 已移至 CompanionSettings，此处移除 */}
    </div>
  );
};
