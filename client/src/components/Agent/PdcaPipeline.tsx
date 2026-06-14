import { useState, useEffect } from "react";
import { httpLegacy as http } from "../../services/httpClient";

interface ReviewIssue {
  severity: string;
  description: string;
  suggestion?: string;
}

interface PlanReview {
  stepId: string;
  pass: boolean;
  score: number;
  issues: ReviewIssue[];
  summary: string;
}

interface PlanStep {
  id: string;
  description: string;
  status: string;
  acceptanceCriteria?: string;
  reviewResult?: PlanReview;
  retryCount: number;
  maxRetries: number;
  decision?: string;
  result?: string;
  error?: string;
}

interface Plan {
  id: string;
  description: string;
  steps: PlanStep[];
  status: string;
}

interface PdcaStatus {
  taskId: string;
  planId: string;
  phase: string;
  plan?: Plan;
  progress?: {
    total: number;
    pending: number;
    running: number;
    completed: number;
    failed: number;
    cancelled: number;
    percent: number;
  };
  currentStep?: PlanStep;
  audit?: {
    completedSteps: number;
    failedSteps: number;
    totalSteps: number;
    totalDurationMs: number;
    totalRetries: number;
    summary: string;
  };
}

interface PdcaPipelineProps {
  taskId: string;
}

const PHASE_ICONS: Record<string, string> = {
  plan: "📋",
  execute: "🏗",
  review: "🔍",
  decide: "✅",
  completed: "🎉",
};

const PHASE_NAMES: Record<string, string> = {
  plan: "Plan 规划",
  execute: "Execute 执行",
  review: "Review 审查",
  decide: "Decide 决策",
  completed: "完成",
};

const STATUS_COLOR: Record<string, string> = {
  pending: "bg-yellow-400",
  running: "bg-blue-400 animate-pulse",
  completed: "bg-green-400",
  failed: "bg-red-400",
  cancelled: "bg-gray-400",
};

const STATUS_TEXT: Record<string, string> = {
  pending: "待执行",
  running: "执行中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已跳过",
};

const DECISION_TEXT: Record<string, string> = {
  approved: "✅ 通过",
  retry: "🔄 重试",
  skip: "⏭ 跳过",
  escalate: "⚠ 上报",
};

