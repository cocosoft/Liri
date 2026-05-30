import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useConfigStore } from '../../stores/configStore';
import { chatService } from '../../services/chatService';
import { appConfigService } from '../../services/appConfigService';
import { setBackendPort as setBackendUrlPort } from '../../services/backendUrl';
import { http } from '../../services/httpClient';
import { useAutoUpdate } from '../../hooks/useAutoUpdate';
import AutoUpdatePanel from '../settings/AutoUpdatePanel';
import type { BackendStatus } from '../../types';

function SettingsPage() {
  const navigate = useNavigate();
  const { config, setConfig } = useConfigStore();
  const [backendStatus, setBackendStatus] = useState<BackendStatus>({
    running: false,
    port: null,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backendPort, setBackendPort] = useState('7890');
  const [portSaved, setPortSaved] = useState(false);
  const [dataDirectory, setDataDirectory] = useState('');
  const [configuredDirectory, setConfiguredDirectory] = useState<string | null>(null);
  const [defaultDirectory, setDefaultDirectory] = useState('');
  const [dataDirSaved, setDataDirSaved] = useState(false);
  const [dataDirError, setDataDirError] = useState<string | null>(null);
  const [migrateData, setMigrateData] = useState(true);
  const [migrationResult, setMigrationResult] = useState<{ copied: number; skipped: number; errors: string[] } | null>(null);

  const [autoUpdateConfig, setAutoUpdateConfig] = useState<{
    enabled: boolean;
    checkIntervalMs: number;
    channel: 'stable' | 'beta';
    checkOnStartup: boolean;
    verbose: boolean;
  }>({
    enabled: true,
    checkIntervalMs: 86400000,
    channel: 'stable',
    checkOnStartup: true,
    verbose: false,
  });

  const {
    checking,
    downloading,
    result,
    error: updateError,
    check,
    install,
    startPeriodicCheck,
    stopPeriodicCheck,
  } = useAutoUpdate();

  const isDark = config.theme === 'dark';

  useEffect(() => {
    loadPersistedPort();
    loadDataDirectory();
    checkBackendStatus();
    const interval = setInterval(checkBackendStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (autoUpdateConfig.enabled && autoUpdateConfig.checkOnStartup) {
      check().catch(() => {});
      startPeriodicCheck(autoUpdateConfig.checkIntervalMs);
    } else {
      stopPeriodicCheck();
    }
    return () => stopPeriodicCheck();
  }, [autoUpdateConfig.enabled, autoUpdateConfig.checkIntervalMs, autoUpdateConfig.checkOnStartup]);

  interface DataDirectoryResponse {
    currentDirectory: string;
    configuredDirectory: string | null;
    defaultDirectory: string;
  }

  interface SetDataDirectoryResponse {
    success: boolean;
    message: string;
    directory: string;
    migration?: {
      copied: number;
      skipped: number;
      errors: string[];
    };
  }

  const loadDataDirectory = async () => {
    try {
      const response = await http.get<DataDirectoryResponse>('/v1/settings/data-directory');
      if (response) {
        setDataDirectory(response.currentDirectory || '');
        setConfiguredDirectory(response.configuredDirectory || null);
        setDefaultDirectory(response.defaultDirectory || '');
      }
    } catch (e) {
      console.error('加载数据目录失败', e);
    }
  };

  const handleSaveDataDirectory = async () => {
    if (!dataDirectory.trim()) {
      setDataDirError('目录路径不能为空');
      return;
    }

    setDataDirSaved(false);
    setDataDirError(null);
    setMigrationResult(null);

    try {
      const response = await http.put<SetDataDirectoryResponse>('/v1/settings/data-directory', {
        directory: dataDirectory,
        migrate: migrateData,
      });

      if (response && response.success) {
        setConfiguredDirectory(dataDirectory);
        setDataDirSaved(true);
        if (response.migration) {
          setMigrationResult(response.migration);
        }
        setTimeout(() => {
          setDataDirSaved(false);
          setMigrationResult(null);
        }, 5000);
      }
    } catch (e: any) {
      setDataDirError(e.response?.data?.error?.message || '保存失败');
    }
  };

  const handleResetDataDirectory = async () => {
    try {
      await http.put('/v1/settings/data-directory', {
        directory: defaultDirectory,
        migrate: migrateData,
      });
      setDataDirectory(defaultDirectory);
      setConfiguredDirectory(null);
      setDataDirSaved(true);
      setTimeout(() => setDataDirSaved(false), 3000);
    } catch (e) {
      console.error('重置数据目录失败', e);
    }
  };

  const loadPersistedPort = async () => {
    try {
      const appConfig = await appConfigService.get();
      setBackendPort(String(appConfig.httpPort));
    } catch {
      // 使用默认值
    }
  };

  const handleSavePort = async () => {
    const port = parseInt(backendPort, 10);
    if (isNaN(port) || port < 1024 || port > 65535) {
      setError('端口号必须在 1024-65535 之间');
      return;
    }

    setPortSaved(false);
    setError(null);

    try {
      await appConfigService.set({
        ...(await appConfigService.get()),
        httpPort: port,
      });

      setBackendUrlPort(port);

      const isTauri = typeof window !== 'undefined' && '__TAURI__' in window;
      if (isTauri) {
        try {
          const core = await import('@tauri-apps/api/core');
          if (core && typeof core.invoke === 'function') {
            await core.invoke('set_backend_port', { port });
          }
        } catch {
          // Tauri API 不可用，跳过
        }
      }

      setPortSaved(true);
      setTimeout(() => setPortSaved(false), 3000);
    } catch (e) {
      setError(String(e));
    }
  };

  const checkBackendStatus = async () => {
    try {
      const status = await chatService.getBackendStatus();
      setBackendStatus(status);
      if (status.port) {
        setBackendPort(String(status.port));
      }
    } catch {
      setBackendStatus({ running: false, port: null });
    }
  };

  const handleStartBackend = async () => {
    setLoading(true);
    setError(null);
    try {
      await chatService.startBackend();
      await checkBackendStatus();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleStopBackend = async () => {
    setLoading(true);
    setError(null);
    try {
      await chatService.stopBackend();
      await checkBackendStatus();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const toggleTheme = () => {
    setConfig('theme', isDark ? 'light' : 'dark');
  };

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900">
      <div className="max-w-4xl mx-auto p-6">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">
          设置
        </h2>

        <div className="space-y-6">
          {/* 主题设置 */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              外观
            </h3>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-700 dark:text-gray-300">主题模式</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  当前: {isDark ? '深色模式' : '浅色模式'}
                </div>
              </div>
              <button
                onClick={toggleTheme}
                className={`relative w-12 h-6 rounded-full transition-colors ${
                  isDark ? 'bg-blue-500' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform flex items-center justify-center text-xs ${
                    isDark ? 'translate-x-6' : 'translate-x-0'
                  }`}
                >
                  {isDark ? '🌙' : '☀️'}
                </span>
              </button>
            </div>
          </div>

          {/* 后端服务 */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              后端服务
            </h3>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600 dark:text-gray-400">状态</span>
                <span
                  className={`px-2 py-0.5 text-xs rounded-full font-medium ${
                    backendStatus.running
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                      : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                  }`}
                >
                  {backendStatus.running ? '运行中' : '已停止'}
                </span>
              </div>

              {backendStatus.running && backendStatus.port && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600 dark:text-gray-400">端口</span>
                  <span className="text-sm text-gray-900 dark:text-gray-100">
                    {backendStatus.port}
                  </span>
                </div>
              )}

              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-600 dark:text-gray-400">端口号</label>
                <input
                  type="number"
                  value={backendPort}
                  onChange={(e) => setBackendPort(e.target.value)}
                  className="flex-1 max-w-[120px] px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  disabled={backendStatus.running}
                />
                <button
                  onClick={handleSavePort}
                  disabled={backendStatus.running}
                  className="px-3 py-1 text-sm bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded"
                >
                  应用端口
                </button>
                {portSaved && (
                  <span className="text-xs text-green-500">已保存</span>
                )}
              </div>

              {error && (
                <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded">
                  {error}
                </div>
              )}

              <div className="flex items-center gap-2">
                {backendStatus.running ? (
                  <button
                    onClick={handleStopBackend}
                    disabled={loading}
                    className="px-4 py-1.5 text-sm bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded"
                  >
                    {loading ? '处理中...' : '停止'}
                  </button>
                ) : (
                  <button
                    onClick={handleStartBackend}
                    disabled={loading}
                    className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded"
                  >
                    {loading ? '处理中...' : '启动'}
                  </button>
                )}
                <button
                  onClick={checkBackendStatus}
                  className="px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded"
                >
                  刷新状态
                </button>
              </div>
            </div>
          </div>

          {/* 模型设置 */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              模型
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  API Base URL
                </label>
                <input
                  type="text"
                  value={(config.apiBaseUrl as string) || ''}
                  onChange={(e) => setConfig('apiBaseUrl', e.target.value)}
                  placeholder="http://127.0.0.1:7890"
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  API Key
                </label>
                <input
                  type="password"
                  value={(config.apiKey as string) || ''}
                  onChange={(e) => setConfig('apiKey', e.target.value)}
                  placeholder="sk-..."
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  默认模型
                </label>
                <input
                  type="text"
                  value={(config.defaultModel as string) || ''}
                  onChange={(e) => setConfig('defaultModel', e.target.value)}
                  placeholder="pyapp-default"
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {/* 关于 */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              关于
            </h3>
            <div className="text-sm text-gray-500 dark:text-gray-400 space-y-1">
              <p>PY_APP Client</p>
              <p>后端状态: {backendStatus.running ? `运行中 (端口 ${backendStatus.port})` : '未运行'}</p>
            </div>
          </div>

          {/* 系统维护 */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              系统维护
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <button
                onClick={() => navigate('/plugins')}
                className="flex items-center gap-2 px-3 py-2 rounded bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
              >
                <span>🔌</span>
                <span className="text-sm text-gray-700 dark:text-gray-300">插件管理</span>
              </button>
              <button
                onClick={() => navigate('/oauth')}
                className="flex items-center gap-2 px-3 py-2 rounded bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
              >
                <span>🔑</span>
                <span className="text-sm text-gray-700 dark:text-gray-300">OAuth认证</span>
              </button>
              <button
                onClick={() => navigate('/media')}
                className="flex items-center gap-2 px-3 py-2 rounded bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
              >
                <span>📺</span>
                <span className="text-sm text-gray-700 dark:text-gray-300">媒体管理</span>
              </button>
              <button
                onClick={() => navigate('/autoreply')}
                className="flex items-center gap-2 px-3 py-2 rounded bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
              >
                <span>🔄</span>
                <span className="text-sm text-gray-700 dark:text-gray-300">自动回复</span>
              </button>
              <button
                onClick={() => navigate('/sandbox')}
                className="flex items-center gap-2 px-3 py-2 rounded bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
              >
                <span>🏜️</span>
                <span className="text-sm text-gray-700 dark:text-gray-300">沙箱管理</span>
              </button>
              <button
                onClick={() => navigate('/channels')}
                className="flex items-center gap-2 px-3 py-2 rounded bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
              >
                <span>📡</span>
                <span className="text-sm text-gray-700 dark:text-gray-300">消息渠道</span>
              </button>
              <button
                onClick={() => navigate('/permissions')}
                className="flex items-center gap-2 px-3 py-2 rounded bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
              >
                <span>🔐</span>
                <span className="text-sm text-gray-700 dark:text-gray-300">权限管理</span>
              </button>
            </div>
          </div>

          {/* 自动更新 */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <AutoUpdatePanel
              isDark={isDark}
              autoUpdate={autoUpdateConfig}
              onUpdate={(updates) =>
                setAutoUpdateConfig((prev) => ({ ...prev, ...updates }))
              }
            />

            {result?.available && (
              <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-blue-700 dark:text-blue-300">
                      发现新版本 {result.latestVersion}
                    </p>
                    {result.body && (
                      <p className="text-xs text-blue-600 dark:text-blue-400 mt-1 line-clamp-2">
                        {result.body}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={install}
                    disabled={downloading}
                    className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded whitespace-nowrap"
                  >
                    {downloading ? '下载中...' : '立即更新'}
                  </button>
                </div>
              </div>
            )}

            {!result?.available && !checking && (
              <div className="mt-3 flex items-center justify-between">
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {result === null ? '尚未检查更新' : '已是最新版本'}
                </span>
                <button
                  onClick={check}
                  disabled={checking}
                  className="px-3 py-1 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 text-gray-700 dark:text-gray-300 rounded"
                >
                  {checking ? '检查中...' : '检查更新'}
                </button>
              </div>
            )}

            {updateError && (
              <p className="mt-2 text-xs text-red-500">{updateError}</p>
            )}
          </div>

          {/* 数据存储 */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              数据存储
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  用户数据目录
                </label>
                <input
                  type="text"
                  value={dataDirectory}
                  onChange={(e) => setDataDirectory(e.target.value)}
                  placeholder="请输入数据目录路径"
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {configuredDirectory && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    当前已配置自定义目录
                  </p>
                )}
                {!configuredDirectory && defaultDirectory && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    默认目录: {defaultDirectory}
                  </p>
                )}
                {dataDirError && (
                  <p className="text-xs text-red-500 mt-1">{dataDirError}</p>
                )}
              </div>
              
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="migrateData"
                    checked={migrateData}
                    onChange={(e) => setMigrateData(e.target.checked)}
                    className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <label htmlFor="migrateData" className="text-sm text-gray-700 dark:text-gray-300">
                    迁移现有数据
                  </label>
                </div>
              </div>
              
              {migrationResult && (
                <div className={`p-3 rounded ${
                  migrationResult.errors.length > 0 
                    ? 'bg-yellow-50 dark:bg-yellow-900/20' 
                    : 'bg-green-50 dark:bg-green-900/20'
                }`}>
                  <p className="text-sm text-gray-700 dark:text-gray-300">
                    数据迁移完成：
                    <span className="font-medium"> {migrationResult.copied}</span> 个文件已迁移，
                    <span className="font-medium"> {migrationResult.skipped}</span> 个文件已存在（跳过）
                  </p>
                  {migrationResult.errors.length > 0 && (
                    <div className="mt-2">
                      <p className="text-xs text-red-500">迁移错误:</p>
                      {migrationResult.errors.slice(0, 3).map((err, idx) => (
                        <p key={idx} className="text-xs text-red-500">{err}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}
              
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSaveDataDirectory}
                  className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded"
                >
                  应用
                </button>
                {configuredDirectory && (
                  <button
                    onClick={handleResetDataDirectory}
                    className="px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded"
                  >
                    恢复默认
                  </button>
                )}
                {dataDirSaved && !migrationResult && (
                  <span className="text-xs text-green-500">已保存</span>
                )}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                注意：勾选"迁移现有数据"选项后，系统将自动将原目录中的文件复制到新目录。已存在的文件不会被覆盖。
              </p>
            </div>
          </div>

          {/* 智能体配置 */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              智能体配置
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <button
                onClick={() => navigate('/memory')}
                className="flex items-center gap-2 px-3 py-2 rounded bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
              >
                <span>🧠</span>
                <span className="text-sm text-gray-700 dark:text-gray-300">记忆管理</span>
              </button>
              <button
                onClick={() => navigate('/skills')}
                className="flex items-center gap-2 px-3 py-2 rounded bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
              >
                <span>⚡</span>
                <span className="text-sm text-gray-700 dark:text-gray-300">技能管理</span>
              </button>
              <button
                onClick={() => navigate('/agent')}
                className="flex items-center gap-2 px-3 py-2 rounded bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
              >
                <span>🤖</span>
                <span className="text-sm text-gray-700 dark:text-gray-300">Agent管理</span>
              </button>
              <button
                onClick={() => navigate('/logs')}
                className="flex items-center gap-2 px-3 py-2 rounded bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
              >
                <span>📝</span>
                <span className="text-sm text-gray-700 dark:text-gray-300">日志查看</span>
              </button>
              <button
                onClick={() => navigate('/buddy')}
                className="flex items-center gap-2 px-3 py-2 rounded bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
              >
                <span>🤝</span>
                <span className="text-sm text-gray-700 dark:text-gray-300">伙伴管理</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SettingsPage;
