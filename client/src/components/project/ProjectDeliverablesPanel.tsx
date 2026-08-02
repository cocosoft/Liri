/**
 * 项目成果面板 — 右侧「成果」区
 *
 * 显示 Artifact kind=output 的 AI 产出物（计划/原型/代码/文档/报告）
 */

import React, { useEffect, useState } from 'react';
import { FileOutput } from 'lucide-react';
import { fetchArtifacts, type ProjectArtifact } from '../../services/projectArtifactService';

interface Props {
  projectId: string;
  refreshKey?: number;
}

export const ProjectDeliverablesPanel: React.FC<Props> = ({ projectId, refreshKey }) => {
  const [artifacts, setArtifacts] = useState<ProjectArtifact[]>([]);

  useEffect(() => {
    fetchArtifacts(projectId, 'output').then(setArtifacts).catch(() => {});
  }, [projectId, refreshKey]);

  if (artifacts.length === 0) {
    return (
      <div className="p-4 text-sm text-gray-400 text-center">
        暂无成果。开始对话后，AI 产出物会自动出现在这里。
      </div>
    );
  }

  return (
    <div className="p-2 space-y-1.5">
      {artifacts.map((a) => (
        <div
          key={a.id}
          className="px-3 py-2 rounded-lg bg-green-50 dark:bg-green-900/20 text-sm cursor-pointer hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors"
        >
          <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400 mb-0.5">
            <FileOutput size={14} />
            <span className="text-xs">成果</span>
          </div>
          <div className="text-gray-700 dark:text-gray-300 font-medium truncate">
            {a.title}
          </div>
          <div className="text-gray-500 dark:text-gray-400 text-xs truncate mt-0.5">
            {a.content.slice(0, 60)}
          </div>
        </div>
      ))}
    </div>
  );
};
