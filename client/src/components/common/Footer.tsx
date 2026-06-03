import { useEffect, useState } from "react";
import { useBackendStore } from "../../stores/backendStore";
import { useModelSwitchStore } from "../../stores/modelSwitchStore";
import {
  monitorService,
  type MonitorSummary,
} from "../../services/monitorService";
import { costService, type CostSummary } from "../../services/costService";
import ModelSwitcher from "../modelAdmin/ModelSwitcher";

function Footer() {
  const { status, checkStatus, startBackend, stopBackend, error } =
    useBackendStore();
  const { currentModelId, loadCurrent } = useModelSwitchStore();
  const [isExpanded, setIsExpanded] = useState(false);
  const [showModelSwitcher, setShowModelSwitcher] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [summary, setSummary] = useState<MonitorSummary | null>(null);
  const [costSummary, setCostSummary] = useState<CostSummary | null>(null);

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, [checkStatus]);

  useEffect(() => {
    loadCurrent();
    const interval = setInterval(loadCurrent, 10000);
    return () => clearInterval(interval);
  }, [loadCurrent]);

  useEffect(() => {
    const fetchSummary = async () => {
      try {
        const data = await monitorService.getSummary();
        setSummary(data);
      } catch (err) {
        console.error("[Footer] 获取监控摘要失败:", err);
      }
    };
    fetchSummary();
    const interval = setInterval(fetchSummary, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const fetchCostSummary = async () => {
      try {
        const data = await costService.getCostSummary();
        setCostSummary(data);
      } catch (err) {
        console.error("[Footer] 获取成本摘要失败:", err);
      }
    };
    fetchCostSummary();
    const interval = setInterval(fetchCostSummary, 5000);
    return () => clearInterval(interval);
  }, []);

  const getStatusIcon = () => (status.running ? "🟢" : "🔴");
  const getStatusText = () => (status.running ? "运行中" : "已停止");

  const handleStart = async () => {
    setActionLoading(true);
    await startBackend();
    setActionLoading(false);
  };

  const handleStop = async () => {
    setActionLoading(true);
    await stopBackend();
    setActionLoading(false);
  };

  const getUptime = (seconds: number) => {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}天 ${h}小时`;
    if (h > 0) return `${h}小时 ${m}分钟`;
    return `${m}分钟`;
  };

  const getPercentColor = (percent: number) => {
    if (percent > 80) return "text-red-500";
    if (percent > 60) return "text-yellow-500";
    return "text-gray-600 dark:text-gray-400";
  };

  const formatTokens = (tokens: number) => {
    if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(2)}M`;
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
    return String(tokens);
  };

  const hasSessionTokens = costSummary !== null;

  return (
    <footer className="h-8 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 flex items-center px-4 text-xs text-gray-600 dark:text-gray-400 select-none relative">
      <div className="flex items-center gap-3 flex-1">
        <div
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1.5 hover:text-gray-900 dark:hover:text-gray-200 transition-colors cursor-pointer"
          title="点击展开详细状态"
        >
          <span>{getStatusIcon()}</span>
          <span>Backend {getStatusText()}</span>
          {status.running ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleStop();
              }}
              disabled={actionLoading}
              className="ml-2 px-1.5 py-0.5 text-[10px] bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white rounded transition-colors"
            >
              {actionLoading ? "..." : "停止"}
            </button>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleStart();
              }}
              disabled={actionLoading}
              className="ml-2 px-1.5 py-0.5 text-[10px] bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded transition-colors"
            >
              {actionLoading ? "..." : "启动"}
            </button>
          )}
        </div>

        {status.running && status.port && (
          <>
            <span className="text-gray-400">:{status.port}</span>
          </>
        )}

        {status.running && summary && (
          <>
            <span className="w-px h-3 bg-gray-300 dark:bg-gray-600" />
            <span
              className={`flex items-center gap-1 ${getPercentColor(summary.cpuPercent)}`}
            >
              🖥️{summary.cpuPercent.toFixed(0)}%
            </span>
            <span className="w-px h-3 bg-gray-300 dark:bg-gray-600" />
            <span
              className={`flex items-center gap-1 ${getPercentColor(summary.memoryPercent)}`}
            >
              🧠{summary.memoryPercent.toFixed(0)}%
            </span>
          </>
        )}

        {status.running && (
          <>
            <span className="w-px h-3 bg-gray-300 dark:bg-gray-600" />
            <button
              onClick={() => setShowModelSwitcher(true)}
              className="flex items-center gap-1 hover:text-gray-900 dark:hover:text-gray-200 transition-colors"
              title="点击切换模型"
            >
              <span className="text-purple-500">🧠</span>
              <span className="text-gray-700 dark:text-gray-300 font-medium">
                {currentModelId}
              </span>
              <span className="text-gray-400">▼</span>
            </button>
          </>
        )}

        {hasSessionTokens && (
          <>
            <span className="w-px h-3 bg-gray-300 dark:bg-gray-600" />
            <span className="text-blue-500">
              In:{formatTokens(costSummary.sessionInputTokens)}
            </span>
            <span className="text-green-500">
              Out:{formatTokens(costSummary.sessionOutputTokens)}
            </span>
            {costSummary.totalCacheReadTokens > 0 && (
              <span className="text-cyan-500">
                CR:{formatTokens(costSummary.totalCacheReadTokens)}
              </span>
            )}
            {costSummary.totalCacheCreationTokens > 0 && (
              <span className="text-yellow-500">
                CW:{formatTokens(costSummary.totalCacheCreationTokens)}
              </span>
            )}
            <span className="text-red-500">
              ${costSummary.sessionCost.toFixed(4)}
            </span>
          </>
        )}

        <div className="flex-1" />
      </div>

      {isExpanded && (
        <div className="absolute bottom-full mb-1 left-4 p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg text-xs min-w-[280px] z-50">
          <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">
            系统状态详情
          </h4>
          <div className="space-y-1.5">
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">Backend</span>
              <span
                className={status.running ? "text-green-500" : "text-red-500"}
              >
                {getStatusText()}
              </span>
            </div>
            {status.port && (
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">端口</span>
                <span className="text-gray-900 dark:text-gray-100">
                  {status.port}
                </span>
              </div>
            )}
            {status.pid && (
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">PID</span>
                <span className="text-gray-900 dark:text-gray-100">
                  {status.pid}
                </span>
              </div>
            )}
            {summary && (
              <>
                <div className="border-t border-gray-200 dark:border-gray-700 my-1.5" />
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">
                    运行时间
                  </span>
                  <span className="text-gray-900 dark:text-gray-100">
                    {getUptime(summary.uptime)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">CPU</span>
                  <span className={`${getPercentColor(summary.cpuPercent)}`}>
                    {summary.cpuPercent.toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">内存</span>
                  <span className={`${getPercentColor(summary.memoryPercent)}`}>
                    {summary.memoryPercent.toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">
                    请求总数
                  </span>
                  <span className="text-gray-900 dark:text-gray-100">
                    {summary.requestCount.toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">
                    错误数
                  </span>
                  <span
                    className={
                      summary.errorCount > 0
                        ? "text-red-500"
                        : "text-gray-900 dark:text-gray-100"
                    }
                  >
                    {summary.errorCount}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">
                    平均响应时间
                  </span>
                  <span className="text-gray-900 dark:text-gray-100">
                    {summary.avgResponseTime.toFixed(0)}ms
                  </span>
                </div>
              </>
            )}

            {hasSessionTokens && (
              <>
                <div className="border-t border-gray-200 dark:border-gray-700 my-1.5" />
                <h5 className="font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  当前会话 Token
                </h5>
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">
                    输入 (In)
                  </span>
                  <span className="text-blue-500 font-medium">
                    {costSummary.sessionInputTokens.toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">
                    输出 (Out)
                  </span>
                  <span className="text-green-500 font-medium">
                    {costSummary.sessionOutputTokens.toLocaleString()}
                  </span>
                </div>
                {costSummary.totalCacheReadTokens > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-500 dark:text-gray-400">
                      缓存读取 (CR)
                    </span>
                    <span className="text-cyan-500 font-medium">
                      {costSummary.totalCacheReadTokens.toLocaleString()}
                    </span>
                  </div>
                )}
                {costSummary.totalCacheCreationTokens > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-500 dark:text-gray-400">
                      缓存写入 (CW)
                    </span>
                    <span className="text-yellow-500 font-medium">
                      {costSummary.totalCacheCreationTokens.toLocaleString()}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">合计</span>
                  <span className="text-gray-900 dark:text-gray-100 font-medium">
                    {(
                      costSummary.sessionInputTokens +
                      costSummary.sessionOutputTokens
                    ).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">
                    预估成本
                  </span>
                  <span className="text-red-500 font-medium">
                    ${costSummary.sessionCost.toFixed(4)}
                  </span>
                </div>
              </>
            )}

            {error && (
              <div className="mt-2 p-2 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded text-xs text-red-600 dark:text-red-400">
                {error}
              </div>
            )}
          </div>
        </div>
      )}
      {showModelSwitcher && (
        <ModelSwitcher onClose={() => setShowModelSwitcher(false)} />
      )}
    </footer>
  );
}

export default Footer;