export default function PdcaPipeline({ taskId }: PdcaPipelineProps) {
  const [status, setStatus] = useState<PdcaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await http.get<PdcaStatus>(`/v1/pdca/${taskId}`);
      if (typeof res === "object" && res !== null && "taskId" in res) {
        setStatus(res as PdcaStatus);
        setNotFound(false);
      }
    } catch {
      // 404/500 — 无 PDCA 任务关联，停止轮询
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [taskId]);

  // 仅在状态非空且非 404 时启动轮询
  useEffect(() => {
    if (notFound || !status) return;
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [notFound, status, taskId]);

  const handleReview = async (stepId: string) => {
    setActionLoading(stepId);
    try {
      await http.post(`/v1/pdca/${taskId}/step/${stepId}/review`);
      load();
    } catch {
    } finally {
      setActionLoading(null);
    }
  };

  const handleDecide = async (stepId: string, decision: string) => {
    setActionLoading(stepId);
    try {
      await http.post(`/v1/pdca/${taskId}/step/${stepId}/decide`, { decision });
      load();
    } catch {
    } finally {
      setActionLoading(null);
    }
  };

  if (loading && !status) {
    return (
      <div className="flex items-center justify-center py-6">
        <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!status || !status.plan) {
    return (
      <div className="space-y-3">
        <div className="text-center py-4">
          <p className="text-xs text-gray-400">暂无 PDCA 任务</p>
          <button
            onClick={load}
            className="mt-2 text-xs text-blue-600 hover:text-blue-800"
          >
            刷新
          </button>
        </div>
      </div>
    );
  }

  const { plan, progress, phase, audit } = status;

  return (
    <div className="space-y-3 max-h-[400px] overflow-y-auto">
      {/* Phase 指示器 */}
      <div className="flex items-center gap-1.5">
        {(["plan", "execute", "review", "decide", "completed"] as const).map(
          (p) => (
            <div
              key={p}
              className={`flex-1 flex flex-col items-center ${
                phase === p ? "opacity-100" : "opacity-40"
              }`}
            >
              <span className="text-sm">{PHASE_ICONS[p]}</span>
              <span className="text-[9px] text-gray-500 dark:text-gray-400 mt-0.5">
                {PHASE_NAMES[p].split(" ")[0]}
              </span>
              {phase === p && (
                <div className="w-full h-0.5 bg-blue-500 mt-1 rounded" />
              )}
            </div>
          ),
        )}
      </div>

      {/* 总体进度 */}
      {progress && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-500">总体进度</span>
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
              {progress.percent}%
            </span>
          </div>
          <div className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-300"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          <div className="flex justify-between mt-1 text-[10px] text-gray-400">
            <span>✅ {progress.completed}</span>
            <span>🔄 {progress.running}</span>
            <span>⏳ {progress.pending}</span>
            <span>❌ {progress.failed}</span>
          </div>
        </div>
      )}

      {/* 步骤列表 */}
      <div>
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 block">
          步骤 ({plan.steps.length})
        </span>
        <div className="space-y-1.5">
          {plan.steps.map((step, si) => (
            <div
              key={step.id}
              className="border border-gray-200 dark:border-gray-700 rounded"
            >
              {/* Step Header */}
              <button
                onClick={() =>
                  setExpandedStep(expandedStep === step.id ? null : step.id)
                }
                className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700/50"
              >
                <span className="w-4 h-4 flex items-center justify-center rounded-full border border-gray-300 dark:border-gray-600 text-[9px] text-gray-500 shrink-0">
                  {step.retryCount > 0 ? `R${step.retryCount}` : si + 1}
                </span>
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_COLOR[step.status] || "bg-gray-300"}`}
                />
                <span className="text-xs text-gray-700 dark:text-gray-300 truncate flex-1 text-left">
                  {step.description}
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  {step.reviewResult && (
                    <span
                      className={`text-[9px] font-medium ${
                        step.reviewResult.pass
                          ? "text-green-600"
                          : "text-red-500"
                      }`}
                    >
                      {step.reviewResult.score}
                    </span>
                  )}
                  {step.decision && (
                    <span className="text-[9px] text-gray-500">
                      {DECISION_TEXT[step.decision] || step.decision}
                    </span>
                  )}
                </div>
              </button>

              {/* Expanded Detail */}
              {expandedStep === step.id && (
                <div className="px-3 pb-2 space-y-1.5 border-t border-gray-100 dark:border-gray-700">
                  <div className="flex items-center gap-4 text-[10px] text-gray-400 pt-1.5">
                    <span>状态: {STATUS_TEXT[step.status] || step.status}</span>
                    <span>
                      重试: {step.retryCount}/{step.maxRetries}
                    </span>
                  </div>

                  {step.acceptanceCriteria && (
                    <div className="text-[10px] text-gray-500 bg-gray-50 dark:bg-gray-700/30 p-1.5 rounded">
                      <span className="font-medium">验收标准:</span>{" "}
                      {step.acceptanceCriteria}
                    </div>
                  )}

                  {step.reviewResult && (
                    <div
                      className={`text-[10px] p-1.5 rounded ${
                        step.reviewResult.pass
                          ? "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300"
                          : "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300"
                      }`}
                    >
                      <div className="font-medium">
                        {step.reviewResult.pass ? "审查通过" : "审查未通过"}{" "}
                        ({step.reviewResult.score}分)
                      </div>
                      {step.reviewResult.summary && (
                        <div className="mt-0.5">
                          {step.reviewResult.summary}
                        </div>
                      )}
                      {step.reviewResult.issues.map((issue, i) => (
                        <div key={i} className="mt-0.5 flex items-start gap-1">
                          <span
                            className={`shrink-0 mt-0.5 w-1 h-1 rounded-full ${
                              issue.severity === "critical"
                                ? "bg-red-500"
                                : issue.severity === "major"
                                  ? "bg-orange-500"
                                  : "bg-yellow-400"
                            }`}
                          />
                          <span>{issue.description}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {step.error && (
                    <div className="text-[10px] text-red-500 bg-red-50 dark:bg-red-900/20 p-1.5 rounded">
                      {step.error}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-1 pt-1">
                    {step.status === "completed" && !step.reviewResult && (
                      <button
                        onClick={() => handleReview(step.id)}
                        disabled={actionLoading === step.id}
                        className="text-[10px] px-2 py-0.5 bg-purple-600 hover:bg-purple-700 text-white rounded"
                      >
                        {actionLoading === step.id ? "..." : "审查"}
                      </button>
                    )}
                    {step.reviewResult && !step.decision && (
                      <>
                        <button
                          onClick={() => handleDecide(step.id, "approved")}
                          className="text-[10px] px-2 py-0.5 bg-green-600 hover:bg-green-700 text-white rounded"
                        >
                          通过
                        </button>
                        <button
                          onClick={() => handleDecide(step.id, "retry")}
                          disabled={step.retryCount >= step.maxRetries}
                          className="text-[10px] px-2 py-0.5 bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50"
                        >
                          重试
                        </button>
                        <button
                          onClick={() => handleDecide(step.id, "skip")}
                          className="text-[10px] px-2 py-0.5 bg-gray-600 hover:bg-gray-700 text-white rounded"
                        >
                          跳过
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 审计报告摘要 */}
      {audit && (
        <div className="border-t border-gray-100 dark:border-gray-700 pt-2">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">
            审计报告
          </span>
          <div className="text-[10px] text-gray-500 space-y-0.5 bg-gray-50 dark:bg-gray-700/30 p-1.5 rounded">
            <div>{audit.completedSteps}/{audit.totalSteps} 步骤完成</div>
            {audit.failedSteps > 0 && (
              <div className="text-red-500">{audit.failedSteps} 步骤失败</div>
            )}
            <div>总耗时: {(audit.totalDurationMs / 1000).toFixed(1)}s</div>
            {audit.totalRetries > 0 && <div>总重试: {audit.totalRetries}</div>}
            <div className="text-gray-600 dark:text-gray-300">
              {audit.summary}
            </div>
          </div>
        </div>
      )}

      {/* 刷新 */}
      <button
        onClick={load}
        className="w-full text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 py-0.5"
      >
        刷新状态
      </button>
    </div>
  );
}
