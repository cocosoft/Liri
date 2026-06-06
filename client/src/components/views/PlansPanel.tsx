import { useEffect, useState } from "react";
import { useConfigStore } from "../../stores/configStore";
import { http } from "../../services/httpClient";
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

  const [plans, setPlans] = useState<PlanFlowItem[]>([]);
  const [flows, setFlows] = useState<PlanFlowItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [plansRes, flowsRes] = await Promise.all([
          http.get("/v1/plans"),
          http.get("/v1/flows"),
        ]);
        if (cancelled) return;

        const pData = (plansRes as any)?.data;
        const fData = (flowsRes as any)?.data;
        setPlans(Array.isArray(pData) ? pData : []);
        setFlows(Array.isArray(fData) ? fData : []);
      } catch {
        // 静默失败
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
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
            {plans.map((plan, i: number) => (
              <div
                key={plan.id ?? i}
                className={`${cardBg} ${borderColor} border rounded-lg p-3`}
              >
                <p className={`text-sm font-medium ${textPrimary}`}>
                  {plan.name || plan.title || `计划 ${i + 1}`}
                </p>
                {plan.description && (
                  <p className={`text-xs mt-1 ${textSecondary}`}>
                    {plan.description}
                  </p>
                )}
              </div>
            ))}
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
