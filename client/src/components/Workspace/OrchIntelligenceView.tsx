/**
 * 编排智能视图
 *
 * 展示 AI 编排智能的 5 项特性：
 * 1. 变更影响评估 — 输入文件列表，分析影响范围
 * 2. 风险识别 — 输入工作项描述，检测潜在风险
 * 3. 决策分级 — 输入工作项，判断审批级别
 * 4. 异常升级 — 查看活跃异常
 * 5. 资源调度 — 查看资源状态
 */
import React, { useState, useEffect } from "react";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { workspaceService } from "../../services/workspaceService";

/** Tab 类型 */
type IntellTab = "impact" | "risks" | "decision" | "escalations" | "resources";

const TAB_CONFIG: { key: IntellTab; label: string; icon: string }[] = [
  { key: "impact", label: "影响评估", icon: "\u{1F4CA}" },
  { key: "risks", label: "风险识别", icon: "\u26A0\uFE0F" },
  { key: "decision", label: "决策分级", icon: "\u{1F3DB}\uFE0F" },
  { key: "escalations", label: "异常升级", icon: "\u{1F514}" },
  { key: "resources", label: "资源调度", icon: "\u{1F504}" },
];

/** 影响评估结果 */
interface ImpactResult {
  affectedFiles: string[];
  affectedModules: string[];
  impactLevel: string;
  description: string;
  testSuggestions: string[];
  isBreaking: boolean;
  dependencyChain: string[];
}

/** 风险项 */
interface RiskItem {
  id: string;
  description: string;
  level: string;
  category: string;
  trigger: string;
  mitigation: string;
  mitigated: boolean;
}

/** 决策结果 */
interface DecisionResult {
  type: string;
  reason: string;
  requiredApprover?: string;
  aiProposal?: string;
  evidence: string[];
}

/** 异常项 */
interface EscalationItem {
  type: string;
  workItemId: string;
  description: string;
  occurrenceCount: number;
  lastOccurrence: number;
  suggestedDirection: string;
}

/** 资源状态 */
interface ResourceStatus {
  resource: string;
  lockedBy: string | null;
  queueLength: number;
}

/** 风险等级颜色 */
const LEVEL_COLORS: Record<string, string> = {
  critical: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  high: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
  medium: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  low: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  none: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
};

/** 决策类型标签 */
const DECISION_LABELS: Record<string, string> = {
  ai_auto: "AI 自决",
  ai_propose_human_confirm: "AI 出方案 / 人确认",
  human_required: "人必须审",
};

/**
 * 影响评估面板
 */
