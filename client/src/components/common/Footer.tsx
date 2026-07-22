import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useBackendStore } from "../../stores/backendStore";
import { useModelSwitchStore } from "../../stores/modelSwitchStore";
import {
  monitorService,
  type MonitorSummary,
} from "../../services/monitorService";
import { costService, type CostSummary } from "../../services/costService";
import ModelSwitcher from "../modelAdmin/ModelSwitcher";
import { createLogger } from "@/utils/logger";

const logger = createLogger("components:footer");

function Footer() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { status, checkStatus, startBackend, stopBackend, error } =
    useBackendStore();
  const { currentModelName, routerTier, routingMode, loadCurrent } =
    useModelSwitchStore();
  const [isExpanded, setIsExpanded] = useState(false);
  const [showModelSwitcher, setShowModelSwitcher] = useState(false);
  const [showCostDetail, setShowCostDetail] = useState(false);
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
        logger.error("获取监控摘要失败:", err);
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
        logger.error("获取成本摘要失败:", err);
      }
    };
    fetchCostSummary();
    const interval = setInterval(fetchCostSummary, 5000);
    return () => clearInterval(interval);
  }, []);

  const getStatusDot = (running: boolean) => (
    <span className={`inline-block w-2 h-2 rounded-full ${running ? "bg-green-500" : "bg-red-500"}`} />
  );

  const getStatusText = () => (status.running ? t("common.running") : t("common.stopped"));

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

  /** 复制模型名称到剪贴板 */
  const copyModelName = async () => {
    try {
      await navigator.clipboard.writeText(currentModelName);
    } catch {
      // 静默失败
    }
  };

  return (
    <footer className="h-8 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 flex items-center px-4 text-xs text-gray-600 dark:text-gray-400 select-none relative">
      <div className="flex items-center gap-3 flex-1">
        {/* 后端状态 */}
        <div
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1.5 hover:text-gray-900 dark:hover:text-gray-200 transition-colors cursor-pointer"
            title={t("footer.expandStatus")}
          >
            {getStatusDot(status.running)}
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
              {actionLoading ? "..." : t("common.stop")}
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
              {actionLoading ? "..." : t("common.start")}
            </button>
          )}
        </div>

        {/* 端口 */}
        {status.running && status.port && (
          <span className="text-gray-400">:{status.port}</span>
        )}

        {/* CPU / 内存 */}
        {status.running && summary && (
          <>
            <span className="w-px h-3 bg-gray-300 dark:bg-gray-600" />
            <span
              className={`flex items-center gap-1 ${getPercentColor(summary.cpuPercent)}`}
            >
              CPU:{summary.cpuPercent.toFixed(0)}%
            </span>
            <span className="w-px h-3 bg-gray-300 dark:bg-gray-600" />
            <span
              className={`flex items-center gap-1 ${getPercentColor(summary.memoryPercent)}`}
            >
              MEM:{summary.memoryPercent.toFixed(0)}%
            </span>
          </>
        )}

        {/* 当前模型 */}
        {status.running && (
          <>
            <span className="w-px h-3 bg-gray-300 dark:bg-gray-600" />
            {currentModelName ? (
              <button
                onClick={() => setShowModelSwitcher(true)}
                className="flex items-center gap-1 hover:text-gray-900 dark:hover:text-gray-200 transition-colors"
                title={t("footer.switchModel")}
              >
                <span className="text-purple-500">Model:</span>
                <span
                  className="text-gray-700 dark:text-gray-300 font-medium max-w-[120px] truncate inline-block"
                  onDoubleClick={copyModelName}
                >
                  {currentModelName}
                </span>
                {routingMode === 'dynamic' && routerTier ? (
                  <span className="px-1 py-0.5 text-[10px] font-medium bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 rounded">
                    dynamic:{routerTier}
                  </span>
                ) : routingMode && routingMode !== 'static' ? (
                  <span className="px-1 py-0.5 text-[10px] font-medium bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300 rounded">
                    {routingMode}
                  </span>
                ) : null}
                <span className="text-gray-400">▼</span>
              </button>
            ) : (
              <button
                onClick={() => navigate("/models")}
                className="flex items-center gap-1 text-amber-500 hover:text-amber-600 transition-colors"
                title="配置 AI 模型"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <span className="text-xs font-medium">配置模型</span>
              </button>
            )}
          </>
        )}

        {/* Token / 成本 */}
        {costSummary && (
          <>
            <span className="w-px h-3 bg-gray-300 dark:bg-gray-600" />
            <button
              onClick={() => setShowCostDetail(!showCostDetail)}
              className="flex items-center gap-1 hover:text-gray-900 dark:hover:text-gray-200 transition-colors"
              title={t("footer.toggleTokenDetail")}
            >
              <span className="text-blue-500">
                In:{formatTokens(costSummary.sessionInputTokens)}
              </span>
              <span className="text-green-500">
                Out:{formatTokens(costSummary.sessionOutputTokens)}
              </span>
              <span className="text-red-500">
                ${costSummary.sessionCost.toFixed(4)}
              </span>
            </button>

            {/* 今日消费 */}
            {costSummary.todayCost > 0 && (
              <span className="text-orange-500">
                 {t("footer.today")}: ¥{costSummary.todayCost.toFixed(4)}
              </span>
            )}
          </>
        )}

        <div className="flex-1" />
      </div>

      {/* 展开的 Token 详情 */}
      {showCostDetail && costSummary && (
        <div className="absolute bottom-full mb-1 right-4 p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg text-xs min-w-[260px] z-50">
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-semibold text-gray-900 dark:text-gray-100">
              {t("footer.tokenDetail")}
            </h4>
            <button
              onClick={() => setShowCostDetail(false)}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            >
              ✕
            </button>
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">{t("footer.input")}</span>
              <span className="text-blue-500 font-medium">
                {costSummary.sessionInputTokens.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">{t("footer.output")}</span>
              <span className="text-green-500 font-medium">
                {costSummary.sessionOutputTokens.toLocaleString()}
              </span>
            </div>
            {costSummary.totalCacheReadTokens > 0 && (
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">
                  {t("footer.cacheRead")}
                </span>
                <span className="text-cyan-500 font-medium">
                  {costSummary.totalCacheReadTokens.toLocaleString()}
                </span>
              </div>
            )}
            {costSummary.totalCacheCreationTokens > 0 && (
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">
                  {t("footer.cacheWrite")}
                </span>
                <span className="text-yellow-500 font-medium">
                  {costSummary.totalCacheCreationTokens.toLocaleString()}
                </span>
              </div>
            )}
            <div className="border-t border-gray-200 dark:border-gray-700 my-1.5" />
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">{t("footer.today")}</span>
              <span className="text-gray-900 dark:text-gray-100">
                {costSummary.todayTokens.toLocaleString()} tokens
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">{t("footer.todayCost")}</span>
              <span className="text-orange-500 font-medium">
                ${costSummary.todayCost.toFixed(4)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">{t("footer.sessionCost")}</span>
              <span className="text-red-500 font-medium">
                ${costSummary.sessionCost.toFixed(4)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 展开的系统状态详情面板 */}
      {isExpanded && (
        <div className="absolute bottom-full mb-1 left-4 p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg text-xs min-w-[280px] z-50">
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-semibold text-gray-900 dark:text-gray-100">
              {t("footer.systemStatus")}
            </h4>
            <button
              onClick={() => setIsExpanded(false)}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            >
              ✕
            </button>
          </div>
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
                <span className="text-gray-500 dark:text-gray-400">{t("footer.port")}</span>
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
                    {t("footer.uptime")}
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
                  <span className="text-gray-500 dark:text-gray-400">{t("footer.memory")}</span>
                  <span className={`${getPercentColor(summary.memoryPercent)}`}>
                    {summary.memoryPercent.toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">
                    {t("footer.requestCount")}
                  </span>
                  <span className="text-gray-900 dark:text-gray-100">
                    {summary.requestCount.toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">
                    {t("footer.errorCount")}
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
                    {t("footer.avgResponseTime")}
                  </span>
                  <span className="text-gray-900 dark:text-gray-100">
                    {summary.avgResponseTime.toFixed(0)}ms
                  </span>
                </div>
              </>
            )}

            {costSummary && (
              <>
                <div className="border-t border-gray-200 dark:border-gray-700 my-1.5" />
                <h5 className="font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  {t("footer.costOverview")}
                </h5>
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">{t("footer.today")}</span>
                  <span className="text-orange-500 font-medium">
                    ¥{costSummary.todayCost.toFixed(4)} /{" "}
                    {costSummary.todayTokens.toLocaleString()} tokens
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">{t("footer.thisWeek")}</span>
                  <span className="text-gray-900 dark:text-gray-100">
                    ¥{costSummary.weeklyCost.toFixed(4)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">{t("footer.thisMonth")}</span>
                  <span className="text-gray-900 dark:text-gray-100">
                    ¥{costSummary.monthlyCost.toFixed(4)}
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
