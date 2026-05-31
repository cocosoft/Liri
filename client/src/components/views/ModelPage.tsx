import { useEffect } from 'react';
import { useModelStore } from '../../stores/modelStore';
import { SkeletonPulse } from '../common/Skeleton';

const PROVIDER_COLORS: Record<string, string> = {
  openai: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  anthropic: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  google: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  azure: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
  ollama: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  openrouter: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
  deepseek: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  moonshot: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  together: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400',
  fireworks: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  groq: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
};

const DEFAULT_PROVIDER_COLOR = 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-400';

const TYPE_LABELS: Record<string, string> = {
  chat: '对话',
  embedding: '嵌入',
  image: '图片',
};

function formatContextLength(length: number): string {
  if (length >= 1_000_000) return `${(length / 1_000_000).toFixed(0)}M`;
  if (length >= 1_000) return `${(length / 1_000).toFixed(0)}K`;
  return String(length);
}

function ModelPage() {
  const { models, isLoading, error, loadModels, toggleModel, deleteModel } = useModelStore();

  useEffect(() => {
    loadModels();
  }, []);

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900">
      <div className="max-w-5xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            模型管理
          </h2>
        </div>

        {error && (
          <div className="mb-4 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
                <SkeletonPulse className="h-5 w-48 mb-3" />
                <SkeletonPulse className="h-3 w-32" />
              </div>
            ))}
          </div>
        ) : models.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-gray-400 dark:text-gray-500 text-lg mb-2">暂无可用模型</p>
            <p className="text-gray-400 dark:text-gray-500 text-sm">请配置 AI 提供商后刷新</p>
          </div>
        ) : (
          <div className="space-y-2">
            {models.map((model) => (
              <div
                key={model.id}
                className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 flex items-center justify-between hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`px-2 py-0.5 text-xs rounded-full font-medium shrink-0 ${PROVIDER_COLORS[model.provider] || DEFAULT_PROVIDER_COLOR}`}>
                    {model.provider}
                  </span>
                  <div className="min-w-0">
                    <h3 className="font-medium text-gray-900 dark:text-gray-100 truncate">
                      {model.name || model.id}
                    </h3>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        {TYPE_LABELS[model.type] || model.type}
                      </span>
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        上下文: {formatContextLength(model.context_length)}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 ml-4 shrink-0">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={model.enabled}
                      onChange={() => toggleModel(model.id, !model.enabled)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-gray-200 dark:bg-gray-600 rounded-full peer peer-checked:bg-blue-600 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all" />
                  </label>
                  <button
                    onClick={() => deleteModel(model.id)}
                    className="px-2 py-1 text-xs bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 rounded"
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default ModelPage;
