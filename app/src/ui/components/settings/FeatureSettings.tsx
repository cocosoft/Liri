/**
 * 功能开关设置子组件
 * 管理功能特性的启用/禁用
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
 * 功能开关设置面板
 * 对标 P2 hermes-web-ui 各项开关设置
 */
export const FeatureSettings: React.FC = () => {
  const { settings, update } = useSettings();

  const features = settings.features || {};

  /**
   * 更新单个功能开关（防抖由 useSettings 内部处理）
   */
  const handleFeatureChange = (key: string, value: boolean) => {
    update({
      features: {
        ...features,
        [key]: value,
      },
    });
  };

  return (
    <div className="space-y-0 divide-y divide-gray-100 dark:divide-gray-700">
      <SettingRow
        label="待办事项"
        hint="启用任务管理和待办事项功能"
      >
        <Toggle
          value={features.todoEnabled !== false}
          onChange={(v) => handleFeatureChange('todoEnabled', v)}
        />
      </SettingRow>

      <SettingRow
        label="显示任务耗时"
        hint="在每个回合结束后显示执行耗时信息"
      >
        <Toggle
          value={features.showTurnDuration !== false}
          onChange={(v) => handleFeatureChange('showTurnDuration', v)}
        />
      </SettingRow>

      <SettingRow
        label="自动压缩"
        hint="对话过长时自动压缩历史消息"
      >
        <Toggle
          value={features.autoCompact !== false}
          onChange={(v) => handleFeatureChange('autoCompact', v)}
        />
      </SettingRow>

      <SettingRow
        label="文件检查点"
        hint="在工具操作前自动创建文件备份"
      >
        <Toggle
          value={features.fileCheckpointing !== false}
          onChange={(v) => handleFeatureChange('fileCheckpointing', v)}
        />
      </SettingRow>

      <SettingRow
        label="终端进度条"
        hint="在终端中显示任务执行进度条"
      >
        <Toggle
          value={features.terminalProgressBar !== false}
          onChange={(v) => handleFeatureChange('terminalProgressBar', v)}
        />
      </SettingRow>

      <SettingRow
        label="尊重.gitignore"
        hint="文件操作时遵循.gitignore规则"
      >
        <Toggle
          value={features.respectGitignore !== false}
          onChange={(v) => handleFeatureChange('respectGitignore', v)}
        />
      </SettingRow>

      <SettingRow
        label="复制完整响应"
        hint="复制时包含完整的 AI 响应内容"
      >
        <Toggle
          value={features.copyFullResponse === true}
          onChange={(v) => handleFeatureChange('copyFullResponse', v)}
        />
      </SettingRow>

      <SettingRow
        label="展开待办列表"
        hint="默认展开所有待办事项详情"
      >
        <Toggle
          value={features.showExpandedTodos === true}
          onChange={(v) => handleFeatureChange('showExpandedTodos', v)}
        />
      </SettingRow>

      <SettingRow
        label="终端状态标签"
        hint="在终端标签页显示任务状态信息"
      >
        <Toggle
          value={features.showStatusInTerminalTab === true}
          onChange={(v) => handleFeatureChange('showStatusInTerminalTab', v)}
        />
      </SettingRow>
    </div>
  );
};
