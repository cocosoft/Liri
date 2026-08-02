/**
 * 项目资料面板 — 右侧「项目资料」区
 *
 * 显示 rules.md 解析出的目标/范围/约束等结构化上下文
 * + 上传的资料文件（Artifact kind=input）
 */

import React, { useEffect, useState } from 'react';
import { FileText, Target, Crosshair, AlertTriangle } from 'lucide-react';
import { fetchArtifacts, type ProjectArtifact } from '../../services/projectArtifactService';

interface Props {
  projectId: string;
}

/** type → icon 映射 */
const TYPE_ICONS: Record<string, React.ReactNode> = {
  goal: <Target size={14} className="text-amber-500" />,
  scope: <Crosshair size={14} className="text-blue-500" />,
  constraint: <AlertTriangle size={14} className="text-red-400" />,
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
  const [artifacts, setArtifacts] = useState<ProjectArtifact[]>([]);

  useEffect(() => {
    fetchArtifacts(projectId, 'input').then(setArtifacts).catch(() => {});
  }, [projectId]);

  if (artifacts.length === 0) {
    return (
      <div className="p-4 text-sm text-gray-400 text-center">
        暂无资料。在聊天中上传文件或设定目标后自动生成。
      </div>
    );
  }

  return (
    <div className="p-2 space-y-1.5">
      {artifacts.map((a) => (
        <div
          key={a.id}
          className="px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800/50 text-sm"
        >
          <div className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400 mb-0.5">
            {TYPE_ICONS[a.sessionId || ''] || <FileText size={14} />}
            <span className="text-xs">
              {TYPE_LABELS[a.sessionId || ''] || a.sessionId || '资料'}
            </span>
          </div>
          <div className="text-gray-700 dark:text-gray-300 truncate">
            {a.title}
          </div>
        </div>
      ))}
    </div>
  );
};
