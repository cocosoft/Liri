import { useEffect, useState, useMemo, useCallback } from 'react';
import { useModelSwitchStore } from '../../stores/modelSwitchStore';
import { modelService } from '../../services/modelService';
import type { ModelInfo } from '../../types';

interface ModelSwitcherProps {
  onClose: () => void;
}

const PROVIDER_COLORS: Record<string, string> = {
  deepseek: 'text-red-600 dark:text-red-400',
  openai: 'text-green-600 dark:text-green-400',
  google: 'text-blue-600 dark:text-blue-400',
  qwen: 'text-indigo-600 dark:text-indigo-400',
  ollama: 'text-orange-600 dark:text-orange-400',
};

function getProviderColor(provider: string): string {
  return PROVIDER_COLORS[provider.toLowerCase()] || 'text-gray-600 dark:text-gray-400';
}

function ModelSwitcher({ onClose }: ModelSwitcherProps) {
  const { currentModelId, switchModel, tasks } = useModelSwitchStore();
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [groupBy, setGroupBy] = useState<'provider' | 'task'>('provider');

  useEffect(() => {
    modelService.list().then(setModels).catch(() => {});
  }, []);

  const filteredModels = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return models;
    return models.filter((m) =>
      m.id.toLowerCase().includes(q) ||
      m.name.toLowerCase().includes(q) ||
      m.provider.toLowerCase().includes(q)
    );
  }, [models, searchQuery]);

  const groupedByProvider = useMemo(() => {
    const groups: Record<string, ModelInfo[]> = {};
    for (const m of filteredModels) {
      const p = m.provider || 'other';
      if (!groups[p]) groups[p] = [];
      groups[p].push(m);
    }
    return groups;
  }, [filteredModels]);

  const handleSwitch = useCallback(async (modelId: string) => {
    await switchModel(modelId);
    onClose();
  }, [switchModel, onClose]);

  const currentTaskType = useMemo(() => {
    for (const [type, modelId] of Object.entries(tasks)) {
      if (modelId === currentModelId) return type;
    }
    return null;
  }, [tasks, currentModelId]);

  const taskLabels: Record<string, string> = {
    chat: '💬 对话',
    coding: '💻 编程',
    translation: '🌐 翻译',
    quick: '⚡ 快速',
  };

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        className="absolute left-16 bottom-12 w-96 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl z-50 max-h-[70vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 搜索 */}
        <div className="p-3 border-b border-gray-200 dark:border-gray-700">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索模型..."
            className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
            autoFocus
          />
        </div>

        {/* Tab: 按提供商 / 按任务 */}
        <div className="flex gap-1 px-3 pt-2">
          <button
            onClick={() => setGroupBy('provider')}
            className={`px-3 py-1 text-xs rounded-full transition-colors ${groupBy === 'provider' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
          >
            按提供商
          </button>
          <button
            onClick={() => setGroupBy('task')}
            className={`px-3 py-1 text-xs rounded-full transition-colors ${groupBy === 'task' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
          >
            按任务
          </button>
        </div>

        {/* 列表 */}
        <div className="flex-1 overflow-y-auto p-2">
          {groupBy === 'task' ? (
            <div className="space-y-1">
              {Object.entries(taskLabels).map(([type, label]) => {
                const modelId = (tasks as Record<string, string | undefined>)[type];
                const model = models.find((m) => m.id === modelId);
                return (
                  <div key={type} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{label}</span>
                      {model && (
                        <span className={`text-xs ${getProviderColor(model.provider)}`}>
                          {model.name || model.id}
                        </span>
                      )}
                    </div>
                    {type === currentTaskType && (
                      <span className="text-xs text-blue-500 font-medium">当前</span>
                    )}
                  </div>
                );
              })}
              <div className="border-t border-gray-200 dark:border-gray-700 my-2" />
              {filteredModels.map((model) => (
                <ModelRow key={model.id} model={model} isActive={model.id === currentModelId} onSelect={handleSwitch} />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {Object.entries(groupedByProvider).map(([provider, providerModels]) => (
                <div key={provider}>
                  <div className={`text-xs font-medium px-3 py-1 ${getProviderColor(provider)}`}>
                    {provider}
                  </div>
                  {providerModels.map((model) => (
                    <ModelRow key={model.id} model={model} isActive={model.id === currentModelId} onSelect={handleSwitch} />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 底部链接 */}
        <div className="p-2 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={() => { window.location.href = '/models'; onClose(); }}
            className="w-full px-3 py-2 text-xs text-center text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 rounded-lg transition-colors"
          >
            ⚙ 管理模型
          </button>
        </div>
      </div>
    </div>
  );
}

function ModelRow({ model, isActive, onSelect }: { model: ModelInfo; isActive: boolean; onSelect: (id: string) => void }) {
  return (
    <button
      onClick={() => onSelect(model.id)}
      className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition-colors ${
        isActive
          ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
          : 'hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-700 dark:text-gray-300'
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className={`text-xs font-medium shrink-0 ${getProviderColor(model.provider)}`}>
          {model.provider}
        </span>
        <span className="text-sm truncate">{model.name || model.id}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {isActive && <span className="text-xs text-blue-500 font-medium">● 当前</span>}
      </div>
    </button>
  );
}

export default ModelSwitcher;
