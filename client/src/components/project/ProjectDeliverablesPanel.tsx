/**
 * 项目成果面板 — 右侧「成果」区
 *
 * 显示 Artifact kind=output 的 AI 产出物（计划/原型/代码/文档/报告）。
 * P0-1 方案一 1c：双数据源兜底 —— artifacts 为空时，降级扫描项目 sandbox
 * 中的交付类文件（docx/pptx/pdf/html/md/png 等），保证面板永远有内容。
 */

import React, { useEffect, useState } from "react";
import { FileOutput, FolderOpen } from "lucide-react";
import {
  fetchArtifacts,
  fetchProjectFiles,
  type ProjectArtifact,
  type ProjectFileEntry,
} from "../../services/projectArtifactService";

interface Props {
  projectId: string;
  refreshKey?: number;
}

/** 交付类扩展名（与后端 WriteProjectFileTool 自动登记一致） */
const DELIVERABLE_EXTENSIONS = [
  ".docx",
  ".pptx",
  ".pdf",
  ".html",
  ".xlsx",
  ".md",
  ".png",
  ".jpg",
  ".jpeg",
  ".svg",
];

function isDeliverableFile(name: string): boolean {
  if (name.startsWith("_")) return false;
  const lower = name.toLowerCase();
  return DELIVERABLE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export const ProjectDeliverablesPanel: React.FC<Props> = ({
  projectId,
  refreshKey,
}) => {
  const [artifacts, setArtifacts] = useState<ProjectArtifact[]>([]);
  // 兜底数据源：artifacts 为空时扫描沙箱中的交付类文件
  const [fallbackFiles, setFallbackFiles] = useState<ProjectFileEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchArtifacts(projectId, "output")
      .then((list) => {
        if (cancelled) return;
        const items = list ?? [];
        setArtifacts(items);
        if (items.length === 0) {
          // 成果列表为空 → 降级扫描目录中的交付类文件
          return fetchProjectFiles(projectId).then((r) => {
            if (cancelled) return;
            setFallbackFiles(
              (r?.files ?? []).filter((f) => isDeliverableFile(f.name)),
            );
          });
        }
        setFallbackFiles([]);
      })
      .catch(() => {
        if (!cancelled) setFallbackFiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshKey]);

  if (artifacts.length === 0 && fallbackFiles.length === 0) {
    return (
      <div className="p-4 text-sm text-gray-400 text-center">
        暂无成果。开始对话后，AI 产出物会自动出现在这里。
      </div>
    );
  }

  return (
    <div className="p-2 space-y-1.5">
      {/* 正式成果（ProjectArtifactStore） */}
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

      {/* 兜底：沙箱扫描到的交付类文件（artifacts 为空时） */}
      {artifacts.length === 0 &&
        fallbackFiles.map((f) => (
          <div
            key={`file-${f.name}`}
            className="px-3 py-2 rounded-lg bg-green-50/60 dark:bg-green-900/10 text-sm"
            title={f.name}
          >
            <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400 mb-0.5">
              <FolderOpen size={14} />
              <span className="text-xs">成果（沙箱）</span>
            </div>
            <div className="text-gray-700 dark:text-gray-300 font-medium truncate">
              {f.name}
            </div>
            <div className="text-gray-500 dark:text-gray-400 text-xs truncate mt-0.5">
              {f.size > 0 ? `${(f.size / 1024).toFixed(0)}KB` : ""}
            </div>
          </div>
        ))}
    </div>
  );
};
