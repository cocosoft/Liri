/**
 * 成本感知视图
 *
 * 显示成本报告、预算状态、模型使用费用分布
 */
import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { workspaceService } from "@/services/workspaceService";
import { createLogger } from "@/utils/logger";

const logger = createLogger("components:costView");

interface CostReport {
  id: string;
  workspaceId: string;
  totalCostUSD: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  modelBreakdown: Record<
    string,
    { model: string; costUSD: number; tokens: number; requestCount: number }
  >;
  budgetStatus: string;
  budgetUtilization: number;
  generatedAt: string;
  period: string;
}

interface BudgetStatus {
  status: string;
  currentCost: number;
  limit: number;
  remaining: number;
  percentageUsed: number;
}

export const CostView: React.FC = () => {
  const { t } = useTranslation();
  const { currentWorkspace } = useWorkspaceStore();
  const workspaceId = currentWorkspace?.id || "";

  const [report, setReport] = useState<CostReport | null>(null);
  const [budget, setBudget] = useState<BudgetStatus | null>(null);
  const [loading, setLoading] = useState(false);

  /** 加载成本数据 */
  const loadCostData = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const [reportData, budgetData] = await Promise.all([
        workspaceService.getCostReport(workspaceId) as Promise<CostReport>,
        workspaceService.getBudgetStatus(workspaceId) as Promise<BudgetStatus>,
      ]);
      setReport(reportData);
      setBudget(budgetData);
    } catch (err) {
      logger.error("加载成本数据失败", err);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    loadCostData();
  }, [loadCostData]);

  /** 格式化金额 */
  const formatUSD = (val: number) => `$${val.toFixed(4)}`;
  const formatTokens = (val: number) => {
    if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
    if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
    return val.toString();
  };

  if (!workspaceId) {
    return (
      <div className="p-4 text-gray-500">
        {t("workspace.title") + " " + t("workspace.members")}
      </div>
    );
  }

  if (loading) {
    return <div className="p-4 text-gray-400">加载中...</div>;
  }

  return (
    <div className="p-4 space-y-4 h-full overflow-y-auto">
      <h2 className="text-lg font-semibold text-gray-800">成本与用量</h2>

      {/* 预算状态 */}
      {budget && (
        <div className="p-4 bg-white rounded-lg border">
          <h3 className="font-medium text-gray-700 mb-2">
            {t("workspace.board")}
          </h3>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-500">{t("workspace.cost")}</span>
                <span className="font-medium">
                  {formatUSD(budget.currentCost)} / {formatUSD(budget.limit)}
                </span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    budget.status === "exceeded"
                      ? "bg-red-500"
                      : budget.status === "warning"
                        ? "bg-yellow-500"
                        : "bg-green-500"
                  }`}
                  style={{ width: `${Math.min(budget.percentageUsed, 100)}%` }}
                />
              </div>
            </div>
            <div className="text-center">
              <div
                className={`text-sm font-bold ${
                  budget.status === "exceeded"
                    ? "text-red-600"
                    : budget.status === "warning"
                      ? "text-yellow-600"
                      : "text-green-600"
                }`}
              >
                {budget.percentageUsed.toFixed(1)}%
              </div>
              <div className="text-xs text-gray-400">
                {budget.status === "exceeded"
                  ? t("workspace.cost")
                  : budget.status === "warning"
                    ? t("workspace.cost")
                    : t("common.success")}
              </div>
            </div>
          </div>
          {budget.remaining > 0 && (
            <div className="text-xs text-gray-400 mt-2">
              {t("workspace.cost")}: {formatUSD(budget.remaining)}
            </div>
          )}
        </div>
      )}

      {/* 总览 */}
      {report && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 bg-white rounded-lg border text-center">
              <div className="text-2xl font-bold text-blue-600">
                {formatUSD(report.totalCostUSD)}
              </div>
              <div className="text-xs text-gray-500 mt-1">总费用</div>
            </div>
            <div className="p-3 bg-white rounded-lg border text-center">
              <div className="text-2xl font-bold text-gray-700">
                {formatTokens(report.totalTokens)}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {t("workspace.cost")}
              </div>
            </div>
            <div className="p-3 bg-white rounded-lg border text-center">
              <div className="text-2xl font-bold text-gray-700">
                {Object.keys(report.modelBreakdown).length}
              </div>
              <div className="text-xs text-gray-500 mt-1">使用模型</div>
            </div>
          </div>

          {/* 输入/输出 Token */}
          <div className="p-4 bg-white rounded-lg border">
            <h3 className="font-medium text-gray-700 mb-2">Token 分布</h3>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <div className="text-xs text-gray-500 mb-1">输入 Token</div>
                <div className="h-4 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-400 rounded-full"
                    style={{
                      width: `${report.totalTokens > 0 ? (report.inputTokens / report.totalTokens) * 100 : 0}%`,
                    }}
                  />
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {formatTokens(report.inputTokens)}
                </div>
              </div>
              <div className="flex-1">
                <div className="text-xs text-gray-500 mb-1">输出 Token</div>
                <div className="h-4 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-400 rounded-full"
                    style={{
                      width: `${report.totalTokens > 0 ? (report.outputTokens / report.totalTokens) * 100 : 0}%`,
                    }}
                  />
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {formatTokens(report.outputTokens)}
                </div>
              </div>
            </div>
          </div>

          {/* 模型费用明细 */}
          <div className="p-4 bg-white rounded-lg border">
            <h3 className="font-medium text-gray-700 mb-2">
              {t("workspace.cost") + " " + t("workspace.detail")}
            </h3>
            {Object.keys(report.modelBreakdown).length === 0 ? (
              <div className="text-sm text-gray-400">暂无数据</div>
            ) : (
              <div className="space-y-2">
                {Object.values(report.modelBreakdown).map((model) => {
                  const pct =
                    report.totalCostUSD > 0
                      ? (model.costUSD / report.totalCostUSD) * 100
                      : 0;
                  return (
                    <div key={model.model} className="flex items-center gap-3">
                      <div
                        className="w-24 text-sm font-medium truncate"
                        title={model.model}
                      >
                        {model.model}
                      </div>
                      <div className="flex-1">
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-indigo-400 rounded-full"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                      <div className="text-sm text-right min-w-[80px]">
                        <div className="font-medium">
                          {formatUSD(model.costUSD)}
                        </div>
                        <div className="text-xs text-gray-400">
                          {formatTokens(model.tokens)} tokens /{" "}
                          {model.requestCount} 次
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
