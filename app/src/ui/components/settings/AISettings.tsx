/**
 * AI 模型设置子组件
 * 管理 AI 提供商、模型配置
 */

import React, { useState } from 'react';
import { useSettings } from '@modules/hooks/useSettings';
import { SettingRow } from './SettingRow';

/**
 * AI 设置面板
 * 对标 P2 hermes-web-ui ModelSettings
 */
export const AISettings: React.FC = () => {
  const { settings, set } = useSettings();

  const ai = settings.ai || {};

  /**
   * 处理提供商切换
   */
  const handleProviderChange = (provider: string) => {
    set('ai', { ...ai, provider: provider || undefined });
  };

  /**
   * 处理模型变更
   */
  const handleModelChange = (model: string) => {
    set('ai', { ...ai, model: model || undefined });
  };

  const provider = ai.provider || '';
  const model = ai.model || '';

  return (
    <div className="space-y-0 divide-y divide-gray-100 dark:divide-gray-700">
      {/* AI 提供商 */}
      <SettingRow label="AI 提供商" hint="选择默认的 AI 服务提供商">
        <select
          value={provider}
          onChange={(e) => handleProviderChange(e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">自动检测</option>
          <option value="anthropic">Anthropic</option>
          <option value="openai">OpenAI</option>
          <option value="deepseek">DeepSeek</option>
          <option value="ollama">Ollama (本地)</option>
          <option value="azure">Azure</option>
          <option value="vertex">Vertex AI</option>
        </select>
      </SettingRow>

      {/* 默认模型 */}
      <SettingRow
        label="默认模型"
        hint="设置默认使用的 AI 模型（留空使用提供商默认模型）"
      >
        <input
          type="text"
          value={model}
          onChange={(e) => handleModelChange(e.target.value)}
          placeholder="如：claude-sonnet-4-20250514"
          className="px-3 py-1.5 w-64 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </SettingRow>
    </div>
  );
};