function ImpactPanel() {
  const { currentWorkspace } = useWorkspaceStore();
  const [files, setFiles] = useState("");
  const [content, setContent] = useState("");
  const [result, setResult] = useState<ImpactResult | null>(null);
  const [loading, setLoading] = useState(false);

  const handleAnalyze = async () => {
    if (!files.trim()) return;
    setLoading(true);
    try {
      const res = await workspaceService.analyzeImpact(
        currentWorkspace?.id || "",
        { changedFiles: files.split("\n").filter(Boolean), changedContent: content }
      );
      setResult(res as ImpactResult);
    } catch (e) {
      console.error("影响评估失败", e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
          变更文件列表（每行一个）
        </label>
        <textarea
          className="w-full h-24 text-sm border border-gray-200 dark:border-gray-700 rounded-md p-2 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 resize-none"
          value={files}
          onChange={(e) => setFiles(e.target.value)}
          placeholder="src/utils/cache.ts&#10;src/types/common.ts"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
          变更内容摘要（可选）
        </label>
        <textarea
          className="w-full h-16 text-sm border border-gray-200 dark:border-gray-700 rounded-md p-2 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 resize-none"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="修改了缓存过期策略..."
        />
      </div>
      <button
        onClick={handleAnalyze}
        disabled={loading || !files.trim()}
        className="w-full py-2 text-sm bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "分析中..." : "分析影响范围"}
      </button>

      {result && (
        <div className="border border-gray-200 dark:border-gray-700 rounded-md p-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2 py-0.5 rounded ${LEVEL_COLORS[result.impactLevel] || ""}`}>
              {result.impactLevel}
            </span>
            {result.isBreaking && (
              <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300">
                破坏性变更
              </span>
            )}
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">{result.description}</p>
          <div>
            <p className="text-xs text-gray-500 font-medium">受影响模块</p>
            <div className="flex flex-wrap gap-1 mt-1">
              {result.affectedModules.map((m) => (
                <span key={m} className="text-xs px-2 py-0.5 bg-gray-100 dark:bg-gray-800 rounded">{m}</span>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium">测试建议</p>
            {result.testSuggestions.map((t, i) => (
              <p key={i} className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">{t}</p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 风险识别面板
 */
function RiskPanel() {
  const { currentWorkspace } = useWorkspaceStore();
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [risks, setRisks] = useState<RiskItem[]>([]);
  const [summary, setSummary] = useState("");
  const [loading, setLoading] = useState(false);

  const handleDetect = async () => {
    if (!title.trim()) return;
    setLoading(true);
    try {
      const res = await workspaceService.detectRisks(
        currentWorkspace?.id || "",
        { title, description: desc, changedFiles: [] }
      );
      const data = res as { risks: RiskItem[]; summary: string };
      setRisks(data.risks);
      setSummary(data.summary);
    } catch (e) {
      console.error("风险识别失败", e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
          工作项标题
        </label>
        <input
          className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-md p-2 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="修复登录页面的 SQL 注入漏洞"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
          工作项描述（可选）
        </label>
        <textarea
          className="w-full h-16 text-sm border border-gray-200 dark:border-gray-700 rounded-md p-2 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 resize-none"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="使用 raw SQL 拼接查询..."
        />
      </div>
      <button
        onClick={handleDetect}
        disabled={loading || !title.trim()}
        className="w-full py-2 text-sm bg-orange-500 text-white rounded-md hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "检测中..." : "检测风险"}
      </button>

      {summary && (
        <p className="text-sm text-gray-600 dark:text-gray-400 font-medium">{summary}</p>
      )}
      {risks.map((risk) => (
        <div key={risk.id} className="border border-gray-200 dark:border-gray-700 rounded-md p-3 space-y-1">
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2 py-0.5 rounded ${LEVEL_COLORS[risk.level] || ""}`}>
              {risk.level}
            </span>
            <span className="text-xs text-gray-500">{risk.category}</span>
          </div>
          <p className="text-sm text-gray-700 dark:text-gray-300">{risk.description}</p>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-400">触发条件:</span>
            <code className="text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-1 rounded">{risk.trigger}</code>
          </div>
          <p className="text-xs text-green-600 dark:text-green-400">{risk.mitigation}</p>
        </div>
      ))}
      {!loading && risks.length === 0 && summary && (
        <p className="text-sm text-center text-gray-400">未检测到风险</p>
      )}
    </div>
  );
}

/**
 * 决策分级面板
 */
function DecisionPanel() {
  const { currentWorkspace } = useWorkspaceStore();
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [result, setResult] = useState<DecisionResult | null>(null);
  const [loading, setLoading] = useState(false);

  const handleClassify = async () => {
    if (!title.trim()) return;
    setLoading(true);
    try {
      const res = await workspaceService.classifyDecision(
        currentWorkspace?.id || "",
        { title, description: desc }
      );
      setResult(res as DecisionResult);
    } catch (e) {
      console.error("决策分级失败", e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
          工作项标题
        </label>
        <input
          className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-md p-2 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="删除用户表并重建索引"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
          工作项描述（可选）
        </label>
        <textarea
          className="w-full h-16 text-sm border border-gray-200 dark:border-gray-700 rounded-md p-2 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 resize-none"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
        />
      </div>
      <button
        onClick={handleClassify}
        disabled={loading || !title.trim()}
        className="w-full py-2 text-sm bg-purple-500 text-white rounded-md hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "分级中..." : "决策分级"}
      </button>

      {result && (
        <div className="border border-gray-200 dark:border-gray-700 rounded-md p-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-lg font-medium text-gray-700 dark:text-gray-300">
              {DECISION_LABELS[result.type] || result.type}
            </span>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">{result.reason}</p>
          {result.requiredApprover && (
            <p className="text-xs text-gray-500">
              审批人: <span className="font-medium">{result.requiredApprover}</span>
            </p>
          )}
          {result.evidence.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 font-medium">决策依据</p>
              {result.evidence.map((e, i) => (
                <p key={i} className="text-xs text-gray-600 dark:text-gray-400">{e}</p>
              ))}
            </div>
          )}
          {result.aiProposal && (
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-md p-2">
              <p className="text-xs text-blue-600 dark:text-blue-400 whitespace-pre-wrap">{result.aiProposal}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 异常升级面板
 */
function EscalationsPanel() {
  const { currentWorkspace } = useWorkspaceStore();
  const [escalations, setEscalations] = useState<EscalationItem[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchEscalations = async () => {
    setLoading(true);
    try {
      const res = await workspaceService.getEscalations(currentWorkspace?.id || "");
      setEscalations(res as EscalationItem[]);
    } catch (e) {
      console.error("获取异常列表失败", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEscalations();
  }, []);

  return (
    <div className="p-4 space-y-3">
      <button
        onClick={fetchEscalations}
        disabled={loading}
        className="w-full py-2 text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700"
      >
        {loading ? "刷新中..." : "刷新异常列表"}
      </button>

      {escalations.length === 0 && !loading && (
        <p className="text-sm text-center text-gray-400 py-8">暂无活跃异常</p>
      )}
      {escalations.map((esc, i) => (
        <div key={i} className="border border-gray-200 dark:border-gray-700 rounded-md p-3 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-500">{esc.type}</span>
            <span className="text-xs text-gray-400">×{esc.occurrenceCount}</span>
          </div>
          <p className="text-sm text-gray-700 dark:text-gray-300">{esc.description}</p>
          <p className="text-xs text-gray-500">工作项: {esc.workItemId}</p>
          <p className="text-xs text-blue-600 dark:text-blue-400">{esc.suggestedDirection}</p>
        </div>
      ))}
    </div>
  );
}

/**
 * 资源调度面板
 */
function ResourcesPanel() {
  const { currentWorkspace } = useWorkspaceStore();
  const [resources, setResources] = useState<ResourceStatus[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchResources = async () => {
    setLoading(true);
    try {
      const res = await workspaceService.getResources(currentWorkspace?.id || "");
      setResources(res as ResourceStatus[]);
    } catch (e) {
      console.error("获取资源状态失败", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchResources();
  }, []);

  return (
    <div className="p-4 space-y-3">
      <button
        onClick={fetchResources}
        disabled={loading}
        className="w-full py-2 text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700"
      >
        {loading ? "刷新中..." : "刷新资源状态"}
      </button>

      {resources.length === 0 && !loading && (
        <p className="text-sm text-center text-gray-400 py-8">暂无活跃资源</p>
      )}
      {resources.map((r, i) => (
        <div key={i} className="border border-gray-200 dark:border-gray-700 rounded-md p-3 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{r.resource}</p>
            <p className="text-xs text-gray-500">
              {r.lockedBy ? `占用: ${r.lockedBy}` : "空闲"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${r.lockedBy ? "bg-red-500" : "bg-green-500"}`} />
            {r.queueLength > 0 && (
              <span className="text-xs text-yellow-600 dark:text-yellow-400">
                排队 {r.queueLength}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * 编排智能主视图
 */
export const OrchIntelligenceView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<IntellTab>("impact");

  return (
    <div className="flex flex-col h-full">
      {/* Tab 导航 */}
      <div className="flex border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2">
        {TAB_CONFIG.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1 px-3 py-2 text-xs border-b-2 transition-colors ${
              activeTab === tab.key
                ? "border-blue-500 text-blue-600 dark:text-blue-400 font-medium"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
            }`}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* 内容 */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "impact" && <ImpactPanel />}
        {activeTab === "risks" && <RiskPanel />}
        {activeTab === "decision" && <DecisionPanel />}
        {activeTab === "escalations" && <EscalationsPanel />}
        {activeTab === "resources" && <ResourcesPanel />}
      </div>
    </div>
  );
};