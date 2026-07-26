/**
 * Agent 设置子组件
 * 管理本地 Agent 运行时行为、Ollama、路由策略
 */

import React from 'react';
import { useSettings } from '@modules/hooks/useSettings';
import type {
  AIConfig,
  LocalAgentConfig,
  OllamaConfig,
  RoutingConfig,
} from '@modules/config/types';
import { SettingRow } from './SettingRow';
import { Toggle } from './Toggle';

/**
 * Agent 设置面板
 */
export const AgentSettings: React.FC = () => {
  const { settings, update } = useSettings();

  const ai = (settings.ai || {}) as AIConfig;
  const localAgent = (ai.localAgent || {}) as LocalAgentConfig;

  /**
   * 更新 localAgent 配置
   */
  const handleLocalAgentChange = (key: string, value: unknown) => {
    update({
      ai: {
        ...ai,
        localAgent: {
          ...localAgent,
          [key]: value,
        },
      },
    });
  };

  /**
   * 更新 Ollama 配置
   */
  const handleOllamaChange = (key: string, value: unknown) => {
    const ollama = (localAgent.ollama || {}) as OllamaConfig;
    update({
      ai: {
        ...ai,
        localAgent: {
          ...localAgent,
          ollama: {
            enabled: ollama.enabled ?? false,
            baseUrl: ollama.baseUrl ?? 'http://localhost:11434',
            defaultModel: ollama.defaultModel ?? 'llama3',
            timeout: ollama.timeout ?? 120000,
            [key]: value,
          },
        },
      },
    });
  };

  /**
   * 更新路由策略
   */
  const handleRoutingChange = (key: string, value: unknown) => {
    const routing = (localAgent.routing || {}) as RoutingConfig;
    update({
      ai: {
        ...ai,
        localAgent: {
          ...localAgent,
          routing: {
            strategy: routing.strategy ?? 'cloud-first',
            fallbackToCloud: routing.fallbackToCloud ?? true,
            [key]: value,
          },
        },
      },
    });
  };

  const ollama = (localAgent.ollama || {}) as OllamaConfig;
  const routing = (localAgent.routing || {}) as RoutingConfig;

  return (
    <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 px-1 pb-2">本地 Agent</h2>
    <div className="space-y-0 divide-y divide-gray-100 dark:divide-gray-700">
      {/* 本地 Agent 开关 */}
      <SettingRow
        label="本地 Agent"
        hint="启用后可在本地运行模型推理，减少 API 调用"
      >
        <Toggle
          value={localAgent.enabled === true}
          onChange={(v) => handleLocalAgentChange('enabled', v)}
        />
      </SettingRow>

      {/* 路由策略 */}
      <SettingRow label="路由策略" hint="选择任务优先使用本地还是云端模型">
        <select
          value={routing.strategy || 'cloud-first'}
          onChange={(e) => handleRoutingChange('strategy', e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="cloud-first">云端优先</option>
          <option value="ollama-first">Ollama 优先</option>
          <option value="local-first">本地优先</option>
        </select>
      </SettingRow>

      {/* 故障降级 */}
      <SettingRow
        label="故障降级到云端"
        hint="本地模型不可用时自动回退到云端 API"
      >
        <Toggle
          value={routing.fallbackToCloud !== false}
          onChange={(v) => handleRoutingChange('fallbackToCloud', v)}
        />
      </SettingRow>

      {/* Ollama 地址 */}
      <SettingRow label="Ollama 服务地址" hint="本地 Ollama 服务的 API 地址">
        <input
          type="text"
          value={ollama.baseUrl || 'http://localhost:11434'}
          onChange={(e) => handleOllamaChange('baseUrl', e.target.value)}
          placeholder="http://localhost:11434"
          className="px-3 py-1.5 w-full text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </SettingRow>

      {/* Ollama 默认模型 */}
      <SettingRow label="Ollama 默认模型" hint="本地运行时使用的默认模型">
        <input
          type="text"
          value={ollama.defaultModel || 'llama3'}
          onChange={(e) => handleOllamaChange('defaultModel', e.target.value)}
          placeholder="llama3"
          className="px-3 py-1.5 w-48 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </SettingRow>

      {/* Ollama 超时 */}
      <SettingRow label="Ollama 超时" hint="本地模型的请求超时时间（毫秒）">
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={ollama.timeout ?? 120000}
            onChange={(e) =>
              handleOllamaChange('timeout', parseInt(e.target.value, 10) || 0)
            }
            min={10000}
            step={10000}
            className="px-3 py-1.5 w-full text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="text-xs text-gray-500 dark:text-gray-400">毫秒</span>
        </div>
      </SettingRow>

      {/* Skill Provider */}
      <SettingRow label="Skill 提供者" hint="启用本地 Skill 执行引擎">
        <Toggle
          value={localAgent.skillProvider?.enabled !== false}
          onChange={(v) =>
            update({
              ai: {
                ...ai,
                localAgent: {
                  ...localAgent,
                  skillProvider: { enabled: v },
                },
              },
            })
          }
        />
      </SettingRow>

      {/* MCP Provider */}
      <SettingRow label="MCP 提供者" hint="启用本地 MCP 协议支持">
        <Toggle
          value={localAgent.mcpProvider?.enabled !== false}
          onChange={(v) =>
            update({
              ai: {
                ...ai,
                localAgent: {
                  ...localAgent,
                  mcpProvider: { enabled: v },
                },
              },
            })
          }
        />
      </SettingRow>

      {/* 性能指标 */}
      <SettingRow label="性能指标" hint="收集本地 Agent 执行的性能数据">
        <Toggle
          value={localAgent.enableMetrics === true}
          onChange={(v) => handleLocalAgentChange('enableMetrics', v)}
        />
      </SettingRow>
    </div>
  );
};
