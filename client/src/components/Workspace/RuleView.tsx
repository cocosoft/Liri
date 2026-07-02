/**
 * 规则管理视图
 *
 * 按专业归口展示和管理规则文件。
 * 支持查看、编辑、追加规则内容。
 */
import React, { useState, useEffect } from "react";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { workspaceService } from "../../services/workspaceService";
import { createLogger } from "@/utils/logger";

const logger = createLogger("components:ruleView");

/** 专业领域 */
type Specialization = "all" | "security" | "performance" | "architecture" | "data" | "frontend" | "backend" | "test" | "custom";

/** 规则项 */
interface RuleItem {
  specialization: Specialization;
  filePath: string;
  exists: boolean;
}

/** 专业领域标签 */
const SPEC_LABELS: Record<Specialization, string> = {
  all: "全局",
  security: "安全",
  performance: "性能",
  architecture: "架构",
  data: "数据",
  frontend: "前端",
  backend: "后端",
  test: "测试",
  custom: "自定义",
};

/** 专业领域图标 */
const SPEC_ICONS: Record<Specialization, string> = {
  all: "\u{1F310}",
  security: "\u{1F6E1}\uFE0F",
  performance: "\u26A1",
  architecture: "\u{1F3D7}\uFE0F",
  data: "\u{1F4BE}",
  frontend: "\u{1F3A8}",
  backend: "\u{2699}\uFE0F",
  test: "\u{1F9EA}",
  custom: "\u{1F4DD}",
};

/**
 * 规则管理视图
 */
export const RuleView: React.FC = () => {
  const { currentWorkspace } = useWorkspaceStore();
  const [rules, setRules] = useState<RuleItem[]>([]);
  const [selectedSpec, setSelectedSpec] = useState<Specialization | null>(null);
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [overview, setOverview] = useState("");

  /** 加载规则列表 */
  const loadRules = async () => {
    if (!currentWorkspace) return;
    setLoading(true);
    try {
      const res = await workspaceService.listRules(currentWorkspace.id);
      setRules(res as RuleItem[]);
    } catch (e) {
      logger.error("加载规则列表失败", e);
    } finally {
      setLoading(false);
    }
  };

  /** 加载规则总览 */
  const loadOverview = async () => {
    if (!currentWorkspace) return;
    try {
      const res = await workspaceService.getRulesOverview(currentWorkspace.id);
      const data = res as { overview: string };
      setOverview(data.overview);
    } catch (e) {
      logger.error("加载规则总览失败", e);
    }
  };

  /** 选择规则并加载内容 */
  const selectRule = async (spec: Specialization) => {
    setSelectedSpec(spec);
    if (!currentWorkspace) return;

    try {
      const res = await workspaceService.getRule(currentWorkspace.id, spec);
      const data = res as { content: string; exists: boolean };
      setContent(data.content);
      setOriginalContent(data.content);
    } catch (e) {
      setContent("");
      setOriginalContent("");
    }
  };

  /** 保存规则 */
  const saveRule = async () => {
    if (!currentWorkspace || !selectedSpec) return;
    setSaving(true);
    try {
      await workspaceService.writeRule(currentWorkspace.id, selectedSpec, content);
      await loadRules();
      await loadOverview();
    } catch (e) {
      logger.error("保存规则失败", e);
    } finally {
      setSaving(false);
    }
  };

  /** 是否有未保存的修改 */
  const hasChanges = content !== originalContent;

  useEffect(() => {
    loadRules();
    loadOverview();
  }, [currentWorkspace]);

  return (
    <div className="flex h-full">
      {/* 左侧：规则列表 */}
      <div className="w-48 border-r border-gray-200 dark:border-gray-700 overflow-y-auto bg-gray-50 dark:bg-gray-900">
        <div className="p-3 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">规则分类</h3>
        </div>
        {loading && <p className="text-xs text-center text-gray-400 p-4">加载中...</p>}
        {rules.map((rule) => (
          <button
            key={rule.specialization}
            onClick={() => selectRule(rule.specialization)}
            className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
              selectedSpec === rule.specialization
                ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400"
                : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
            }`}
          >
            <span>{SPEC_ICONS[rule.specialization]}</span>
            <span className="flex-1">{SPEC_LABELS[rule.specialization]}</span>
            <span className={`w-2 h-2 rounded-full ${rule.exists ? "bg-green-500" : "bg-gray-300"}`} />
          </button>
        ))}
      </div>

      {/* 右侧：规则编辑 + 总览 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedSpec ? (
          <>
            {/* 编辑区头部 */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
              <div className="flex items-center gap-2">
                <span>{SPEC_ICONS[selectedSpec]}</span>
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {SPEC_LABELS[selectedSpec]}规则
                </span>
                {hasChanges && (
                  <span className="text-xs text-orange-500">(未保存)</span>
                )}
              </div>
              <button
                onClick={saveRule}
                disabled={saving || !hasChanges}
                className="px-3 py-1 text-xs bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? "保存中..." : "保存"}
              </button>
            </div>

            {/* 编辑区 */}
            <textarea
              className="flex-1 w-full p-4 text-sm font-mono border-0 resize-none bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 focus:outline-none"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="在此编写规则（Markdown 格式）..."
              spellCheck={false}
            />
          </>
        ) : (
          /* 规则总览 */
          <div className="flex-1 overflow-y-auto p-4">
            <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">规则总览</h3>
            <pre className="text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap font-mono">
              {overview || "暂无规则"}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};