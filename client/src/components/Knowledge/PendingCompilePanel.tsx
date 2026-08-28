import { useState, useEffect, useCallback, useRef } from "react";
import { knowledgeService } from "../../services/knowledgeService";
import { useCompilePolling } from "./useCompilePolling";
import { formatFileSize, formatDate } from "./shared/utils";

interface RawFileInfo {
  fileName: string;
  ext: string;
  size: number;
  modifiedAt: number;
  createdAt: number;
  category: string | null;
  source: string | null;
}

interface PendingCompilePanelProps {
  isDark: boolean;
  onCompileComplete?: () => void;
  /** 抽屉模式下提供关闭入口 */
  onClose?: () => void;
}

function PendingCompilePanel({
  isDark,
  onCompileComplete,
  onClose,
}: PendingCompilePanelProps) {
  const [rawFiles, setRawFiles] = useState<RawFileInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [compileProgress, setCompileProgress] = useState(0);
  const [compileResult, setCompileResult] = useState<{
    message: string;
    hasError: boolean;
  } | null>(null);
  const [expanded, setExpanded] = useState(false);
  // L7：首次加载标记（仅初始化展开态，刷新不覆盖用户操作）
  const firstLoadRef = useRef(true);

  const bgClass = isDark ? "bg-gray-800" : "bg-gray-50";
  const textPrimary = isDark ? "text-gray-100" : "text-gray-900";
  const textSecondary = isDark ? "text-gray-400" : "text-gray-500";
  const textMuted = isDark ? "text-gray-500" : "text-gray-400";
  const borderColor = isDark ? "border-gray-700" : "border-gray-200";
  const badgeBg = isDark ? "bg-gray-700" : "bg-gray-100";

  const loadRawFiles = useCallback(async () => {
    setLoading(true);
    try {
      const result = await knowledgeService.getRawFiles();
      setRawFiles(result.files);
      // L7：仅首次加载按数据量初始化展开态，刷新不覆盖用户手动收起
      if (firstLoadRef.current) {
        firstLoadRef.current = false;
        setExpanded(result.files.length > 0);
      }
    } catch {
      setRawFiles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRawFiles();
  }, [loadRawFiles]);

  // Phase 0：编译"触发 + 状态机轮询"收敛到 useCompilePolling（C1/C2/C3）
  const { start: startCompile } = useCompilePolling({
    onProgress: (p) => setCompileProgress(p),
    onResult: (r) =>
      setCompileResult({ message: r.message, hasError: r.hasError }),
    onFinished: async () => {
      setCompiling(false);
      await loadRawFiles();
      onCompileComplete?.();
    },
  });

  async function handleCompileAll() {
    if (compiling) return;
    setCompiling(true);
    setCompileProgress(0);
    setCompileResult(null);
    const started = await startCompile();
    if (!started) setCompiling(false); // 被顶栏编译入口的互斥挡住
  }

  if (!expanded && rawFiles.length === 0) return null;

  return (
    <div
      className={`mx-4 mb-2 rounded-lg border ${borderColor} ${bgClass} overflow-hidden`}
    >
      <div
        className={`flex items-center justify-between px-3 py-2 cursor-pointer select-none ${
          rawFiles.length > 0 ? "hover:opacity-80" : ""
        }`}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <svg
            className="w-4 h-4 text-amber-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
            />
          </svg>
          <span className={`text-xs font-medium ${textPrimary}`}>
            待处理文件
          </span>
          {rawFiles.length > 0 && (
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded-full ${badgeBg} ${textSecondary}`}
            >
              {rawFiles.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <svg
            className={`w-3.5 h-3.5 ${textSecondary} transition-transform ${expanded ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
          {onClose && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              className={`p-0.5 rounded ${textSecondary} hover:opacity-70`}
              title="关闭待处理面板"
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="px-3 pb-2">
          {loading ? (
            <div className={`text-center py-3 ${textMuted}`}>
              <span className="text-xs">加载中...</span>
            </div>
          ) : rawFiles.length === 0 ? (
            <div className={`text-center py-3 ${textMuted}`}>
              <p className="text-xs">暂无待处理的文件</p>
              <p className="text-[10px] mt-1 opacity-60">
                上传 .md .txt .pdf 等文件后将自动进入编译队列
              </p>
            </div>
          ) : (
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {rawFiles.map((file) => (
                <div
                  key={file.fileName}
                  className={`flex items-center justify-between px-2 py-1.5 rounded text-xs ${
                    isDark ? "hover:bg-gray-700" : "hover:bg-gray-100"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`font-mono ${textPrimary} truncate`}>
                      {file.fileName}
                    </span>
                    {file.category && (
                      <span className={`px-1 rounded ${badgeBg} ${textMuted}`}>
                        {file.category}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    <span className={textMuted}>
                      {formatFileSize(file.size)}
                    </span>
                    <span className={textMuted}>
                      {formatDate(file.modifiedAt)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {rawFiles.length > 0 && (
            <div
              className={`flex items-center gap-2 mt-2 pt-2 border-t ${borderColor}`}
            >
              <button
                onClick={handleCompileAll}
                disabled={compiling}
                className="flex items-center gap-1 px-3 py-1 text-xs bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-md transition-colors"
              >
                {compiling ? (
                  <>
                    <span className="animate-spin w-3 h-3 border-2 border-white border-t-transparent rounded-full inline-block" />
                    编译中...
                  </>
                ) : (
                  <>
                    <svg
                      className="w-3 h-3"
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
                    全部编译
                  </>
                )}
              </button>
              <button
                onClick={loadRawFiles}
                disabled={loading}
                className={`text-xs ${textSecondary} hover:${isDark ? "text-gray-300" : "text-gray-700"} transition-colors`}
              >
                刷新
              </button>
            </div>
          )}

          {/* 编译进度条 */}
          {compiling && (
            <div className="mt-2">
              <div className="flex justify-between text-[10px] text-gray-400 mb-0.5">
                <span>编译中...</span>
                <span>{Math.round(compileProgress)}%</span>
              </div>
              <div className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-300"
                  style={{ width: `${compileProgress}%` }}
                />
              </div>
            </div>
          )}

          {compileResult && (
            <div
              className={`mt-2 text-xs px-2 py-1 rounded ${
                compileResult.hasError
                  ? "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"
                  : "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400"
              }`}
            >
              {compileResult.message}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default PendingCompilePanel;
