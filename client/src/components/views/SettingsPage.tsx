import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useConfigStore } from '../../stores/configStore';
import { chatService } from '../../services/chatService';
import { appConfigService } from '../../services/appConfigService';
import { setBackendPort as setBackendUrlPort } from '../../services/backendUrl';
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

  const isDark = config.theme === 'dark';

  useEffect(() => {
    loadPersistedPort();
    checkBackendStatus();
    const interval = setInterval(checkBackendStatus, 5000);
    return () => clearInterval(interval);
  }, []);

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
