import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useConfigStore } from '../../stores/configStore';
import { chatService } from '../../services/chatService';
import type { BackendStatus } from '../../types';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

function Modal({ isOpen, onClose, children }: ModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black bg-opacity-50"
        onClick={onClose}
      />
      <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[80vh] overflow-y-auto">
        {children}
      </div>
    </div>
  );
}

function ThemeToggle() {
  const { config, setConfig } = useConfigStore();
  const isDark = config.theme === 'dark';

  const toggleTheme = () => {
    const newTheme = isDark ? 'light' : 'dark';
    setConfig('theme', newTheme);
  };

  return (
    <div className="flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
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
  );
}

function BackendControl() {
  const [backendStatus, setBackendStatus] = useState<BackendStatus>({
    running: false,
    port: null,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    checkBackendStatus();
    const interval = setInterval(checkBackendStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const checkBackendStatus = async () => {
    try {
      const status = await chatService.getBackendStatus();
      setBackendStatus(status);
      setError(null);
    } catch {
      setBackendStatus({ running: false, port: null });
    }
  };

  const startBackend = async () => {
    setLoading(true);
    setError(null);
    try {
      const status = await chatService.startBackend();
      setBackendStatus(status);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const stopBackend = async () => {
    setLoading(true);
    setError(null);
    try {
      await chatService.stopBackend();
      setBackendStatus({ running: false, port: null });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="border-t border-gray-200 dark:border-gray-700 pt-4 mt-4">
      <h3 className="text-lg font-semibold mb-3 text-gray-900 dark:text-gray-100">Backend 服务</h3>

      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm text-gray-600 dark:text-gray-400">状态:</span>
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
            backendStatus.running
              ? 'bg-green-100 text-green-800'
              : 'bg-gray-100 text-gray-800'
          }`}
        >
          {backendStatus.running ? '运行中' : '已停止'}
        </span>
        {backendStatus.port && (
          <span className="text-xs text-gray-500">
            端口: {backendStatus.port}
          </span>
        )}
        {backendStatus.pid && (
          <span className="text-xs text-gray-400">
            PID: {backendStatus.pid}
          </span>
        )}
      </div>

      {error && (
        <div className="mb-2 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-600">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        {backendStatus.running ? (
          <button
            onClick={stopBackend}
            disabled={loading}
            className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white text-sm rounded disabled:opacity-50"
          >
            {loading ? '停止中...' : '停止 Backend'}
          </button>
        ) : (
          <button
            onClick={startBackend}
            disabled={loading}
            className="px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white text-sm rounded disabled:opacity-50"
          >
            {loading ? '启动中...' : '启动 Backend'}
          </button>
        )}
        <button
          onClick={checkBackendStatus}
          disabled={loading}
          className="px-3 py-1.5 bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 text-gray-700 dark:text-gray-300 text-sm rounded disabled:opacity-50"
        >
          刷新状态
        </button>
      </div>

      {!backendStatus.running && (
        <p className="mt-2 text-xs text-gray-500">
          提示: 需要先启动 Backend 才能进行聊天
        </p>
      )}
    </div>
  );
}

function ConfigPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'backend' | 'config'>('config');
  const { config, setConfig, loadConfig } = useConfigStore();
  const navigate = useNavigate();

  useEffect(() => {
    if (isOpen) {
      loadConfig();
    }
  }, [isOpen, loadConfig]);

  useEffect(() => {
    if (config.theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [config.theme]);

  return (
    <>
      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)}>
        <div className="p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">设置</h2>
            <button
              onClick={() => setIsOpen(false)}
              className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 text-2xl leading-none"
            >
              ×
            </button>
          </div>

          <div className="flex border-b border-gray-200 dark:border-gray-700 mb-4">
            <button
              onClick={() => setActiveTab('config')}
              className={`px-4 py-2 text-sm font-medium ${
                activeTab === 'config'
                  ? 'border-b-2 border-blue-500 text-blue-600'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              外观
            </button>
            <button
              onClick={() => setActiveTab('backend')}
              className={`px-4 py-2 text-sm font-medium ${
                activeTab === 'backend'
                  ? 'border-b-2 border-blue-500 text-blue-600'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              Backend 服务
            </button>
          </div>

          {activeTab === 'config' && (
            <div className="space-y-4">
              <ThemeToggle />

              <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                <div className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">快捷操作</div>
                <button
                  onClick={() => { setIsOpen(false); navigate('/settings'); }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 text-blue-600 dark:text-blue-400 text-sm transition-colors"
                >
                  <span>⚙️</span>
                  <span>打开完整设置</span>
                </button>
              </div>
            </div>
          )}

          {activeTab === 'backend' && <BackendControl />}
        </div>
      </Modal>
    </>
  );
}

export default ConfigPanel;
