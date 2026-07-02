/**
 * 工作流模板市场视图
 *
 * 浏览内建和用户自定义工作流模板，可创建、编辑、删除自定义模板
 */
import React, { useState, useEffect, useCallback } from "react";
import { workspaceService } from "@/services/workspaceService";
import { createLogger } from "@/utils/logger";

const logger = createLogger("components:workflowTemplate");

interface WorkflowStep {
  id: string;
  name: string;
  description: string;
  type: string;
  dependsOn?: string[];
  suggestedAgentRole?: string;
}

interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  steps: WorkflowStep[];
  author: string;
  isPublic: boolean;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
  tags?: string[];
}

const CATEGORY_LABELS: Record<string, string> = {
  development: "开发",
  maintenance: "维护",
  database: "数据库",
  custom: "自定义",
};

const STEP_TYPE_LABELS: Record<string, string> = {
  auto: "自动",
  manual: "手动",
  review: "审查",
};

const STEP_TYPE_COLORS: Record<string, string> = {
  auto: "bg-blue-100 text-blue-700",
  manual: "bg-yellow-100 text-yellow-700",
  review: "bg-purple-100 text-purple-700",
};

export const WorkflowTemplateView: React.FC = () => {
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<WorkflowTemplate | null>(null);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newCategory, setNewCategory] = useState("custom");

  /** 加载模板列表 */
  const loadTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const data = await workspaceService.getWorkflowTemplates() as WorkflowTemplate[];
      setTemplates(data);
    } catch (err) {
      logger.error("加载工作流模板失败:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  /** 创建模板 */
  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      await workspaceService.createWorkflowTemplate({
        name: newName.trim(),
        description: newDesc.trim(),
        category: newCategory,
        steps: [
          {
            id: "step_1",
            name: "步骤 1",
            description: "请编辑此步骤",
            type: "auto",
          },
        ],
      });
      setNewName("");
      setNewDesc("");
      setNewCategory("custom");
      setShowCreate(false);
      loadTemplates();
    } catch (err) {
      logger.error("创建模板失败:", err);
    }
  };

  /** 删除模板 */
  const handleDelete = async (templateId: string) => {
    if (!confirm("确定要删除此模板吗？")) return;
    try {
      await workspaceService.deleteWorkflowTemplate(templateId);
      if (selectedTemplate?.id === templateId) setSelectedTemplate(null);
      loadTemplates();
    } catch (err) {
      logger.error("删除模板失败:", err);
    }
  };

  return (
    <div className="flex h-full">
      {/* 模板列表 */}
      <div className="w-72 border-r border-gray-200 p-4 overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-700">工作流模板</h3>
          <button
            onClick={() => setShowCreate(true)}
            className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            + 新建
          </button>
        </div>

        {loading ? (
          <div className="text-sm text-gray-400">加载中...</div>
        ) : (
          <div className="space-y-2">
            {templates.map((tpl) => (
              <div
                key={tpl.id}
                onClick={() => setSelectedTemplate(tpl)}
                className={`p-2 rounded cursor-pointer border ${
                  selectedTemplate?.id === tpl.id
                    ? "border-blue-300 bg-blue-50"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="font-medium text-sm truncate">{tpl.name}</div>
                  {tpl.id.startsWith("builtin:") && (
                    <span className="px-1.5 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">
                      内建
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-400 mt-1">
                  {CATEGORY_LABELS[tpl.category] || tpl.category} · {tpl.steps.length} 步骤
                </div>
                {tpl.tags && tpl.tags.length > 0 && (
                  <div className="flex gap-1 mt-1">
                    {tpl.tags.map((tag) => (
                      <span key={tag} className="px-1.5 py-0.5 text-xs bg-gray-50 rounded">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 创建模板弹窗 */}
        {showCreate && (
          <div className="mt-3 p-3 bg-gray-50 rounded border">
            <input
              className="w-full border px-2 py-1 text-sm rounded mb-2"
              placeholder="模板名称"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <input
              className="w-full border px-2 py-1 text-sm rounded mb-2"
              placeholder="描述"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
            />
            <select
              className="w-full border px-2 py-1 text-sm rounded mb-2"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
            >
              {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <div className="flex gap-2">
              <button
                onClick={handleCreate}
                className="px-3 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                创建
              </button>
              <button
                onClick={() => setShowCreate(false)}
                className="px-3 py-1 text-xs bg-gray-300 rounded hover:bg-gray-400"
              >
                取消
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 模板详情 */}
      <div className="flex-1 p-4 overflow-y-auto">
        {selectedTemplate ? (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold">{selectedTemplate.name}</h2>
                  {selectedTemplate.id.startsWith("builtin:") && (
                    <span className="px-1.5 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">
                      内建
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-500 mt-1">{selectedTemplate.description}</p>
              </div>
              {!selectedTemplate.id.startsWith("builtin:") && (
                <button
                  onClick={() => handleDelete(selectedTemplate.id)}
                  className="px-3 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600"
                >
                  删除
                </button>
              )}
            </div>

            {/* 元信息 */}
            <div className="flex gap-4 text-xs text-gray-400 mb-4">
              <span>作者: {selectedTemplate.author}</span>
              <span>分类: {CATEGORY_LABELS[selectedTemplate.category] || selectedTemplate.category}</span>
              <span>使用次数: {selectedTemplate.usageCount}</span>
              <span>创建: {new Date(selectedTemplate.createdAt).toLocaleDateString()}</span>
            </div>

            {/* 工作流步骤 */}
            <h3 className="font-medium text-gray-700 mb-3">
              工作流步骤 ({selectedTemplate.steps.length})
            </h3>
            <div className="space-y-3">
              {selectedTemplate.steps.map((step, idx) => (
                <div key={step.id} className="flex items-start gap-3 p-3 bg-gray-50 rounded">
                  <div className="flex-shrink-0 w-6 h-6 bg-blue-500 text-white rounded-full flex items-center justify-center text-xs font-bold">
                    {idx + 1}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{step.name}</span>
                      <span className={`px-1.5 py-0.5 text-xs rounded ${STEP_TYPE_COLORS[step.type] || ""}`}>
                        {STEP_TYPE_LABELS[step.type] || step.type}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{step.description}</p>
                    <div className="flex gap-2 mt-1">
                      {step.dependsOn && step.dependsOn.length > 0 && (
                        <span className="text-xs text-gray-400">
                          依赖: {step.dependsOn.join(", ")}
                        </span>
                      )}
                      {step.suggestedAgentRole && (
                        <span className="text-xs text-purple-500">
                          建议 Agent: {step.suggestedAgentRole}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-gray-400 text-center mt-20">
            选择一个工作流模板查看详情
          </div>
        )}
      </div>
    </div>
  );
};