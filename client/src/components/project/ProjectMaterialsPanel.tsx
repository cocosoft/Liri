/**
 * 项目资料面板 — 右侧「项目资料」区
 *
 * 从 GET /v1/projects/:id/context 获取 rules.md 解析后的结构化上下文。
 * 显示目标/范围/约束等。无数据时提供写入引导。
 */

import React, { useEffect, useState } from 'react';
import { Target, Crosshair, AlertTriangle, FileText, Lightbulb } from 'lucide-react';
import { fetchProjectContext, type ProjectContext } from '../../services/projectArtifactService';

interface Props {
  projectId: string;
}

/** type → icon 映射 */
const TYPE_ICONS: Record<string, React.ReactNode> = {
  goal: <Target size={14} className="text-amber-500 shrink-0" />,
  scope: <Crosshair size={14} className="text-blue-500 shrink-0" />,
  constraint: <AlertTriangle size={14} className="text-red-400 shrink-0" />,
  requirement: <FileText size={14} className="text-purple-400 shrink-0" />,
  knowledge: <Lightbulb size={14} className="text-yellow-400 shrink-0" />,
};

/** type → 中文标签 */
const TYPE_LABELS: Record<string, string> = {
  goal: '目标',
  scope: '范围',
  constraint: '约束',
  requirement: '需求',
  knowledge: '知识',
};

export const ProjectMaterialsPanel: React.FC<Props> = ({ projectId }) => {
  const [contexts, setContexts] = useState<ProjectContext[]>([]);

  useEffect(() => {
    fetchProjectContext(projectId)
      .then(setContexts)
      .catch(() => {});
  }, [projectId]);

  if (contexts.length === 0) {
    return (
      <div className="p-4 text-sm text-gray-400 text-center leading-relaxed">
        暂无资料。
        <br />
        在聊天中描述项目目标、范围、约束，AI 会自动写入 rules.md。
      </div>
    );
  }

  return (
    <div className="p-2 space-y-1">
      {contexts.map((ctx, i) => (
        <div
          key={i}
          className="px-2.5 py-1.5 rounded-md bg-gray-50 dark:bg-gray-800/50 text-sm flex items-start gap-1.5"
        >
          {TYPE_ICONS[ctx.type] || <FileText size={14} className="shrink-0" />}
          <div className="min-w-0">
            <span className="text-xs text-gray-400">
              {TYPE_LABELS[ctx.type] || ctx.type}
            </span>
            <div className="text-gray-700 dark:text-gray-300 truncate text-xs mt-0.5">
              {ctx.content}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
