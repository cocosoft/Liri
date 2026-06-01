import { useEffect, useState, useMemo, useCallback } from 'react';
import { useModelStore } from '../../stores/modelStore';
import { useModelAdminStore, API_PRESETS, QUICK_PRESETS } from '../../stores/modelAdminStore';
import { SkeletonPulse } from '../common/Skeleton';
import TaskAssignment from '../modelAdmin/TaskAssignment';
import ModelMetaEditor from '../modelAdmin/ModelMetaEditor';
import ModelCompare from '../modelAdmin/ModelCompare';
import type { ProviderInfo, ProviderFormData, ChangePreview } from '../../types';

const PROVIDER_COLORS: Record<string, string> = {
  deepseek: 'text-red-600 dark:text-red-400',
  openai: 'text-green-600 dark:text-green-400',
  google: 'text-blue-600 dark:text-blue-400',
  qwen: 'text-indigo-600 dark:text-indigo-400',
  ollama: 'text-orange-600 dark:text-orange-400',
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

function ProviderPage() {
  const { models, isLoading, error, loadModels, toggleModel, deleteModel } = useModelStore();
  const adminStore = useModelAdminStore();

  const [activeTab, setActiveTab] = useState<'models' | 'providers' | 'tasks' | 'compare'>('providers');
  const [searchQuery, setSearchQuery] = useState('');
  const [showEditor, setShowEditor] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<ProviderFormData>({
    id: '', api: 'openai-completions', baseUrl: '', apiKey: '', models: '',
    inputPrice: '', outputPrice: '', cacheReadPrice: '', cacheWritePrice: '',
  });
  const [preview, setPreview] = useState<ChangePreview | null>(null);
  const [showPricing, setShowPricing] = useState(false);
  const [editMetaId, setEditMetaId] = useState<string | null>(null);

  useEffect(() => {
    loadModels();
    adminStore.loadProviders();
  }, []);

  const filteredProviders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return adminStore.providers;
    return adminStore.providers.filter((p) =>
      p.id.toLowerCase().includes(q) ||
      p.api.toLowerCase().includes(q) ||
      p.baseUrl.toLowerCase().includes(q) ||
      p.modelIds.some((m) => m.toLowerCase().includes(q))
    );
  }, [adminStore.providers, searchQuery]);

  const providerStats = useMemo(() => ({
    providerCount: adminStore.providers.length,
    modelCount: adminStore.providers.reduce((sum, p) => sum + p.modelIds.length, 0),
  }), [adminStore.providers]);

  const openEditor = useCallback((provider?: ProviderInfo) => {
    if (provider) {
      setEditingId(provider.id);
      setFormData({
        id: provider.id,
        api: provider.api,
        baseUrl: provider.baseUrl,
        apiKey: '',
        models: provider.modelIds.join('\n'),
      });
      setPreview(adminStore.generatePreview(provider.id, {
        id: provider.id,
        api: provider.api,
        baseUrl: provider.baseUrl,
        apiKey: '',
        models: provider.modelIds.join('\n'),
      }, provider));
    } else {
      setEditingId(null);
      setFormData({ id: '', api: 'openai-completions', baseUrl: '', apiKey: '', models: '' });
      setPreview(null);
    }
    setShowEditor(true);
    setShowPresets(false);
  }, [adminStore]);

  const applyPreset = useCallback((preset: typeof QUICK_PRESETS[0]) => {
    setEditingId(null);
    setFormData({
      id: preset.providerId,
      api: preset.api,
      baseUrl: preset.baseUrl,
      apiKey: '',
      models: preset.models.join('\n'),
    });
    setPreview(adminStore.generatePreview(preset.providerId, {
      id: preset.providerId,
      api: preset.api,
      baseUrl: preset.baseUrl,
      apiKey: '',
      models: preset.models.join('\n'),
    }, adminStore.providers.find((p) => p.id === preset.providerId)));
    setShowPresets(false);
    setShowEditor(true);
  }, [adminStore]);

  const handleSave = useCallback(async () => {
    const id = editingId || formData.id;
    if (!id.trim()) return;
    await adminStore.saveProvider(id, formData);
    setShowEditor(false);
  }, [editingId, formData, adminStore]);

  const handleDelete = useCallback(async (id: string) => {
    if (window.confirm(`确定要删除 Provider "${id}" 吗？`)) {
      await adminStore.deleteProvider(id);
    }
  }, [adminStore]);

  const handleSetDefault = useCallback(async (providerId: string, modelId: string) => {
    await adminStore.setDefaultModel(providerId, modelId);
  }, [adminStore]);

  const handleFormChange = useCallback((field: keyof ProviderFormData, value: string) => {
    const next = { ...formData, [field]: value };
    setFormData(next);

    const existing = editingId
      ? adminStore.providers.find((p) => p.id === editingId)
      : adminStore.providers.find((p) => p.id === next.id);
    setPreview(adminStore.generatePreview(editingId || next.id, next, existing));
  }, [formData, editingId, adminStore]);

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900">
      <div className="max-w-6xl mx-auto p-6">
        {/* 标题 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              模型管理
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {providerStats.providerCount} 个 Provider，{providerStats.modelCount} 个模型
              {adminStore.lastSyncTime && <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">定价同步: {adminStore.lastSyncTime}</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setShowPresets(true); setShowEditor(false); }}
              className="px-3 py-2 text-sm bg-green-50 dark:bg-green-900/20 hover:bg-green-100 dark:hover:bg-green-900/40 text-green-700 dark:text-green-400 rounded-lg transition-colors"
            >
              快速添加
            </button>
            <button
              onClick={() => adminStore.syncPricing()}
              disabled={adminStore.syncing}
              className="px-3 py-2 text-sm bg-purple-50 dark:bg-purple-900/20 hover:bg-purple-100 dark:hover:bg-purple-900/40 text-purple-700 dark:text-purple-400 rounded-lg transition-colors disabled:opacity-50"
            >
              {adminStore.syncing ? '同步中...' : '同步定价'}
            </button>
            <button
              onClick={() => adminStore.reloadConfig()}
              className="px-3 py-2 text-sm bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/40 text-amber-700 dark:text-amber-400 rounded-lg transition-colors"
            >
              刷新配置
            </button>
            <button
              onClick={async () => {
                try {
                  const { modelAdminService } = await import('../../services/modelAdminService');
                  const config = await modelAdminService.exportConfig();
                  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url; a.download = 'model-config.json'; a.click();
                  URL.revokeObjectURL(url);
                } catch (e) {
                  alert('导出失败: ' + (e instanceof Error ? e.message : String(e)));
                }
              }}
              className="px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 rounded-lg transition-colors"
            >
              导出配置
            </button>
            <button
              onClick={() => openEditor()}
              className="px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              + 新增 Provider
            </button>
          </div>
        </div>

        {/* 错误提示 */}
        {(error || adminStore.error) && (
          <div className="mb-4 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
            {error || adminStore.error}
          </div>
        )}

        {/* Tab 切换 */}
          <div className="flex gap-1 mb-4 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg w-fit">
            <button
              onClick={() => setActiveTab('providers')}
              className={`px-4 py-2 text-sm rounded-md transition-colors ${activeTab === 'providers' ? 'bg-white dark:bg-gray-700 shadow-sm font-medium' : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'}`}
            >
              Provider 管理
            </button>
            <button
              onClick={() => setActiveTab('tasks')}
              className={`px-4 py-2 text-sm rounded-md transition-colors ${activeTab === 'tasks' ? 'bg-white dark:bg-gray-700 shadow-sm font-medium' : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'}`}
            >
              任务分工
            </button>
            <button
               onClick={() => setActiveTab('models')}
               className={`px-4 py-2 text-sm rounded-md transition-colors ${activeTab === 'models' ? 'bg-white dark:bg-gray-700 shadow-sm font-medium' : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'}`}
             >
               模型列表
             </button>
             <button
               onClick={() => setActiveTab('compare')}
               className={`px-4 py-2 text-sm rounded-md transition-colors ${activeTab === 'compare' ? 'bg-white dark:bg-gray-700 shadow-sm font-medium' : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'}`}
             >
               模型对比
             </button>
           </div>

        {/* Provider Tab */}
        {activeTab === 'providers' && (
          <>
            {/* 搜索 */}
            <div className="mb-4">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索 Provider ID、协议、Base URL 或模型..."
                className="w-full px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
              />
            </div>

            {/* Provider 列表 */}
            {adminStore.isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                    <SkeletonPulse className="h-5 w-32 mb-3" />
                    <SkeletonPulse className="h-3 w-64" />
                  </div>
                ))}
              </div>
            ) : filteredProviders.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-gray-400 dark:text-gray-500 text-lg mb-2">
                  {searchQuery ? '未找到匹配的 Provider' : '暂无 Provider'}
                </p>
                <p className="text-gray-400 dark:text-gray-500 text-sm mb-4">
                  {searchQuery ? '请尝试其他关键词' : '点击"快速添加"或"+ 新增 Provider"开始配置'}
                </p>
                {!searchQuery && (
                  <div className="flex justify-center gap-3">
                    {QUICK_PRESETS.slice(0, 4).map((preset) => (
                      <button
                        key={preset.providerId}
                        onClick={() => applyPreset(preset)}
                        className="px-3 py-1.5 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                      >
                        {preset.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {filteredProviders.map((provider) => (
                  <div
                    key={provider.id}
                    className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`px-2 py-0.5 text-xs rounded-full font-medium shrink-0 ${PROVIDER_COLORS[provider.id] || DEFAULT_PROVIDER_COLOR}`}>
                            {provider.id}
                          </span>
                          <span className="text-xs text-gray-400 dark:text-gray-500">
                            {provider.api}
                          </span>
                        </div>
                        <p className="text-xs text-gray-400 dark:text-gray-500 truncate max-w-xl">
                          {provider.baseUrl || '-'}
                        </p>
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {provider.modelIds.slice(0, 5).map((mid) => (
                            <span key={mid} className="px-1.5 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded">
                              {mid}
                            </span>
                          ))}
                          {provider.modelIds.length > 5 && (
                            <span className="px-1.5 py-0.5 text-xs text-gray-400">
                              +{provider.modelIds.length - 5}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 ml-4 shrink-0">
                        <button
                          onClick={() => handleSetDefault(provider.id, provider.modelIds[0])}
                          disabled={!provider.modelIds[0]}
                          className="px-2 py-1.5 text-xs bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/40 text-blue-600 dark:text-blue-400 rounded transition-colors disabled:opacity-40"
                          title="设为主力模型"
                        >
                          默认
                        </button>
                        <button
                          onClick={async () => {
                            if (!provider.modelIds[0]) return;
                            const result = await adminStore.testConnection(provider.id, provider.modelIds[0]);
                            alert(result.success ? '连接成功！' : `连接失败: ${result.error}`);
                          }}
                          disabled={adminStore.testingId === provider.id || !provider.modelIds[0]}
                          className="px-2 py-1.5 text-xs bg-teal-50 dark:bg-teal-900/20 hover:bg-teal-100 dark:hover:bg-teal-900/40 text-teal-600 dark:text-teal-400 rounded transition-colors disabled:opacity-40"
                        >
                          {adminStore.testingId === provider.id ? '测试中...' : '测试'}
                        </button>
                        <button
                          onClick={() => openEditor(provider)}
                          className="px-2 py-1.5 text-xs bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 rounded transition-colors"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => handleDelete(provider.id)}
                          className="px-2 py-1.5 text-xs bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 rounded transition-colors"
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* 任务分工 Tab */}
        {activeTab === 'tasks' && (
          <div className="max-w-3xl mx-auto">
            <TaskAssignment />
          </div>
        )}

        {/* 模型对比 Tab */}
        {activeTab === 'compare' && (
          <div className="max-w-4xl mx-auto">
            <ModelCompare />
          </div>
        )}

        {/* 模型列表 Tab */}
        {activeTab === 'models' && (
          <>
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
                <p className="text-gray-400 dark:text-gray-500 text-sm">请先在上方配置 Provider</p>
              </div>
            ) : (
              <div className="space-y-2">
                {models.map((model) => (
                  <div
                    key={model.id}
                    className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 text-xs rounded-full font-medium shrink-0 ${PROVIDER_COLORS[model.provider] || DEFAULT_PROVIDER_COLOR}`}>
                            {model.provider}
                          </span>
                          <h3 className="font-medium text-gray-900 dark:text-gray-100 truncate">
                            {model.name || model.id}
                          </h3>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5">
                          <span className="text-xs text-gray-400 dark:text-gray-500">
                            🧠 {formatContextLength(model.context_length)}
                          </span>
                          <span className="text-xs text-gray-400 dark:text-gray-500">
                            {TYPE_LABELS[model.type] || model.type}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 ml-4 shrink-0">
                        <label className="relative inline-flex items-center cursor-pointer" title={model.enabled ? '点击禁用' : '点击启用'}>
                          <input
                            type="checkbox"
                            checked={model.enabled}
                            onChange={() => toggleModel(model.id, !model.enabled)}
                            className="sr-only peer"
                          />
                          <div className="w-9 h-5 bg-gray-200 dark:bg-gray-600 rounded-full peer peer-checked:bg-blue-600 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all" />
                        </label>
                        <button
                          onClick={() => setEditMetaId(model.id)}
                          className="px-2 py-1 text-xs bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 rounded"
                          title="编辑元数据"
                        >
                          元数据
                        </button>
                        <button
                          onClick={() => deleteModel(model.id)}
                          className="px-2 py-1 text-xs bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 rounded"
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* 快速预设面板 */}
        {showPresets && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowPresets(false)}>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg mx-4 p-6" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">快速添加 Provider</h3>
              <div className="grid grid-cols-2 gap-3">
                {QUICK_PRESETS.map((preset) => (
                  <button
                    key={preset.providerId}
                    onClick={() => applyPreset(preset)}
                    className="p-3 bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-left transition-colors border border-transparent hover:border-blue-300 dark:hover:border-blue-600"
                  >
                    <div className={`inline-block px-2 py-0.5 text-xs rounded-full font-medium mb-1 ${PROVIDER_COLORS[preset.providerId] || DEFAULT_PROVIDER_COLOR}`}>
                      {preset.name}
                    </div>
                    <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{preset.baseUrl}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{preset.models.join(', ')}</p>
                  </button>
                ))}
              </div>
              <button
                onClick={() => setShowPresets(false)}
                className="mt-4 w-full px-4 py-2 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        )}

        {/* 编辑/新增 Provider 弹窗 */}
        {showEditor && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowEditor(false)}>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg mx-4 p-6" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                {editingId ? `编辑 Provider: ${editingId}` : '新增 Provider'}
              </h3>

              <div className="space-y-4">
                {/* Provider ID */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Provider ID</label>
                  <input
                    type="text"
                    value={formData.id}
                    onChange={(e) => handleFormChange('id', e.target.value)}
                    disabled={!!editingId}
                    placeholder="例如: openai, deepseek, my-custom"
                    className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  />
                </div>

                {/* API 协议 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">API 协议</label>
                  <select
                    value={formData.api}
                    onChange={(e) => handleFormChange('api', e.target.value)}
                    className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {API_PRESETS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>

                {/* Base URL */}
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Base URL</label>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!formData.baseUrl.trim()) return;
                        try {
                          const { modelDiscoveryService } = await import('../../services/modelDiscoveryService');
                          const ids = await modelDiscoveryService.discoverFromEndpoint(formData.baseUrl.trim());
                          if (ids.length > 0) {
                            handleFormChange('models', ids.join('\n'));
                          }
                        } catch (e) {
                          alert('自动发现失败: ' + (e instanceof Error ? e.message : String(e)));
                        }
                      }}
                      className="text-xs text-blue-500 hover:text-blue-700 dark:hover:text-blue-400"
                    >
                      自动发现
                    </button>
                  </div>
                  <input
                    type="text"
                    value={formData.baseUrl}
                    onChange={(e) => handleFormChange('baseUrl', e.target.value)}
                    placeholder="https://api.openai.com/v1"
                    className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* API Key */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    API Key {editingId ? '(留空则保持不变)' : ''}
                  </label>
                  <input
                    type="password"
                    value={formData.apiKey}
                    onChange={(e) => handleFormChange('apiKey', e.target.value)}
                    placeholder={editingId ? '输入新 API Key 以覆盖' : 'sk-...'}
                    className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* 模型列表 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">模型列表（每行一个）</label>
                  <textarea
                    value={formData.models}
                    onChange={(e) => handleFormChange('models', e.target.value)}
                    placeholder="gpt-4o&#10;gpt-4o-mini&#10;gpt-4-turbo"
                    rows={4}
                    className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                  />
                </div>

                {/* 定价配置（可折叠） */}
                <div>
                  <button
                    type="button"
                    onClick={() => setShowPricing(!showPricing)}
                    className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                  >
                    <svg className={`w-3 h-3 transition-transform ${showPricing ? 'rotate-90' : ''}`} fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
                    </svg>
                    定价配置（可选）
                  </button>
                  {showPricing && (
                    <div className="mt-2 grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">输入价格（$ / 1M tokens）</label>
                        <input
                          type="text" value={formData.inputPrice || ''}
                          onChange={(e) => handleFormChange('inputPrice', e.target.value)}
                          placeholder="如: 3.0" className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">输出价格（$ / 1M tokens）</label>
                        <input
                          type="text" value={formData.outputPrice || ''}
                          onChange={(e) => handleFormChange('outputPrice', e.target.value)}
                          placeholder="如: 15.0" className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">缓存读价格</label>
                        <input
                          type="text" value={formData.cacheReadPrice || ''}
                          onChange={(e) => handleFormChange('cacheReadPrice', e.target.value)}
                          placeholder="如: 0.3" className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">缓存写价格</label>
                        <input
                          type="text" value={formData.cacheWritePrice || ''}
                          onChange={(e) => handleFormChange('cacheWritePrice', e.target.value)}
                          placeholder="如: 3.75" className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* 变更预览 */}
                {preview && preview.hasChanges && (
                  <div className="p-3 bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 rounded-lg">
                    <h4 className="text-sm font-medium text-blue-700 dark:text-blue-400 mb-2">变更预览</h4>
                    {preview.warnings.length > 0 && (
                      <ul className="mb-2 space-y-1">
                        {preview.warnings.map((w, i) => (
                          <li key={i} className="text-xs text-amber-600 dark:text-amber-400">⚠ {w}</li>
                        ))}
                      </ul>
                    )}
                    {preview.apiDiff?.changed && (
                      <p className="text-xs text-gray-600 dark:text-gray-400">
                        API: <span className="line-through text-red-500">{preview.apiDiff.before}</span> → <span className="text-green-500">{preview.apiDiff.after}</span>
                      </p>
                    )}
                    {preview.baseUrlDiff?.changed && (
                      <p className="text-xs text-gray-600 dark:text-gray-400">
                        Base URL: <span className="line-through text-red-500">{preview.baseUrlDiff.before}</span> → <span className="text-green-500">{preview.baseUrlDiff.after}</span>
                      </p>
                    )}
                    {preview.modelDiff?.changed && (
                      <p className="text-xs text-gray-600 dark:text-gray-400">
                        模型: {preview.modelDiff.beforeCount} 个 → {preview.modelDiff.afterCount} 个
                        {preview.modelDiff.added.length > 0 && <span className="text-green-500"> (+{preview.modelDiff.added.length})</span>}
                        {preview.modelDiff.removed.length > 0 && <span className="text-red-500"> (-{preview.modelDiff.removed.length})</span>}
                      </p>
                    )}
                    {preview.pricingDiff?.changed && (
                      <p className="text-xs text-gray-600 dark:text-gray-400">
                        定价:{' '}
                        {preview.pricingDiff.inputPrice && <span>输入: ${preview.pricingDiff.inputPrice}/1M</span>}
                        {preview.pricingDiff.inputPrice && preview.pricingDiff.outputPrice && <span> / </span>}
                        {preview.pricingDiff.outputPrice && <span>输出: ${preview.pricingDiff.outputPrice}/1M</span>}
                      </p>
                    )}
                    {preview.inferredPrimary && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        自动设置为默认模型: {preview.inferredPrimary}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* 操作按钮 */}
              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => setShowEditor(false)}
                  className="px-4 py-2 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleSave}
                  disabled={adminStore.savingId !== null || !formData.id.trim()}
                  className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg transition-colors"
                >
                  {adminStore.savingId !== null ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      {editMetaId && (() => {
        const model = models.find((m) => m.id === editMetaId);
        return model ? (
          <ModelMetaEditor
            modelId={model.id}
            modelName={model.name || model.id}
            onClose={() => setEditMetaId(null)}
            onSaved={() => { loadModels(); adminStore.reloadConfig(); }}
          />
        ) : null;
      })()}
    </div>
  );
}

export default ProviderPage;
