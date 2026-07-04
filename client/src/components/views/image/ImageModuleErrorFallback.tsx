/**
 * ImageModuleErrorFallback
 * 图像模块崩溃时的兜底 UI
 */
import { useTranslation } from "react-i18next";

interface Props {
  error?: Error;
  onRetry?: () => void;
}

export default function ImageModuleErrorFallback({ error, onRetry }: Props) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-gray-400">
      <svg className="w-16 h-16 mb-4 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <h2 className="text-lg font-medium text-gray-300 mb-2">
        {t("image.moduleError")}
      </h2>
      <p className="text-xs text-gray-600 mb-4 text-center max-w-xs">
        {t("image.moduleErrorDesc")}
      </p>
      {error && (
        <pre className="text-[10px] text-red-400/70 bg-black/20 rounded px-3 py-2 mb-4 max-w-md overflow-auto">
          {error.message}
        </pre>
      )}
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-4 py-1.5 rounded bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 text-xs border-0 cursor-pointer"
        >
          {t("common.retry")}
        </button>
      )}
    </div>
  );
}
