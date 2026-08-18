import { useState, useRef, useEffect } from "react";
import { useBackendStore } from "../../stores/backendStore";
import { DEFAULT_BACKEND_PORT } from "../../services/backendUrl";

function BackendStatusBadge() {
  const {
    status,
    isChecking,
    error,
    isBrowserMode,
    checkStatus,
    startBackend,
    stopBackend,
    clearError,
  } = useBackendStore();
  const [expanded, setExpanded] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    if (expanded) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [expanded]);

  const isRunning = status.running;

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 px-2 py-1 text-xs rounded hover:bg-gray-700/50 transition-colors w-full"
        title={isRunning ? "后端运行中" : "后端未连接"}
      >
        <span
          className={`w-2 h-2 rounded-full flex-shrink-0 ${
            isRunning
              ? "bg-green-400 shadow-sm shadow-green-400/50"
              : "bg-red-400"
          }`}
        />
        <span className="text-gray-300 truncate">
          {isRunning
            ? `运行中${status.port ? ` :${status.port}` : ""}`
            : "未连接"}
        </span>
        {isChecking && (
          <span className="w-2 h-2 border border-gray-400 border-t-transparent rounded-full animate-spin ml-auto" />
        )}
        <svg
          className={`w-3 h-3 text-gray-400 ml-auto transition-transform ${expanded ? "rotate-180" : ""}`}
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
      </button>

      {expanded && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-gray-700 border border-gray-600 rounded-lg shadow-xl overflow-hidden z-50">
          <div className="p-3 space-y-2">
            <div className="text-xs text-gray-300 font-medium">后端服务</div>

            <div className="flex items-center gap-2 text-xs text-gray-400">
              <span
                className={`w-1.5 h-1.5 rounded-full ${isRunning ? "bg-green-400" : "bg-red-400"}`}
              />
              <span>{isRunning ? "运行中" : "未运行"}</span>
              {status.port && (
                <span className="text-gray-500">端口 {status.port}</span>
              )}
            </div>

            {isBrowserMode && !isRunning && (
              <div className="text-xs text-gray-400 bg-gray-800 rounded p-2 leading-relaxed">
                浏览器模式需要手动启动后端：
                <code className="block mt-1 text-yellow-300 break-all select-all">
                  cd backend &amp;&amp; bun start -- --http-port {DEFAULT_BACKEND_PORT}
                </code>
              </div>
            )}

            {error && (
              <div className="text-xs text-red-300 bg-red-900/30 rounded p-2 whitespace-pre-line">
                {error}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    clearError();
                  }}
                  className="ml-1 text-red-400 hover:text-red-200"
                >
                  ✕
                </button>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              {isRunning ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    stopBackend();
                  }}
                  className="flex-1 px-2 py-1 text-xs bg-red-500/80 hover:bg-red-500 text-white rounded transition-colors"
                >
                  停止
                </button>
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    startBackend();
                  }}
                  className="flex-1 px-2 py-1 text-xs bg-green-500/80 hover:bg-green-500 text-white rounded transition-colors"
                  disabled={isChecking}
                >
                  {isChecking ? "检查中..." : "启动"}
                </button>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  checkStatus();
                }}
                className="px-2 py-1 text-xs bg-gray-600 hover:bg-gray-500 text-gray-300 rounded transition-colors"
                disabled={isChecking}
              >
                刷新
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default BackendStatusBadge;
