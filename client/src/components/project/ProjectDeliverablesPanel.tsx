/**
 * 项目成果面板 — 右侧「成果」区
 *
 * 显示 Artifact kind=output 的 AI 产出物（计划/原型/代码/文档/报告）。
 * P0-1 方案一 1c：双数据源 —— artifacts 之外还扫描项目 sandbox 中的交付类文件，
 * 保证 `write` / `bash` 等通用写路径产出的文件也能在面板看到。
 * P2-1（2026-11-06）：两源**合并去重**（不再"artifacts 非空就不扫"），
 * 否则混合产出时未登记的那批文件会从面板消失。
 */

import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileOutput, FolderOpen } from "lucide-react";
import {
  fetchArtifacts,
  fetchProjectFiles,
  type ProjectArtifact,
  type ProjectFileEntry,
} from "../../services/projectArtifactService";
import { selectUnregisteredDeliverables } from "../../utils/projectDeliverables";

interface Props {
  projectId: string;
  refreshKey?: number;
}

export const ProjectDeliverablesPanel: React.FC<Props> = ({
  projectId,
  refreshKey,
}) => {
  const { t } = useTranslation();
  const [artifacts, setArtifacts] = useState<ProjectArtifact[]>([]);
  // 沙箱扫描出的、尚未被正式成果覆盖的交付类文件
  const [fallbackFiles, setFallbackFiles] = useState<ProjectFileEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    const artifactsPromise = fetchArtifacts(projectId, "output").catch(
      () => [] as ProjectArtifact[],
    );
    const filesPromise = fetchProjectFiles(projectId).catch(() => null);
    void Promise.all([artifactsPromise, filesPromise]).then(
      ([list, fileResult]) => {
        if (cancelled) return;
        const items = list ?? [];
        setArtifacts(items);
        // P2-1：两源合并去重 —— 已登记的路径不再重复展示
        setFallbackFiles(
          selectUnregisteredDeliverables(items, fileResult?.files ?? []),
        );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshKey]);

  if (artifacts.length === 0 && fallbackFiles.length === 0) {
    return (
      <div className="p-4 text-sm text-gray-400 text-center">
        {t("projects.noDeliverables")}
      </div>
    );
  }

  return (
    <div className="p-2 space-y-1.5">
      {/* #26：口径说明 —— 这里列的是文件（可能是"待修复任务清单.md"这类文档），
          不是任务/工单数据，避免被误读成任务列表 */}
      <p className="px-1 text-[10px] leading-4 text-gray-400 dark:text-gray-500">
        {t("projects.deliverablesHint")}
      </p>
      {/* 正式成果（ProjectArtifactStore） */}
      {artifacts.map((a) => (
        <div
          key={a.id}
          className="px-3 py-2 rounded-lg bg-green-50 dark:bg-green-900/20 text-sm cursor-pointer hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors"
        >
          <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400 mb-0.5">
            <FileOutput size={14} />
            <span className="text-xs">{t("projects.deliverable")}</span>
          </div>
          <div className="text-gray-700 dark:text-gray-300 font-medium truncate">
            {a.title}
          </div>
          <div className="text-gray-500 dark:text-gray-400 text-xs truncate mt-0.5">
            {a.content.slice(0, 60)}
          </div>
        </div>
      ))}

      {/* 沙箱扫描到的、未被正式成果覆盖的交付类文件（P2-1：两源合并，非"仅在为空时"） */}
      {fallbackFiles.map((f) => (
        <div
          key={`file-${f.name}`}
          className="px-3 py-2 rounded-lg bg-green-50/60 dark:bg-green-900/10 text-sm"
          title={f.name}
        >
          <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400 mb-0.5">
            <FolderOpen size={14} />
            <span className="text-xs">{t("projects.deliverableSandbox")}</span>
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
