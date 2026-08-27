import { useEffect, useState } from "react";
import { appConfigService } from "../../services/appConfigService";
import { useBackendStore } from "../../stores/backendStore";
import { DEFAULT_BACKEND_PORT } from "../../services/backendUrl";

interface FirstRunWizardProps {
  onComplete: () => void;
}

export function FirstRunWizard({ onComplete }: FirstRunWizardProps) {
  const [dataDir, setDataDir] = useState("");
  const [httpPort, setHttpPort] = useState(DEFAULT_BACKEND_PORT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"welcome" | "configure" | "finishing">(
    "welcome",
  );
  const checkBackendStatus = useBackendStore((s) => s.checkStatus);

  useEffect(() => {
    appConfigService
      .get()
      .then((config) => {
        setDataDir(config.dataDir);
        setHttpPort(config.httpPort);
      })
      .catch((e) => {
        setError(String(e));
      });
  }, []);

  const handleComplete = async () => {
    setStep("finishing");
    setSaving(true);
    setError(null);

    try {
      // P0-0 端口校准（2026-08-27）：首次引导保存即"用户显式设置"，置标记生效
      await appConfigService.completeFirstRun({
        dataDir,
        httpPort,
        httpPortUserSet: true,
      });

      checkBackendStatus();

      onComplete();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep("configure");
      setSaving(false);
    }
  };

  if (step === "welcome") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="max-w-md w-full mx-4 text-center">
          <div className="mb-8">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
              <svg
                className="w-8 h-8 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
            </div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-3">
              Liri
            </h1>
            <p className="text-gray-500 dark:text-gray-400 leading-relaxed">
              欢迎使用 Liri，你的 AI 助手。开始之前先做一点准备工作，
              之后就可以直接开始对话了。
            </p>
          </div>
          <button
            onClick={() => setStep("configure")}
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
          >
            开始准备
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="max-w-md w-full mx-4">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-6">
          准备工作
        </h2>

        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              我的数据存放位置
            </label>
            <input
              type="text"
              value={dataDir}
              onChange={(e) => setDataDir(e.target.value)}
              placeholder="C:\Users\<用户名>\.pyapp"
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              你的对话、资料和设置都会保存在这里
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              网络端口
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
              一般保持默认即可
            </p>
          </div>

          {error && (
            <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {saving && (
            <div className="text-sm text-blue-600 dark:text-blue-400 text-center py-2">
              准备中...
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handleComplete}
              disabled={saving || !dataDir.trim()}
              className="flex-1 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
            >
              开始使用
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
