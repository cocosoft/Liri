import { useEffect, useState } from "react";
import { useConfigStore } from "../../stores/configStore";
import { planService } from "../../services/planService";
import type { Plan } from "../../services/planService";
import DAGView from "./DAGView";
import { SkeletonCard } from "../common/Skeleton";

// 计划/流程数据接口
interface PlanFlowItem {
  id?: string;
  name?: string;
  title?: string;
  description?: string;
}

/** 任务计划面板 — 嵌入 TaskCenterPage 的「任务计划」Tab */
export default function PlansPanel() {
  const config = useConfigStore((s) => s.config);
  const isDark = config.theme === "dark";

  const [plans, setPlans] = useState<Plan[]>([]);
  const [flows, setFlows] = useState<PlanFlowItem[]>([]);
  const [loading, setLoading] = useState(true);
  /** P2（08-09）：展开的计划 ID */
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [plansData, flowsRes] = await Promise.all([
          planService.list(),
          import("../../services/httpClient").then((m) =>
            m.httpLegacy.get<{ data: PlanFlowItem[] }>("/v1/flows"),
          ),
        ]);
        if (cancelled) return;

        setPlans(Array.isArray(plansData) ? plansData : []);
        const fData = flowsRes?.data;
        setFlows(Array.isArray(fData) ? fData : []);
      } catch {
        // 静默失败
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="p-4 space-y-3">
        <SkeletonCard count={3} />
      </div>
    );
  }

  const cardBg = isDark ? "bg-gray-800" : "bg-white";
  const borderColor = isDark ? "border-gray-700" : "border-gray-200";
  const textPrimary = isDark ? "text-gray-100" : "text-gray-900";
  const textSecondary = isDark ? "text-gray-400" : "text-gray-500";

  return (
    <div className="space-y-6">
      {/* 计划列表 */}
      <div>
        <h3 className={`text-sm font-semibold mb-3 ${textPrimary}`}>
          执行计划 ({plans.length})
        </h3>
        {plans.length === 0 ? (
          <p className={`text-sm ${textSecondary}`}>暂无计划</p>
        ) : (
          <div className="space-y-2">
            {plans.map((plan) => {
              const isExpanded = expandedPlanId === plan.id;
              const statusColors: Record<string, string> = {
                pending: "bg-gray-400",
                running: "bg-blue-500",
                completed: "bg-green-500",
                failed: "bg-red-500",
                aborted: "bg-orange-500",
              };
              const dotColor = statusColors[plan.status] || "bg-gray-400";

              return (
                <div key={plan.id}>
                  <button
                    onClick={() =>
                      setExpandedPlanId(isExpanded ? null : plan.id)
                    }
                    className={`w-full text-left ${cardBg} ${borderColor} border rounded-lg p-3 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-2 h-2 rounded-full ${dotColor} flex-shrink-0`}
                      />
                      <span
                        className={`text-sm font-medium ${textPrimary} truncate`}
                      >
                        {plan.description || `计划 ${plan.id.slice(0, 8)}`}
                      </span>
                      <span className="text-xs text-gray-400 ml-auto">
                        {isExpanded ? "▲" : "▼"}
                      </span>
                    </div>
                    <div className={`text-xs mt-1 ${textSecondary}`}>
                      {plan.steps.length} 步骤 · {plan.status}
                    </div>
                  </button>

                  {/* P2（08-09）：展开 DAG 图 */}
                  {isExpanded && (
                    <div className="mt-1 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800/50">
                      <DAGView planId={plan.id} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 流程列表 */}
      <div>
        <h3 className={`text-sm font-semibold mb-3 ${textPrimary}`}>
          执行流程 ({flows.length})
        </h3>
        {flows.length === 0 ? (
          <p className={`text-sm ${textSecondary}`}>暂无流程</p>
        ) : (
          <div className="space-y-2">
            {flows.map((flow, i: number) => (
              <div
                key={flow.id ?? i}
                className={`${cardBg} ${borderColor} border rounded-lg p-3`}
              >
                <p className={`text-sm font-medium ${textPrimary}`}>
                  {flow.name || flow.title || `流程 ${i + 1}`}
                </p>
                {flow.description && (
                  <p className={`text-xs mt-1 ${textSecondary}`}>
                    {flow.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
