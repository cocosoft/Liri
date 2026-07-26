/**
 * 设置面板组件（重构版）
 * Tab 导航 + 子组件拆分架构，对标 P2 hermes-web-ui
 */

import React, { useState } from 'react';
import { AppearanceSettings } from './settings/AppearanceSettings';
import { AISettings } from './settings/AISettings';
import { AgentSettings } from './settings/AgentSettings';
import { FeatureSettings } from './settings/FeatureSettings';
import { ChannelSettings } from './settings/ChannelSettings';
import { CompanionSettings } from './settings/CompanionSettings';
import { NotificationSettings } from './settings/NotificationSettings';
import { SystemSettings } from './settings/SystemSettings';

/**
 * Tab 定义
 */
interface SettingsTab {
  /** 唯一标识 */
  id: string;
  /** 显示标题 */
  label: string;
  /** 对应面板组件 */
  component: React.FC;
}

/**
 * 所有设置 Tab
 */
const SETTINGS_TABS: SettingsTab[] = [
  { id: 'appearance', label: '外观', component: AppearanceSettings },
  { id: 'ai', label: 'AI 模型', component: AISettings },
  { id: 'agent', label: 'Agent', component: AgentSettings },
  { id: 'features', label: '功能开关', component: FeatureSettings },
  { id: 'channels', label: '渠道', component: ChannelSettings },
  { id: 'companion', label: '伙伴', component: CompanionSettings },
  { id: 'notifications', label: '通知', component: NotificationSettings },
  { id: 'system', label: '系统', component: SystemSettings },
];

/**
 * 设置面板属性
 */
export interface SettingsPanelProps {
  /** 面板是否打开 */
  isOpen: boolean;
  /** 关闭面板回调 */
  onClose: () => void;
  /** 默认激活的 Tab */
  defaultTab?: string;
}

/**
 * 设置面板组件
 * 对标 P2 hermes-web-ui SettingsView
 */
export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  isOpen,
  onClose,
  defaultTab = 'appearance',
}) => {
  const [activeTab, setActiveTab] = useState(defaultTab);

  if (!isOpen) return null;

  const ActiveComponent = SETTINGS_TABS.find(
    (t) => t.id === activeTab
  )?.component;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">
            设置
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors text-xl leading-none"
            aria-label="关闭设置"
          >
            &times;
          </button>
        </div>

        {/* Tab 导航 */}
        <div className="flex px-4 pt-3 gap-0.5 border-b border-gray-200 dark:border-gray-700">
          {SETTINGS_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-t-md transition-colors whitespace-nowrap border-b-2 -mb-[1px] ${
                activeTab === tab.id
                  ? 'text-blue-600 dark:text-blue-400 border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                  : 'text-gray-500 dark:text-gray-400 border-transparent hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto px-6 py-4 max-h-[calc(80vh-180px)]">
          {ActiveComponent ? <ActiveComponent /> : null}
        </div>

        {/* 底部操作栏 */}
        <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * 创建设置面板组件
 * @deprecated 使用 <SettingsPanel> JSX 代替
 */
export function createSettingsPanel(
  props: SettingsPanelProps
): React.ReactElement {
  return <SettingsPanel {...props} />;
}
