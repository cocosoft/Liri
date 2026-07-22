import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { modelService } from "../../services/modelService";

interface LLMSetupGuideProps {
  onDismiss: () => void;
}

export function LLMSetupGuide({ onDismiss }: LLMSetupGuideProps) {
  const [checking, setChecking] = useState(true);
  const [hasModels, setHasModels] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const models = await modelService.list();
        if (!cancelled) {
          setHasModels(models.length > 0);
        }
      } catch {
        if (!cancelled) {
          setHasModels(false);
        }
      } finally {
        if (!cancelled) setChecking(false);
      }
    };
    check();
    return () => {
      cancelled = true;
    };
  }, []);

  // 已有模型则自动关闭引导
  useEffect(() => {
    if (!checking && hasModels) {
      onDismiss();
    }
  }, [checking, hasModels, onDismiss]);

  const handleGoToModels = () => {
    navigate("/models");
    onDismiss();
  };

  if (checking) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-50/90 dark:bg-gray-900/90">
        <div className="text-gray-400 text-sm">正在检测 LLM 配置...</div>
      </div>
    );
  }

  if (hasModels) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-50/90 dark:bg-gray-900/90">
      <div className="max-w-md w-full mx-4 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-8 text-center">
        {/* 图标 */}
        <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
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
              d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
            />
          </svg>
        </div>

        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-3">
          尚未配置 AI 模型
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed mb-6">
          Liri 需要至少配置一个 AI 供应商才能正常使用。 请在模型管理页面添加你的
          API 密钥和模型。
        </p>

        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 mb-6 text-left">
          <p className="text-xs text-blue-700 dark:text-blue-300 font-medium mb-2">
            快速开始：
          </p>
          <ol className="text-xs text-blue-600 dark:text-blue-400 space-y-1.5 list-decimal list-inside">
            <li>点击「添加供应商」选择你的 AI 服务商</li>
            <li>填入 API 密钥和接口地址</li>
            <li>点击「拉取模型」获取可用模型列表</li>
            <li>导入需要的模型即可开始使用</li>
          </ol>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onDismiss}
            className="flex-1 px-4 py-2.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 border border-gray-300 dark:border-gray-600 rounded-lg transition-colors"
          >
            稍后配置
          </button>
          <button
            onClick={handleGoToModels}
            className="flex-1 px-4 py-2.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
          >
            去配置 AI 模型
          </button>
        </div>

        <button
          onClick={onDismiss}
          className="mt-4 text-xs text-gray-400 hover:text-gray-500 dark:text-gray-500 dark:hover:text-gray-400"
        >
          不再提示
        </button>
      </div>
    </div>
  );
}
