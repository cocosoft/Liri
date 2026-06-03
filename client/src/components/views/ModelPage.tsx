import { useEffect, useState, useMemo, useCallback } from 'react';
import { useModelStore } from '../../stores/modelStore';
import { useModelAdminStore } from '../../stores/modelAdminStore';
import { useConfigStore } from '../../stores/configStore';
import { SkeletonPulse } from '../common/Skeleton';
import TaskAssignment from '../modelAdmin/TaskAssignment';
import ModelMetaEditor from '../modelAdmin/ModelMetaEditor';
import ModelCompare from '../modelAdmin/ModelCompare';
import { QUICK_PRESETS, PROVIDER_TYPE_LABELS } from '../../config/providerPresets';
import { balanceService } from '../../services/balanceService';
import type { ProviderInfo, ProviderFormData, FetchedModel } from '../../types';

const TYPE_COLORS: Record<string, string> = {
  deepseek: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  openai: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  anthropic: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  google: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  ollama: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
};

const DEFAULT_COLOR = 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300';

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('zh-CN');
}

function ProviderPage() {
  const { models, isLoading: modelsLoading, loadModels, toggleModel, deleteModel } = useModelStore();
  const store = useModelAdminStore();
  const config = useConfigStore((s) => s.config);
  const isDark = config.theme === 'dark';

  const [activeTab, setActiveTab] = useState<'providers' | 'models' | 'tasks' | 'compare'>('providers');
  const [searchQuery, setSearchQuery] = useState('');
  const [showEditor, setShowEditor] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<ProviderFormData>({
    name: '', providerType: 'custom', baseUrl: '', apiKey: '', modelsUrl: '', notes: '', requiresAuth: true,
  });
  const [editMetaId, setEditMetaId] = useState<string | null>(null);
  const [fetchedModels, setFetchedModels] = useState<FetchedModel[] | null>(null);
  const [fetchingModelsId, setFetchingModelsId] = useState<string | null>(null);
  const [checkingBalanceId, setCheckingBalanceId] = useState<string | null>(null);

  useEffect(() => {
    loadModels();
    store.loadProviders();
  }, []);

  const filteredProviders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return store.providers;
    return store.providers.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      p.providerType.toLowerCase().includes(q) ||
      p.baseUrl.toLowerCase().includes(q) ||
      (p.notes || '').toLowerCase().includes(q)
    );
  }, [store.providers, searchQuery]);

  const openEditor = useCallback((provider?: ProviderInfo) => {
    if (provider) {
      setEditingId(provider.id);
      setFormData({
        name: provider.name,
        providerType: provider.providerType,
        baseUrl: provider.baseUrl,
        apiKey: '',
        modelsUrl: provider.modelsUrl || '',
        notes: provider.notes || '',
        requiresAuth: provider.requiresAuth,
      });
    } else {
      setEditingId(null);
      setFormData({ name: '', providerType: 'custom', baseUrl: '', apiKey: '', modelsUrl: '', notes: '', requiresAuth: true });
    }
    setShowEditor(true);
    setShowPresets(false);
  }, []);

  const applyPreset = useCallback((preset: typeof QUICK_PRESETS[0]) => {
    setEditingId(null);
    setFormData({ ...preset.form });
    setShowPresets(false);
    setShowEditor(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!formData.name.trim()) return;
    if (editingId) {
      await store.updateProvider(editingId, formData);
    } else {
      await store.createProvider(formData);
    }
    setShowEditor(false);
  }, [editingId, formData, store]);

  const handleDelete = useCallback(async (id: string, name: string) => {
    if (window.confirm(`确定要删除 Provider "${name}" 吗？`)) {
      await store.deleteProvider(id);
    }
  }, [store]);

  const handleFieldChange = useCallback((field: keyof ProviderFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleFetchModels = useCallback(async (id: string) => {
    setFetchingModelsId(id);
    setFetchedModels(null);
    try {
      const result = await store.fetchModels(id);
      if ('models' in result) {
        setFetchedModels(result.models);
      }
    } catch {
      // 静默
    } finally {
      setFetchingModelsId(null);
    }
  }, [store]);

  const handleCheckBalance = useCallback(async (provider: ProviderInfo) => {
    setCheckingBalanceId(provider.id);
    try {
      const result = await balanceService.check({ providerId: provider.id });
      if (result.success) {
        const lines = result.data.map((d) =>
          `${d.planName || ''}: ${d.remaining?.toFixed(2) ?? '--'} ${d.unit || ''}${d.total ? ` / ${d.total.toFixed(2)}` : ''}`,
        );
        alert(`余额 — ${result.provider}\n${lines.join('\n')}`);
      } else {
        alert(`余额查询失败: ${result.error}`);
      }
    } catch {
      alert('余额查询失败');
    } finally {
      setCheckingBalanceId(null);
    }
  }, []);

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900">
      <div className="max-w-6xl mx-auto p-6">
        {/* 标题栏 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">模型管理</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {store.providers.length} 个 Provider，{store.providers.filter((p) => p.isActive).length} 激活
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { setShowPresets(true); setShowEditor(false); }}
              className="px-3 py-2 text-sm bg-green-50 dark:bg-green-900/20 hover:bg-green-100 dark:hover:bg-green-900/40 text-green-700 dark:text-green-400 rounded-lg transition-colors">
              快速添加
            </button>
            <button onClick={() => openEditor()}
              className="px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors">
              + 新增 Provider
            </button>
          </div>
        </div>

        {/* 错误提示 */}
        {store.error && (
          <div className="mb-4 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
            {store.error}
            <button onClick={store.clearError} className="ml-2 underline">关闭</button>
          </div>
        )}

        {/* Tab */}
        <div className="flex gap-1 mb-4 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg w-fit">
          {(['providers', 'models', 'tasks', 'compare'] as const).map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm rounded-md transition-colors ${activeTab === tab ? 'bg-white dark:bg-gray-700 shadow-sm font-medium' : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'}`}>
              {{ providers: 'Provider 管理', models: '模型列表', tasks: '任务分工', compare: '模型对比' }[tab]}
            </button>
          ))}
        </div>

        {/* Provider Tab */}
        {activeTab === 'providers' && (
          <>
            <div className="mb-4">
              <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索 Provider 名称、类型、URL..."
                className="w-full px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>

            {store.isLoading ? (
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
                  {searchQuery ? '请尝试其他关键词' : '点击"+ 新增 Provider"开始配置'}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredProviders.map((p) => (
                  <div key={p.id} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 hover:border-gray-300 dark:hover:border-gray-600 transition-colors">
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${TYPE_COLORS[p.providerType] || DEFAULT_COLOR}`}>
                            {PROVIDER_TYPE_LABELS[p.providerType] || p.providerType}
                          </span>
                          <span className="font-medium text-gray-900 dark:text-gray-100">{p.name}</span>
                          {!p.requiresAuth && (
                            <span className="text-[10px] px-1 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded" title="本地供应商，无需 API Key">
                              本地
                            </span>
                          )}
                          <span className={`inline-block w-2 h-2 rounded-full ${p.isActive ? 'bg-green-400' : 'bg-gray-400'}`}
                            title={p.isActive ? '已启用' : '已停用'} />
                        </div>
                        <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{p.baseUrl}</p>
                        <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">
                          创建: {formatDate(p.createdAt)} | ID: {p.id.substring(0, 8)}...
                        </p>
                      </div>
                      <div className="flex items-center gap-2 ml-4 shrink-0">
                        <button onClick={() => handleFetchModels(p.id)}
                          disabled={fetchingModelsId === p.id || (p.requiresAuth && !p.apiKey)}
                          title={p.requiresAuth && !p.apiKey ? '需要先配置 API Key' : '获取可用模型列表'}
                          className="px-2 py-1.5 text-xs bg-indigo-50 dark:bg-indigo-900/20 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 rounded transition-colors disabled:opacity-30">
                          {fetchingModelsId === p.id ? '...' : '模型'}
                        </button>
                        <button onClick={async () => {
                          const result = await store.testConnection(p.id);
                          alert(result.success ? `连接成功 (${result.latencyMs}ms)` : `失败: ${result.error}`);
                        }}
                          disabled={p.requiresAuth && !p.apiKey}
                          title={p.requiresAuth && !p.apiKey ? '需要先配置 API Key' : '测试端点延迟'}
                          className="px-2 py-1.5 text-xs bg-teal-50 dark:bg-teal-900/20 hover:bg-teal-100 dark:hover:bg-teal-900/40 text-teal-600 dark:text-teal-400 rounded transition-colors disabled:opacity-30">
                          测试
                        </button>
                        <button onClick={() => store.toggleProvider(p.id)}
                          className="px-2 py-1.5 text-xs bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/40 text-amber-600 dark:text-amber-400 rounded transition-colors">
                          {p.isActive ? '停用' : '启用'}
                        </button>
                        <button onClick={() => handleCheckBalance(p)}
                          disabled={checkingBalanceId === p.id || (p.requiresAuth && !p.apiKey)}
                          title={p.requiresAuth && !p.apiKey ? '需要先配置 API Key' : '查询账户余额'}
                          className="px-2 py-1.5 text-xs bg-green-50 dark:bg-green-900/20 hover:bg-green-100 dark:hover:bg-green-900/40 text-green-600 dark:text-green-400 rounded transition-colors disabled:opacity-30">
                          {checkingBalanceId === p.id ? '...' : '余额'}
                        </button>
                        <button onClick={() => openEditor(p)}
                          className="px-2 py-1.5 text-xs bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 rounded transition-colors">
                          编辑
                        </button>
                        <button onClick={() => handleDelete(p.id, p.name)}
                          className="px-2 py-1.5 text-xs bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 rounded transition-colors">
                          删除
                        </button>
                      </div>
                    </div>
                    {/* 获取到的模型列表 */}
                    {fetchedModels && fetchingModelsId === p.id && (
                      <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
                        <p className="text-xs text-gray-500 mb-2">可用模型 ({fetchedModels.length}):</p>
                        <div className="flex flex-wrap gap-1">
                          {fetchedModels.slice(0, 20).map((m) => (
                            <span key={m.id} className="px-1.5 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded">
                              {m.id}{m.ownedBy ? ` [${m.ownedBy}]` : ''}
                            </span>
                          ))}
                          {fetchedModels.length > 20 && (
                            <span className="px-1.5 py-0.5 text-xs text-gray-400">+{fetchedModels.length - 20} 更多</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* 任务分工 Tab */}
        {activeTab === 'tasks' && (
          <div className="max-w-3xl mx-auto"><TaskAssignment /></div>
        )}

        {/* 模型对比 Tab */}
        {activeTab === 'compare' && (
          <div className="max-w-4xl mx-auto"><ModelCompare /></div>
        )}

        {/* 模型列表 Tab */}
        {activeTab === 'models' && (
          <>
            {modelsLoading ? (
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
                <p className="text-gray-400 dark:text-gray-500 text-sm">请在 Provider 管理页面添加供应商</p>
              </div>
            ) : (
              <div className="space-y-2">
                {models.map((model) => (
                  <div key={model.id} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 hover:border-gray-300 dark:hover:border-gray-600 transition-colors">
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 text-xs rounded-full font-medium shrink-0 ${TYPE_COLORS[model.provider] || DEFAULT_COLOR}`}>
                            {model.provider}
                          </span>
                          <h3 className="font-medium text-gray-900 dark:text-gray-100 truncate">{model.name || model.id}</h3>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5">
                          <span className="text-xs text-gray-400 dark:text-gray-500">
                            {model.context_length >= 1000
                              ? `${(model.context_length / 1000).toFixed(0)}K`
                              : model.context_length} tokens
                          </span>
                          <span className="text-xs text-gray-400 dark:text-gray-500">{model.type}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 ml-4 shrink-0">
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input type="checkbox" checked={model.enabled} onChange={() => toggleModel(model.id, !model.enabled)} className="sr-only peer" />
                          <div className="w-9 h-5 bg-gray-200 dark:bg-gray-600 rounded-full peer peer-checked:bg-blue-600 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all" />
                        </label>
                        <button onClick={() => setEditMetaId(model.id)}
                          className="px-2 py-1 text-xs bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 rounded">
                          元数据
                        </button>
                        <button onClick={() => deleteModel(model.id)}
                          className="px-2 py-1 text-xs bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 rounded">
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
                  <button key={preset.name} onClick={() => applyPreset(preset)}
                    className="p-3 bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-left transition-colors border border-transparent hover:border-blue-300 dark:hover:border-blue-600">
                    <div className={`inline-block px-2 py-0.5 text-xs rounded-full font-medium mb-1 ${TYPE_COLORS[preset.form.providerType] || DEFAULT_COLOR}`}>
                      {preset.name}
                    </div>
                    <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{preset.form.baseUrl}</p>
                  </button>
                ))}
              </div>
              <button onClick={() => setShowPresets(false)}
                className="mt-4 w-full px-4 py-2 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg transition-colors">
                取消
              </button>
            </div>
          </div>
        )}

        {/* 编辑/新增弹窗 */}
        {showEditor && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowEditor(false)}>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                {editingId ? '编辑 Provider' : '新增 Provider'}
              </h3>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">名称 *</label>
                  <input type="text" value={formData.name}
                    onChange={(e) => handleFieldChange('name', e.target.value)}
                    placeholder="例如: DeepSeek"
                    className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">类型</label>
                  <select value={formData.providerType}
                    onChange={(e) => handleFieldChange('providerType', e.target.value)}
                    className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm">
                    {Object.entries(PROVIDER_TYPE_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Base URL *</label>
                  <input type="text" value={formData.baseUrl}
                    onChange={(e) => handleFieldChange('baseUrl', e.target.value)}
                    placeholder="https://api.deepseek.com"
                    className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">API Key</label>
                  <input type="password" value={formData.apiKey}
                    onChange={(e) => handleFieldChange('apiKey', e.target.value)}
                    placeholder="sk-..."
                    className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">备注</label>
                  <input type="text" value={formData.notes}
                    onChange={(e) => handleFieldChange('notes', e.target.value)}
                    placeholder="可选备注"
                    className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm" />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="requiresAuth"
                    checked={!formData.requiresAuth}
                    onChange={(e) => setFormData({ ...formData, requiresAuth: !e.target.checked })}
                    className="rounded"
                  />
                  <label htmlFor="requiresAuth" className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'} cursor-pointer`}>
                    本地供应商（无需 API Key，如 Ollama / LM Studio）
                  </label>
                </div>
              </div>

              <div className="flex gap-2 mt-5">
                <button onClick={handleSave}
                  disabled={store.savingId !== null}
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm disabled:opacity-50">
                  {store.savingId !== null ? '保存中...' : '保存'}
                </button>
                <button onClick={() => setShowEditor(false)}
                  className="flex-1 px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg text-sm">
                  取消
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 模型元数据编辑器 */}
        {editMetaId && (
          <ModelMetaEditor
            modelId={editMetaId}
            modelName={editMetaId}
            onClose={() => setEditMetaId(null)}
            onSaved={() => { setEditMetaId(null); loadModels(); }}
          />
        )}
      </div>
    </div>
  );
}

export default ProviderPage;
