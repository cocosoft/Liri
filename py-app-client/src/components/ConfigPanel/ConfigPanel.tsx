import { useEffect, useState } from 'react';
import { useConfigStore } from '../../stores/configStore';
import { chatService, BackendStatus } from '../../services/chatService';

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
      <div className="relative bg-white rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[80vh] overflow-y-auto">
        {children}
      </div>
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
  }, []);

  const checkBackendStatus = async () => {
    try {
      const status = await chatService.getBackendStatus();
      setBackendStatus(status);
      setError(null);
    } catch (e) {
      console.error('Failed to get backend status:', e);
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
      console.error('Failed to start backend:', e);
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
      console.error('Failed to stop backend:', e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="border-t border-gray-200 pt-4 mt-4">
      <h3 className="text-lg font-semibold mb-3">Backend 服务</h3>

      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm text-gray-600">状态:</span>
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
          className="px-3 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-700 text-sm rounded disabled:opacity-50"
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
  const [activeTab, setActiveTab] = useState<'backend' | 'config'>('backend');
  const { config, loadConfig, setConfig } = useConfigStore();

  useEffect(() => {
    if (isOpen) {
      loadConfig();
    }
  }, [isOpen, loadConfig]);

  const handleChange = (key: string, value: string) => {
    let parsedValue: unknown = value;

    if (value === 'true') parsedValue = true;
    else if (value === 'false') parsedValue = false;
    else if (!isNaN(Number(value)) && value !== '') parsedValue = Number(value);

    setConfig(key, parsedValue);
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 w-12 h-12 bg-gray-700 hover:bg-gray-600 text-white rounded-full shadow-lg flex items-center justify-center text-xl"
        title="设置"
      >
        ⚙
      </button>

      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)}>
        <div className="p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold">设置</h2>
            <button
              onClick={() => setIsOpen(false)}
              className="text-gray-500 hover:text-gray-700 text-2xl leading-none"
            >
              ×
            </button>
          </div>

          <div className="flex border-b border-gray-200 mb-4">
            <button
              onClick={() => setActiveTab('backend')}
              className={`px-4 py-2 text-sm font-medium ${
                activeTab === 'backend'
                  ? 'border-b-2 border-blue-500 text-blue-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Backend 服务
            </button>
            <button
              onClick={() => setActiveTab('config')}
              className={`px-4 py-2 text-sm font-medium ${
                activeTab === 'config'
                  ? 'border-b-2 border-blue-500 text-blue-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              配置项
            </button>
          </div>

          {activeTab === 'backend' && <BackendControl />}

          {activeTab === 'config' && (
            <div className="space-y-4">
              {Object.entries(config).map(([key, value]) => (
                <div key={key}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {key}
                  </label>
                  <input
                    type="text"
                    defaultValue={String(value)}
                    onBlur={(e) => handleChange(key, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleChange(key, (e.target as HTMLInputElement).value);
                      }
                    }}
                    className="w-full border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              ))}

              {Object.keys(config).length === 0 && (
                <p className="text-gray-500 text-center py-4">暂无配置项</p>
              )}
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}

export default ConfigPanel;
