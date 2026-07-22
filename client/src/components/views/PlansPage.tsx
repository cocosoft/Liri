import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { planService, pdcaService } from "../../services/planService";
import type { Plan } from "../../services/planService";
import PdcaPipeline from "../Agent/PdcaPipeline";
import KanbanBoard from "../Agent/KanbanBoard";
import { SkeletonCard } from "../common/Skeleton";

type TabId = "plans" | "pdca" | "kanban";

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: "plans", label: "计划管理", icon: "📋" },
  { id: "pdca", label: "PDCA 流程", icon: "🔄" },
  { id: "kanban", label: "看板", icon: "📌" },
];

/** Tab id 到 i18n key 的映射 */
const TAB_LABEL_KEYS: Record<string, string> = {
  plans: "plans.planManagement",
  pdca: "plans.pdcaFlow",
  kanban: "plans.kanban",
};

/**
 * 计划/PDCA/看板 管理页面
 * 方案规划中的管理类功能：任务中心下的 Plans/PDCA/Kanban 归集
 */
export default function PlansPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabId>("plans");

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900">
      <div className="max-w-5xl mx-auto p-6">
        {/* 页面标题 */}
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">
          {t("plans.managementPanel")}
        </h2>

        {/* Tab 导航 */}
        <div className="flex gap-1 mb-6 border-b border-gray-200 dark:border-gray-700">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? "border-blue-500 text-blue-600 dark:text-blue-400"
                  : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
              }`}
            >
              <span>{tab.icon}</span>
              <span>{t(TAB_LABEL_KEYS[tab.id] || tab.label)}</span>
            </button>
          ))}
        </div>

        {/* 内容区域 */}
        {activeTab === "plans" && <PlansView />}
        {activeTab === "pdca" && <PdcaView />}
        {activeTab === "kanban" && <KanbanView />}
      </div>
    </div>
  );
}

/* ========== 计划管理视图 ========== */

function PlansView() {
  const { t } = useTranslation();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [goal, setGoal] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await planService.list();
    setPlans(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async () => {
    const g = goal.trim();
    if (!g || creating) return;
    setCreating(true);
    await planService.create({ goal: g });
    setGoal("");
    setCreating(false);
    load();
  };

  const handleExecute = async (id: string) => {
    await planService.execute(id);
    load();
  };

  const handleAbort = async (id: string) => {
    await planService.abort(id);
    load();
  };

  const statusColor: Record<string, string> = {
    pending: "text-yellow-600 dark:text-yellow-400",
    running: "text-blue-600 dark:text-blue-400",
    completed: "text-green-600 dark:text-green-400",
    failed: "text-red-600 dark:text-red-400",
    aborted: "text-gray-500 dark:text-gray-400",
  };

  const statusText: Record<string, string> = {
    pending: t("plans.pending"),
    running: t("plans.running"),
    completed: t("plans.completed"),
    failed: t("plans.failed"),
    aborted: t("plans.aborted"),
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 新建计划 */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
          {t("plans.newPlan")}
        </h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder={t("plans.goalPlaceholder")}
            className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
          <button
            onClick={handleCreate}
            disabled={creating || !goal.trim()}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded"
          >
            {creating ? t("plans.creating") : t("common.create")}
          </button>
        </div>
      </div>

      {/* 计划列表 */}
      {plans.length === 0 ? (
        <div className="text-center py-12 text-gray-400 dark:text-gray-500 text-sm">
          {t("plans.noPlans")}
        </div>
      ) : (
        <div className="space-y-2">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                    {plan.description}
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                    {t("plans.stepsCount", { count: plan.steps?.length || 0 })}
                  </p>
                </div>
                <div className="flex items-center gap-2 ml-3">
                  <span
                    className={`text-xs font-medium ${statusColor[plan.status] || ""}`}
                  >
                    {statusText[plan.status] || plan.status}
                  </span>
                  {plan.status === "pending" && (
                    <button
                      onClick={() => handleExecute(plan.id)}
                      className="px-2.5 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded"
                    >
                      {t("plans.execute")}
                    </button>
                  )}
                  {plan.status === "running" && (
                    <button
                      onClick={() => handleAbort(plan.id)}
                      className="px-2.5 py-1 text-xs bg-red-500 hover:bg-red-600 text-white rounded"
                    >
                      {t("plans.abort")}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ========== PDCA 视图 ========== */

function PdcaView() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [description, setDescription] = useState("");
  const [starting, setStarting] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    // 尝试获取已有 PDCA 列表，取第一条作为当前活动的 taskId
    const data = await pdcaService.list();
    if (data.length > 0 && data[0].taskId) {
      setActiveTaskId(data[0].taskId);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleStart = async () => {
    const d = description.trim();
    if (!d || starting) return;
    setStarting(true);
    const taskId = await pdcaService.start(d);
    if (taskId) setActiveTaskId(taskId);
    setDescription("");
    setStarting(false);
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2].map((i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 启动 PDCA */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
          {t("plans.startPdca")}
        </h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("plans.taskDescPlaceholder")}
            className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            onKeyDown={(e) => e.key === "Enter" && handleStart()}
          />
          <button
            onClick={handleStart}
            disabled={starting || !description.trim()}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded"
          >
            {starting ? t("plans.starting") : t("plans.start")}
          </button>
        </div>
      </div>

      {/* PDCA Pipeline 组件 */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
        {activeTaskId ? (
          <PdcaPipeline taskId={activeTaskId} />
        ) : (
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">
            {t("plans.noActivePdca")}
          </p>
        )}
      </div>
    </div>
  );
}

/* ========== 看板视图 ========== */

function KanbanView() {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <KanbanBoard />
    </div>
  );
}
