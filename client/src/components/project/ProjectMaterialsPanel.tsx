/**
 * 项目资料面板 — 右侧「项目资料」区
 *
 * 从 GET /v1/projects/:id/context 获取 rules.md 解析后的结构化上下文。
 * 显示目标/范围/约束等。无数据时提供写入引导。
 */

import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  Target,
  Crosshair,
  AlertTriangle,
  FileText,
  Lightbulb,
  MessageSquare,
  GitCommit,
  BookOpen,
  Folder,
  RefreshCw,
  Upload,
  Trash2,
} from "lucide-react";
import {
  fetchProjectContext,
  type ProjectContext,
} from "../../services/projectArtifactService";
import {
  fetchSummaries,
  fetchProjectFiles,
  uploadProjectFiles,
  deleteProjectFile,
  type ProjectSummary,
  type ProjectFilesResult,
} from "../../services/projectArtifactService";
import { toastError } from "../../stores/toastStore";

interface Props {
  projectId: string;
  refreshKey?: number;
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
  goal: "目标",
  scope: "范围",
  constraint: "约束",
  requirement: "需求",
  knowledge: "知识",
};

export const ProjectMaterialsPanel: React.FC<Props> = ({
  projectId,
  refreshKey,
}) => {
  const [contexts, setContexts] = useState<ProjectContext[]>([]);
  const [summaries, setSummaries] = useState<ProjectSummary[]>([]);
  const [fileResult, setFileResult] = useState<ProjectFilesResult | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadFiles = useCallback(async () => {
    setFileLoading(true);
    try {
      const result = await fetchProjectFiles(projectId);
      setFileResult(result);
    } catch {
      /* 文件列表加载失败不阻塞 */
    } finally {
      setFileLoading(false);
    }
  }, [projectId]);

  const handleUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files ? Array.from(e.target.files) : [];
      if (files.length === 0) return;
      setUploading(true);
      try {
        const { failed } = await uploadProjectFiles(projectId, files);
        await loadFiles(); // 上传后刷新文件列表
        if (failed.length > 0) {
          toastError(new Error(`以下文件上传失败：\n${failed.join("\n")}`));
        }
      } finally {
        setUploading(false);
        // 重置 input，允许重复上传同名文件
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [projectId, loadFiles],
  );

  const handleDeleteFile = useCallback(
    async (filename: string) => {
      if (!window.confirm(`确定删除文件「${filename}」？此操作不可恢复。`)) {
        return;
      }
      setDeleting(filename);
      try {
        await deleteProjectFile(projectId, filename);
        await loadFiles();
      } catch (err) {
        toastError(new Error(`删除文件失败：${String(err)}`));
      } finally {
        setDeleting(null);
      }
    },
    [projectId, loadFiles],
  );

  useEffect(() => {
    fetchProjectContext(projectId)
      .then(setContexts)
      .catch(() => {});
    fetchSummaries(projectId)
      .then(setSummaries)
      .catch(() => {});
    loadFiles();
  }, [projectId, refreshKey]);

  // S4 chokidar 降级：30 秒轮询 sandbox 文件变化
  useEffect(() => {
    pollTimer.current = setInterval(loadFiles, 30_000);
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, [loadFiles]);

  const sessionSummaries = summaries.filter((s) => !s.phaseSummary).slice(-10);
  const phaseSummaries = summaries.filter((s) => s.phaseSummary).slice(-3);
  const decisions = summaries.filter((s) => s.decision).slice(-5);

  const hasFiles =
    fileResult && (fileResult.files.length > 0 || fileResult.dirs.length > 0);

  if (contexts.length === 0 && summaries.length === 0 && !hasFiles) {
    return (
      <div className="p-4 space-y-3">
        <div className="text-sm text-gray-400 text-center leading-relaxed">
          暂无资料。
          <br />
          在聊天中描述项目目标、范围、约束，AI 会自动写入 rules.md。
        </div>
        <div className="flex justify-center">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleUpload}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors ${uploading ? "animate-pulse" : ""}`}
          >
            <Upload size={12} />
            {uploading ? "上传中..." : "上传文件"}
          </button>
        </div>
      </div>
    );
  }

  /** 格式化文件大小 */
  const fmtSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  return (
    <div className="p-2 space-y-3">
      {/* S4: sandbox 文件列表（30秒轮询 + 手动刷新 + 上传） */}
      <div className="space-y-1">
        <div className="text-xs text-gray-400 px-1 font-medium flex items-center justify-between">
          <span className="flex items-center gap-1">
            <Folder size={12} /> 项目文件
          </span>
          <div className="flex items-center gap-1">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleUpload}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className={`p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors ${uploading ? "animate-pulse" : ""}`}
              title="上传文件"
            >
              <Upload size={12} />
            </button>
            <button
              onClick={loadFiles}
              disabled={fileLoading}
              className={`p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors ${fileLoading ? "animate-spin" : ""}`}
              title="手动刷新"
            >
              <RefreshCw size={12} />
            </button>
          </div>
        </div>
        {hasFiles ? (
          <>
            {fileResult!.dirs.map((d) => (
              <div
                key={`dir-${d.name}`}
                className="px-2.5 py-1 rounded-md bg-gray-50 dark:bg-gray-800/50 text-xs flex items-center gap-1.5"
              >
                <Folder size={12} className="text-blue-400 shrink-0" />
                <span className="text-gray-600 dark:text-gray-400 truncate">
                  {d.name}/
                </span>
              </div>
            ))}
            {fileResult!.files.map((f) => (
              <div
                key={`file-${f.name}`}
                className="group px-2.5 py-1 rounded-md bg-gray-50 dark:bg-gray-800/50 text-xs flex items-center gap-1.5"
              >
                <FileText size={12} className="text-gray-400 shrink-0" />
                <span className="text-gray-700 dark:text-gray-300 truncate flex-1">
                  {f.name}
                </span>
                <span className="text-gray-400 flex-shrink-0">
                  {fmtSize(f.size)}
                </span>
                <button
                  onClick={() => handleDeleteFile(f.name)}
                  disabled={deleting === f.name}
                  className="p-0.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
                  title="删除文件"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </>
        ) : (
          <div className="px-2.5 py-2 text-xs text-gray-400 text-center">
            点击上传按钮添加文件到项目文件夹
          </div>
        )}
      </div>

      {/* 项目上下文 */}
      {contexts.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs text-gray-400 px-1 font-medium">项目资料</div>
          {contexts.map((ctx, i) => (
            <div
              key={i}
              className="px-2.5 py-1.5 rounded-md bg-gray-50 dark:bg-gray-800/50 text-sm flex items-start gap-1.5"
            >
              {TYPE_ICONS[ctx.type] || (
                <FileText size={14} className="shrink-0" />
              )}
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
      )}

      {/* 决策记录 */}
      {decisions.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs text-gray-400 px-1 font-medium flex items-center gap-1">
            <GitCommit size={12} /> 关键决策
          </div>
          {decisions.map((d, i) => (
            <div
              key={i}
              className="px-2.5 py-1.5 rounded-md bg-amber-50 dark:bg-amber-900/20 text-xs text-amber-800 dark:text-amber-200"
            >
              {d.decision}
            </div>
          ))}
        </div>
      )}

      {/* 阶段性小结 */}
      {phaseSummaries.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs text-gray-400 px-1 font-medium flex items-center gap-1">
            <BookOpen size={12} /> 阶段性小结
          </div>
          {phaseSummaries.map((ps, i) => (
            <div
              key={i}
              className="px-2.5 py-1.5 rounded-md bg-blue-50 dark:bg-blue-900/20 text-xs text-blue-800 dark:text-blue-200 whitespace-pre-wrap"
            >
              {ps.summary}
            </div>
          ))}
        </div>
      )}

      {/* 最近会话摘要 */}
      {sessionSummaries.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs text-gray-400 px-1 font-medium flex items-center gap-1">
            <MessageSquare size={12} /> 最近讨论
          </div>
          {sessionSummaries.map((s, i) => (
            <div
              key={i}
              className="px-2.5 py-1.5 rounded-md bg-gray-50 dark:bg-gray-800/50 text-xs text-gray-600 dark:text-gray-400"
            >
              <div className="truncate">{s.summary}</div>
              <div className="text-gray-400 mt-0.5">
                {new Date(s.createdAt).toLocaleDateString("zh-CN")} ·{" "}
                {s.messageCount} 条消息
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
