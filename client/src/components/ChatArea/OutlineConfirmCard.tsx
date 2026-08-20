/**
 * OutlineConfirmCard — 大纲确认卡片（设计方案 §4.5 M3）
 *
 * 阶段①完成后展示给用户确认的大纲卡片：
 *  - 显示文档标题、格式、所有节点（标题 + 要点 + 配图标记）
 *  - 用户可"确认大纲"进入阶段②，或"修改"反馈调整意见
 *  - PPT 格式时展示精炼规则违规提示
 *
 * 交互方式：复用 QuestionBlock 的按钮交互模式
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";

interface OutlineNode {
  id: string;
  kind: "section" | "slide" | "chart" | "text";
  title: string;
  bullets?: string[];
  hasImage?: boolean;
  violations?: string[];
}

interface OutlineConfirmCardProps {
  title: string;
  format: "docx" | "pptx" | "html" | "pdf";
  nodes: OutlineNode[];
  onConfirm: () => void;
  onModify: (feedback: string) => void;
}

export function OutlineConfirmCard({
  title,
  format,
  nodes,
  onConfirm,
  onModify,
}: OutlineConfirmCardProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [feedback, setFeedback] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const slideCount = nodes.filter((n) => n.kind === "slide").length;
  const sectionCount = nodes.filter((n) => n.kind === "section").length;
  const imageCount = nodes.filter((n) => n.hasImage).length;
  const allViolations = nodes.flatMap((n) =>
    (n.violations || []).map((v) => ({ nodeId: n.id, violation: v })),
  );

  const handleConfirm = () => {
    setConfirmed(true);
    onConfirm();
  };

  const handleModify = () => {
    if (feedback.trim()) {
      onModify(feedback.trim());
      setFeedback("");
      setMode("view");
    }
  };

  if (confirmed) {
    return (
      <div className="rounded-lg border border-green-700/40 bg-green-900/10 px-4 py-2.5 max-w-[600px]">
        <div className="flex items-center gap-2">
          <span className="text-sm">✅</span>
          <span className="text-sm text-green-400">
            {t("docWorkflow.outlineConfirmed")}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-700/50 bg-gray-800/40 overflow-hidden max-w-[600px]">
      {/* 头部 */}
      <div className="px-4 py-3 border-b border-gray-700/30 bg-gray-800/60">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base">📋</span>
            <span className="text-sm font-medium text-gray-200">
              {t("docWorkflow.outlineConfirmTitle")}
            </span>
          </div>
          <span className="text-xs px-1.5 py-0.5 rounded bg-gray-700/50 text-gray-400 font-mono">
            {format.toUpperCase()}
          </span>
        </div>
        <p className="text-sm text-gray-300 mt-1 font-medium">{title}</p>
        <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500">
          {sectionCount > 0 && (
            <span>
              {sectionCount} {t("docWorkflow.sections")}
            </span>
          )}
          {slideCount > 0 && (
            <span>
              {slideCount} {t("docWorkflow.slides")}
            </span>
          )}
          {imageCount > 0 && (
            <span className="text-purple-400">
              {imageCount} {t("docWorkflow.images")}
            </span>
          )}
        </div>
      </div>

      {/* 大纲节点列表 */}
      <div className="max-h-[300px] overflow-y-auto px-4 py-2 space-y-1">
        {nodes.map((node, idx) => (
          <div
            key={node.id}
            className="flex items-start gap-2 py-1 px-2 rounded hover:bg-gray-800/40"
          >
            <span className="text-xs text-gray-600 font-mono mt-0.5">
              {String(idx + 1).padStart(2, "0")}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs">
                  {node.kind === "slide" ? "🖼️" : "📄"}
                </span>
                <span className="text-sm text-gray-200 truncate">
                  {node.title}
                </span>
                {node.hasImage && (
                  <span className="text-xs text-purple-400">🖼️</span>
                )}
                {node.violations && node.violations.length > 0 && (
                  <span className="text-xs text-amber-400">⚠️</span>
                )}
              </div>
              {node.bullets && node.bullets.length > 0 && (
                <ul className="mt-0.5 ml-5 space-y-0.5">
                  {node.bullets.map((bullet, bi) => (
                    <li
                      key={bi}
                      className="text-xs text-gray-400 flex items-start gap-1"
                    >
                      <span className="text-gray-600">•</span>
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* PPT 精炼违规提示 */}
      {allViolations.length > 0 && (
        <div className="px-4 py-2 border-t border-amber-700/20 bg-amber-900/10">
          <p className="text-xs text-amber-400 mb-1">
            ⚠️ {allViolations.length} {t("docWorkflow.pptViolations")}
          </p>
          <ul className="space-y-0.5 max-h-[60px] overflow-y-auto">
            {allViolations.slice(0, 5).map((v, i) => (
              <li
                key={i}
                className="text-xs text-amber-300/70 flex items-start gap-1"
              >
                <span className="text-amber-700">•</span>
                <span>
                  [{v.nodeId}] {v.violation}
                </span>
              </li>
            ))}
            {allViolations.length > 5 && (
              <li className="text-xs text-amber-500">
                ... {allViolations.length - 5} {t("docWorkflow.moreViolations")}
              </li>
            )}
          </ul>
        </div>
      )}

      {/* 操作区 */}
      <div className="px-4 py-3 border-t border-gray-700/30 bg-gray-800/60">
        {mode === "view" ? (
          <div className="flex items-center gap-2">
            <button
              onClick={handleConfirm}
              className="px-3 py-1.5 text-sm rounded-md bg-green-700/60 hover:bg-green-700/80 text-white transition-colors"
            >
              ✅ {t("docWorkflow.confirmOutline")}
            </button>
            <button
              onClick={() => setMode("edit")}
              className="px-3 py-1.5 text-sm rounded-md bg-gray-700/60 hover:bg-gray-700/80 text-gray-200 transition-colors"
            >
              ✏️ {t("docWorkflow.modifyOutline")}
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder={t("docWorkflow.modifyPlaceholder")}
              className="w-full text-sm rounded-md bg-gray-900/60 border border-gray-700/50 px-3 py-2 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500/50 resize-none"
              rows={3}
              autoFocus
            />
            <div className="flex items-center gap-2">
              <button
                onClick={handleModify}
                disabled={!feedback.trim()}
                className="px-3 py-1.5 text-sm rounded-md bg-blue-700/60 hover:bg-blue-700/80 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
              >
                {t("docWorkflow.submitModification")}
              </button>
              <button
                onClick={() => {
                  setMode("view");
                  setFeedback("");
                }}
                className="px-3 py-1.5 text-sm rounded-md bg-gray-700/60 hover:bg-gray-700/80 text-gray-200 transition-colors"
              >
                {t("docWorkflow.cancel")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
