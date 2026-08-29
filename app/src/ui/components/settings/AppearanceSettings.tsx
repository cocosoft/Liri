/**
 * 外观设置子组件
 * 管理主题、编辑器模式等显示相关设置
 */

import React from 'react';
import { useSettings } from '@modules/hooks';
import { SettingRow } from './SettingRow';
import { ButtonGroup } from './ButtonGroup';

/**
 * 外观设置面板
 * 对标 P2 hermes-web-ui DisplaySettings
 */
export const AppearanceSettings: React.FC = () => {
  const { settings, set, update } = useSettings();

  /**
   * 处理主题切换
   */
  const handleThemeChange = (theme: 'dark' | 'light' | 'system') => {
    set('theme', theme);
  };

  /**
   * 处理编辑器模式切换
   */
  const handleEditorModeChange = (mode: string) => {
    set('editorMode', mode);
  };

  /**
   * 处理详细模式切换
   */
  const handleVerboseChange = (verbose: boolean) => {
    set('verbose', verbose);
  };

  const theme = settings.theme || 'dark';
  const editorMode = (settings.editorMode as string) || 'normal';
  const verbose = settings.verbose === true;

  return (
    <>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 px-1 pb-2">
        外观
      </h2>
      <div className="space-y-0 divide-y divide-gray-100 dark:divide-gray-700">
        {/* 主题 */}
        <SettingRow label="主题模式" hint="切换应用的亮色/暗色/跟随系统主题">
          <ButtonGroup
            options={[
              { value: 'light', label: '浅色' },
              { value: 'dark', label: '深色' },
              { value: 'system', label: '跟随系统' },
            ]}
            value={theme as 'light' | 'dark' | 'system'}
            onChange={handleThemeChange}
          />
        </SettingRow>

        {/* 编辑器模式 */}
        <SettingRow label="编辑器模式" hint="选择输入编辑器的行为模式">
          <select
            value={editorMode}
            onChange={(e) => handleEditorModeChange(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="normal">普通模式</option>
            <option value="vim">Vim 模式</option>
            <option value="emacs">Emacs 模式</option>
          </select>
        </SettingRow>

        {/* 详细模式 */}
        <SettingRow label="详细模式" hint="启用后显示更多调试和状态信息">
          <button
            onClick={() => handleVerboseChange(!verbose)}
            className={`relative w-11 h-6 rounded-full transition-colors ${
              verbose ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'
            }`}
          >
            <span
              className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                verbose ? 'translate-x-[22px]' : 'translate-x-0.5'
              }`}
            />
          </button>
        </SettingRow>
      </div>
    </>
  );
};
