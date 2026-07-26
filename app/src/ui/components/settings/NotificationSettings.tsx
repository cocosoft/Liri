/**
 * 通知设置子组件
 * 管理通知渠道和偏好
 */

import React from 'react';
import { useSettings } from '@modules/hooks/useSettings';
import { SettingRow } from './SettingRow';
import { Toggle } from './Toggle';
import { ButtonGroup } from './ButtonGroup';

/**
 * 通知设置面板
 */
export const NotificationSettings: React.FC = () => {
  const { settings, update } = useSettings();

  const notifications = settings.notifications || {};

  /**
   * 更新通知配置
   */
  const handleNotificationChange = (key: string, value: unknown) => {
    update({
      notifications: {
        ...notifications,
        [key]: value,
      },
    });
  };

  return (
    <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 px-1 pb-2">通知</h2>
    <div className="space-y-0 divide-y divide-gray-100 dark:divide-gray-700">
      {/* 通知渠道 */}
      <SettingRow label="通知渠道" hint="选择系统通知的发送方式">
        <ButtonGroup
          options={[
            { value: 'auto', label: '自动' },
            { value: 'native', label: '系统通知' },
            { value: 'none', label: '关闭' },
          ]}
          value={(notifications.preferredChannel || 'auto') as 'auto' | 'native' | 'none'}
          onChange={(v) => handleNotificationChange('preferredChannel', v)}
        />
      </SettingRow>

      {/* 任务完成通知 */}
      <SettingRow label="任务完成通知" hint="AI 任务执行完成后发送通知">
        <Toggle
          value={notifications.taskCompleteEnabled !== false}
          onChange={(v) => handleNotificationChange('taskCompleteEnabled', v)}
        />
      </SettingRow>

      {/* 输入请求通知 */}
      <SettingRow label="输入请求通知" hint="AI 需要用户输入时发送通知">
        <Toggle
          value={notifications.inputNeededEnabled !== false}
          onChange={(v) => handleNotificationChange('inputNeededEnabled', v)}
        />
      </SettingRow>

      {/* Agent 推送通知 */}
      <SettingRow label="Agent 推送通知" hint="后台 Agent 有新消息时发送通知">
        <Toggle
          value={notifications.agentPushEnabled !== false}
          onChange={(v) => handleNotificationChange('agentPushEnabled', v)}
        />
      </SettingRow>

      {/* 空闲通知阈值 */}
      <SettingRow label="空闲通知阈值" hint="消息空闲多久后发送通知（毫秒）">
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={notifications.idleThresholdMs ?? 60000}
            onChange={(e) =>
              handleNotificationChange(
                'idleThresholdMs',
                parseInt(e.target.value, 10) || 0
              )
            }
            min={1000}
            step={1000}
            className="px-3 py-1.5 w-full text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="text-xs text-gray-500 dark:text-gray-400">毫秒</span>
        </div>
      </SettingRow>
    </div>
  );
};
