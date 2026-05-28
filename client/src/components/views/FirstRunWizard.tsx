import { useEffect, useState } from 'react';
import { appConfigService } from '../../services/appConfigService';
import { useBackendStore } from '../../stores/backendStore';

interface FirstRunWizardProps {
  onComplete: () => void;
}

export function FirstRunWizard({ onComplete }: FirstRunWizardProps) {
  const [dataDir, setDataDir] = useState('');
  const [httpPort, setHttpPort] = useState(7890);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState<'welcome' | 'configure' | 'finishing'>('welcome');
  const checkBackendStatus = useBackendStore((s) => s.checkStatus);

  useEffect(() => {
    appConfigService.get().then((config) => {
      setDataDir(config.dataDir);
      setHttpPort(config.httpPort);
    });
  }, []);

  const handleComplete = async () => {
    setStep('finishing');
    setSaving(true);

    try {
      await appConfigService.completeFirstRun({
        dataDir,
        httpPort,
      });

      checkBackendStatus();

      onComplete();
    } catch (e) {
      console.error('Failed to save first-run config:', e);
      setSaving(false);
    }
  };

  if (step === 'welcome') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="max-w-md w-full mx-4 text-center">
          <div className="mb-8">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
              <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-3">
              PY_APP
            </h1>
            <p className="text-gray-500 dark:text-gray-400 leading-relaxed">
              欢迎使用 PY_APP Client。在开始之前，我们先做一些基本设置。
              你可以随时在设置页面中修改这些配置。
            </p>
          </div>
          <button
            onClick={() => setStep('configure')}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
          >
            开始设置
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="max-w-md w-full mx-4">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-6">
          基本配置
        </h2>

        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              数据目录
            </label>
            <input
              type="text"
              value={dataDir}
              onChange={(e) => setDataDir(e.target.value)}
              placeholder="C:\Users\<用户名>\.pyapp"
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              后端数据、插件、知识库等文件将存储在这里
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              HTTP 端口
            </label>
            <input
              type="number"
              value={httpPort}
              onChange={(e) => setHttpPort(Number(e.target.value))}
              min={1024}
              max={65535}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              后端 HTTP 服务监听的端口（默认 7890）
            </p>
          </div>

          {saving && (
            <div className="text-sm text-blue-600 dark:text-blue-400 text-center py-2">
              保存配置中...
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handleComplete}
              disabled={saving || !dataDir.trim()}
              className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
            >
              完成设置
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
