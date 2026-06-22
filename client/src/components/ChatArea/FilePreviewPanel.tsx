import { useState, useCallback, useEffect, useRef } from "react";
import { useChatStore } from "../../stores/chatStore";
import { useAppStore } from "../../stores/appStore";
import FilePreviewContent from "./FilePreviewContent";
import FileTypeBadge from "./FileTypeBadge";
import { formatFileSize } from "../../utils/formatFileSize";
import type { FilePreview, FileStats, FileRegistryRecord } from "../../types";
import { fileService } from "../../services/fileService";

/** 面板最小/最大宽度（px） */
const MIN_PANEL_WIDTH = 200;
const MAX_PANEL_WIDTH = 600;
const DEFAULT_PANEL_WIDTH = 320;

type PanelTab = 'session' | 'manage';

/**
 * 文件预览面板组件
 * 位于聊天界面右侧，用于预览会话中生成/修改的文件内容。
 * 支持拖拽调整宽度、默认收起、点击文件自动展开。
 * 支持会话文件 / 文件管理两个标签页。
 */
function FilePreviewPanel() {
  const { previewFile, sessionFiles, setPreviewFile, clearSessionFiles } =
    useChatStore();
  const setActivePage = useAppStore((s) => s.setActivePage);
  const [isExpanded, setIsExpanded] = useState(false);
  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL_WIDTH);
  const [activeTab, setActiveTab] = useState<PanelTab>('session');
  const [fileStats, setFileStats] = useState<FileStats | null>(null);
  const [recentFiles, setRecentFiles] = useState<FileRegistryRecord[]>([]);
  const [statsLoading, setStatsLoading] = useState(false);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  /** 点击文件链接时自动展开面板 */
  useEffect(() => {
    if (previewFile) {
      setIsExpanded(true);
    }
  }, [previewFile]);

  /** 拖拽调整面板宽度 */
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startWidth: panelWidth };

    const handleMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = dragRef.current.startX - ev.clientX;
      const newWidth = Math.min(
        MAX_PANEL_WIDTH,
        Math.max(MIN_PANEL_WIDTH, dragRef.current.startWidth + delta),
      );
      setPanelWidth(newWidth);
    };

    const handleMouseUp = () => {
      dragRef.current = null;
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, [panelWidth]);

  const handleClose = useCallback(() => {
    setPreviewFile(null);
  }, [setPreviewFile]);

  const handleSelectFile = useCallback(
    (file: FilePreview) => {
      setPreviewFile(file);
    },
    [setPreviewFile],
  );

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && previewFile) {
        setPreviewFile(null);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [previewFile, setPreviewFile]);

  /** 切换到文件管理标签时加载统计数据 */
  useEffect(() => {
    if (activeTab === 'manage') {
      setStatsLoading(true);
      Promise.all([
        fileService.getFileStats().then(setFileStats).catch(() => {}),
        fileService.searchFiles({ limit: 5 }).then((r) => setRecentFiles(r.items)).catch(() => {}),
      ]).finally(() => setStatsLoading(false));
    }
  }, [activeTab]);

  const emptyState = (
    <div className="flex flex-col items-center justify-center h-full p-6 text-center">
      <svg
        className="w-12 h-12 text-gray-300 dark:text-gray-600 mb-3"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
        />
      </svg>
      <p className="text-sm text-gray-400 dark:text-gray-500">暂无生成的文件</p>
      <p className="text-xs text-gray-300 dark:text-gray-600 mt-1">
        AI 生成的文件将显示在此处
      </p>
    </div>
  );

  if (!isExpanded) {
    return (
      <div className="bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 transition-all duration-300 flex flex-col w-12">
        <div className="p-2 border-b border-gray-200 dark:border-gray-700 flex justify-center">
          <button
            onClick={() => setIsExpanded(true)}
            className="p-1 text-gray-400 hover:text-blue-500 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
            title="展开文件预览"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>
        </div>
        <div className="flex-1 flex flex-col items-center py-2 gap-2">
          <svg
            className="w-5 h-5 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
            />
          </svg>
          {sessionFiles.length > 0 && (
            <span className="text-xs text-gray-400">{sessionFiles.length}</span>
          )}
        </div>
      </div>
    );
  }

  const hasFiles = sessionFiles.length > 0;

  return (
    <div
      className="relative bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 transition-all duration-300 flex flex-col"
      style={{ width: panelWidth }}
    >
      {/* 拖拽手柄：左侧边缘 */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400/50 z-10"
        onMouseDown={handleDragStart}
      />
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('session')}
            className={`text-xs font-medium px-2 py-0.5 rounded transition-colors ${
              activeTab === 'session'
                ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            会话文件
          </button>
          <button
            onClick={() => setActiveTab('manage')}
            className={`text-xs font-medium px-2 py-0.5 rounded transition-colors ${
              activeTab === 'manage'
                ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            文件管理
          </button>
        </div>
        <div className="flex items-center gap-1">
          {((activeTab === 'session' && hasFiles) || activeTab === 'manage') && (
            <button
              onClick={clearSessionFiles}
              className="p-1 text-xs text-gray-400 hover:text-red-500 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
              title="清除文件列表"
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
            </button>
          )}
          <button
            onClick={() => setIsExpanded(false)}
            className="p-1 text-gray-400 hover:text-blue-500 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
            title="收起面板"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* 会话文件视图 */}
      {activeTab === 'session' && hasFiles && !previewFile && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <FileList files={sessionFiles} onSelect={handleSelectFile} />
        </div>
      )}

      {activeTab === 'session' && previewFile && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <FilePreviewContent file={previewFile} onClose={handleClose} />
        </div>
      )}

      {activeTab === 'session' && !hasFiles && !previewFile && emptyState}

      {/* 文件管理视图 */}
      {activeTab === 'manage' && (
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {statsLoading ? (
            <div className="text-center py-8 text-gray-400 text-sm">加载中...</div>
          ) : (
            <>
              {fileStats && (
                <div className="space-y-2 bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3">
                  <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    统计概览
                  </h4>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <StatItem label="文件总数" value={String(fileStats.totalFiles)} />
                    <StatItem label="总大小" value={formatFileSize(fileStats.totalSize)} />
                    <StatItem label="今日入站" value={String(fileStats.todayInbound)} />
                    <StatItem label="去重节省" value={`${fileStats.dedupSaved} 次`} />
                  </div>
                  {fileStats.dedupSize > 0 && (
                    <p className="text-xs text-gray-400">
                      节省空间: {formatFileSize(fileStats.dedupSize)}
                    </p>
                  )}
                </div>
              )}

              {/* 最近文件 */}
              {recentFiles.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    最近文件
                  </h4>
                  <div className="space-y-1">
                    {recentFiles.map((f) => (
                      <div
                        key={f.fileId}
                        className="px-2 py-1.5 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700"
                      >
                        <p className="text-sm text-gray-700 dark:text-gray-300 truncate font-medium">
                          {f.originalName}
                        </p>
                        <div className="flex items-center gap-2 text-xs text-gray-400 mt-0.5">
                          <span>{f.source}</span>
                          <span>·</span>
                          <span>{formatDate(f.createdAt)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button
                onClick={() => { setActivePage('files'); setIsExpanded(false); }}
                className="w-full py-2 px-4 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                打开完整文件管理器
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

interface FileListProps {
  files: FilePreview[];
  onSelect: (file: FilePreview) => void;
}

function FileList({ files, onSelect }: FileListProps) {
  if (files.length === 0) return null;

  const formatBytes = (bytes?: number) => {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="flex-1 overflow-y-auto p-2 space-y-1">
      {[...files].reverse().map((file) => (
        <button
          key={file.path}
          onClick={() => onSelect(file)}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors group"
        >
          <FileTypeBadge type={file.type} />
          <div className="flex-1 min-w-0">
            <div className="text-sm text-gray-700 dark:text-gray-300 truncate">
              {file.name}
            </div>
            <div className="text-xs text-gray-400 truncate">{file.path}</div>
          </div>
          {file.size && (
            <span className="text-xs text-gray-400 flex-shrink-0">
              {formatBytes(file.size)}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/**
 * 统计项组件
 */
function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-gray-500 dark:text-gray-400 text-xs">{label}</p>
      <p className="text-gray-900 dark:text-gray-100 font-semibold">{value}</p>
    </div>
  );
}

/** 格式化时间戳 */
function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default FilePreviewPanel;
