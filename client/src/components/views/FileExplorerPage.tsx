import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useFileStore } from "../../stores/fileStore";
import { useNavigationStore } from "../../stores/navigationStore";
import { useToastStore } from "../../stores/toastStore";
import { SkeletonTable } from "../common/Skeleton";
import SearchInput from "../common/SearchInput";
import { fileService } from "../../services/fileService";
import type {
  FileEntry,
  FileCategory,
  FilePreview,
  FileStats,
} from "../../types";
import type { FileReadDetail } from "../../services/fileService";
import FileListView from "./FileListView";
import DirectoryTree from "./DirectoryTree";
import DetailedFileList from "./DetailedFileList";
import CodeBlock from "../ChatArea/CodeBlock";
import MarkdownRenderer from "../ChatArea/MarkdownRenderer";

/**
 * 格式化文件大小
 */
function formatSize(bytes?: number): string {
  if (bytes === undefined || bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * 格式化日期
 */
function formatDate(ts?: number): string {
  if (!ts) return "";
  return new Date(ts).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type ViewMode = "grid" | "list";

/** 分类配置 */
const CATEGORY_CONFIG: Record<
  FileCategory,
  { label: string; icon: string; color: string; path: string }
> = {
  all: { label: "全部", icon: "🗂️", color: "bg-gray-500", path: "" },
  output: {
    label: "AI 输出",
    icon: "📤",
    color: "bg-blue-500",
    path: "output",
  },
  downloads: {
    label: "下载材料",
    icon: "📥",
    color: "bg-green-500",
    path: "downloads",
  },
  attachments: {
    label: "上传文件",
    icon: "📁",
    color: "bg-purple-500",
    path: "attachments",
  },
  knowledge: {
    label: "知识库",
    icon: "📚",
    color: "bg-orange-500",
    path: "knowledge",
  },
  memory: { label: "记忆", icon: "🧠", color: "bg-pink-500", path: "memory" },
  inbound: { label: "入站", icon: "📥", color: "bg-teal-500", path: "inbound" },
  media: { label: "媒体", icon: "🎬", color: "bg-red-500", path: "media" },
  artifact: {
    label: "制品",
    icon: "🔧",
    color: "bg-indigo-500",
    path: "artifact",
  },
  notebook: {
    label: "笔记本",
    icon: "📓",
    color: "bg-yellow-500",
    path: "notebook",
  },
};

/** 目录树根配置 */
const TREE_ROOTS = [
  { key: "all", label: "全部文件", path: "", icon: "🗂️" },
  { key: "output", label: "AI 输出", path: "output", icon: "📤" },
  { key: "downloads", label: "下载材料", path: "downloads", icon: "📥" },
  { key: "attachments", label: "上传文件", path: "attachments", icon: "📁" },
  { key: "knowledge", label: "知识库", path: "knowledge", icon: "📚" },
  { key: "memory", label: "记忆", path: "memory", icon: "🧠" },
];

/**
 * 文件探索页面
 * 集成目录树侧边栏 + 网格/列表双视图 + 文件管理(Registry)视图
 */
function FileExplorerPage() {
  const {
    entries,
    currentPath,
    currentCategory,
    currentWorkspace,
    workspaces,
    isLoading,
    error,
    uploading,
    selectedFile,
    loadDir,
    navigateTo,
    goUp,
    uploadFile,
    selectFile,
    setCategory,
    loadWorkspaces,
    setWorkspace,
    sendToAI,
    saveToKnowledge,
    saveToMemory,
  } = useFileStore();

  const setActivePage = useNavigationStore((s) => s.setActivePage);
  const addToast = useToastStore((s) => s.addToast);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [previewFile, setPreviewFile] = useState<FilePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [fileStats, setFileStats] = useState<FileStats | null>(null);
  const [showRegistry, setShowRegistry] = useState(false);
  const [showTree, setShowTree] = useState(true);
  const retryCountRef = useRef(0);
  const MAX_RETRIES = 5;

  /** 初始化加载（带重试机制：后端可能还未启动完成） */
  useEffect(() => {
    const loadWithRetry = async () => {
      try {
        await loadDir(currentPath);
        // 加载成功后重置重试计数
        retryCountRef.current = 0;
      } catch {
        // 加载失败时重试
        if (retryCountRef.current < MAX_RETRIES) {
          retryCountRef.current++;
          const delay = Math.min(
            1000 * Math.pow(2, retryCountRef.current - 1),
            8000,
          );
          setTimeout(loadWithRetry, delay);
        }
      }
    };

    loadWithRetry();
    loadWorkspaces();
    fileService
      .getFileStats()
      .then(setFileStats)
      .catch(() => {});
  }, []);

  /** 过滤和排序条目 */
  const sortedEntries = useMemo(() => {
    const filtered = entries.filter((entry) => {
      if (!searchQuery) return true;
      return entry.name.toLowerCase().includes(searchQuery.toLowerCase());
    });

    return [...filtered].sort((a, b) => {
      if (a.type === "directory" && b.type !== "directory") return -1;
      if (a.type !== "directory" && b.type === "directory") return 1;
      return a.name.localeCompare(b.name);
    });
  }, [entries, searchQuery]);

  /** 获取文件预览类型 */
  const getFilePreviewType = useCallback(
    (fileName: string): FilePreview["type"] => {
      const ext = fileName.split(".").pop()?.toLowerCase() || "";
      const imageExts = ["jpg", "jpeg", "png", "gif", "bmp", "webp", "svg"];
      const codeExts = [
        "js",
        "ts",
        "tsx",
        "jsx",
        "py",
        "java",
        "cpp",
        "c",
        "go",
        "rs",
        "rb",
        "php",
        "swift",
        "kt",
        "scala",
        "hs",
        "lua",
        "pl",
        "pm",
        "r",
        "m",
        "h",
        "hpp",
        "css",
        "scss",
        "less",
        "sh",
        "bash",
        "zsh",
        "ps1",
        "bat",
        "cmd",
        "sql",
        "graphql",
        "proto",
        "gradle",
      ];
      const jsonExts = ["json", "jsonc"];
      const yamlExts = ["yaml", "yml"];
      const markdownExts = ["md", "markdown", "mdx"];
      const pdfExts = ["pdf"];
      const docxExts = ["docx", "doc"];
      const pptxExts = ["pptx", "ppt"];

      if (imageExts.includes(ext)) return "image";
      if (pdfExts.includes(ext)) return "pdf";
      if (docxExts.includes(ext)) return "docx";
      if (pptxExts.includes(ext)) return "pptx";
      if (codeExts.includes(ext)) return "code";
      if (jsonExts.includes(ext)) return "json";
      if (yamlExts.includes(ext)) return "yaml";
      if (markdownExts.includes(ext)) return "markdown";
      return "text";
    },
    [],
  );

  /** 处理文件预览 */
  const handlePreview = useCallback(
    async (entry: { name: string; path: string; size?: number }) => {
      try {
        setPreviewLoading(true);
        const detail: FileReadDetail = await fileService.readFileDetail(
          entry.path,
        );
        const fileType = getFilePreviewType(entry.name);

        setPreviewFile({
          name: entry.name,
          path: entry.path,
          content: detail.content,
          type: fileType,
          size: entry.size,
        });
      } catch (e) {
        addToast("error", `预览失败: ${e}`);
      } finally {
        setPreviewLoading(false);
      }
    },
    [getFilePreviewType, addToast],
  );

  /** 关闭预览 */
  const closePreview = useCallback(() => {
    setPreviewFile(null);
  }, []);

  /** 处理文件/目录点击 */
  const handleItemClick = useCallback(
    (entry: FileEntry) => {
      if (entry.type === "directory") {
        navigateTo(entry.path);
        selectFile(null);
      } else {
        selectFile({ name: entry.name, path: entry.path });
      }
    },
    [navigateTo, selectFile],
  );

  /** 处理上传按钮点击 */
  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  /** 处理文件选择 */
  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        uploadFile(file);
        e.target.value = "";
      }
    },
    [uploadFile],
  );

  /** 拖拽上传处理 */
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const files = Array.from(e.dataTransfer.files);
      files.forEach((file) => uploadFile(file));
    },
    [uploadFile],
  );

  /** 发送给 AI */
  const handleSendToAI = useCallback(
    async (filePath: string) => {
      try {
        await sendToAI(filePath);
        addToast("success", "文件已发送给 AI 分析");
        setActivePage("chat");
      } catch (e) {
        addToast("error", `发送失败: ${e}`);
      }
    },
    [sendToAI, addToast, setActivePage],
  );

  /** 存入知识库 */
  const handleSaveToKnowledge = useCallback(
    async (filePath: string) => {
      try {
        await saveToKnowledge(filePath);
        addToast("success", "文件已存入知识库");
      } catch (e) {
        addToast("error", `存入失败: ${e}`);
      }
    },
    [saveToKnowledge, addToast],
  );

  /** 存入记忆 */
  const handleSaveToMemory = useCallback(
    async (filePath: string) => {
      try {
        await saveToMemory(filePath);
        addToast("success", "文件内容已存入记忆");
      } catch (e) {
        addToast("error", `存入失败: ${e}`);
      }
    },
    [saveToMemory, addToast],
  );

  /** 目录树导航 */
  const handleTreeNavigate = useCallback(
    (path: string) => {
      navigateTo(path);
    },
    [navigateTo],
  );

  /** 根目录切换 */
  const handleRootChange = useCallback(
    (key: string) => {
      setCategory(key as FileCategory);
      setShowRegistry(false);
    },
    [setCategory],
  );

  const isFileSelected = (entry: { name: string; path: string }) => {
    return selectedFile?.path === entry.path;
  };

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900">
      <div className="max-w-6xl mx-auto p-6">
        {/* ====== 页面标题 ====== */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              文件枢纽
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {currentWorkspace
                ? `工作空间: ${currentWorkspace.name}`
                : "未选择工作空间"}
            </p>
          </div>
          <div className="flex gap-3 items-center">
            {/* 目录树切换 */}
            <button
              onClick={() => setShowTree(!showTree)}
              className={`px-3 py-2 text-sm rounded-lg transition-colors ${
                showTree
                  ? "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
                  : "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600"
              }`}
              title={showTree ? "隐藏目录树" : "显示目录树"}
            >
              {showTree ? "📂" : "📁"}
            </button>
            {/* 视图切换：网格/列表 */}
            <div className="flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden">
              <button
                onClick={() => setViewMode("grid")}
                className={`px-3 py-1.5 text-sm transition-colors ${
                  viewMode === "grid"
                    ? "bg-blue-600 text-white"
                    : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                }`}
                title="网格视图"
              >
                ▦
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={`px-3 py-1.5 text-sm transition-colors ${
                  viewMode === "list"
                    ? "bg-blue-600 text-white"
                    : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                }`}
                title="列表视图"
              >
                ☰
              </button>
            </div>
            {/* 文件管理(Registry) */}
            <button
              onClick={() => {
                setShowRegistry(!showRegistry);
                if (!showRegistry) {
                  fileService
                    .getFileStats()
                    .then(setFileStats)
                    .catch(() => {});
                }
              }}
              className={`px-4 py-2 text-sm rounded-lg transition-colors ${
                showRegistry
                  ? "bg-blue-600 text-white"
                  : "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600"
              }`}
            >
              📋 文件管理
            </button>
            <button
              onClick={() => setActivePage("chat")}
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              返回聊天
            </button>
          </div>
        </div>

        {/* ====== 分类标签栏 ====== */}
        <div className="flex border-b border-gray-200 dark:border-gray-700 overflow-x-auto mb-4">
          {Object.entries(CATEGORY_CONFIG).map(([key, config]) => (
            <button
              key={key}
              onClick={() => {
                setCategory(key as FileCategory);
                if (["inbound", "media", "artifact", "notebook"].includes(key)) {
                  setShowRegistry(true);
                  fileService
                    .getFileStats()
                    .then(setFileStats)
                    .catch(() => {});
                } else {
                  setShowRegistry(false);
                }
              }}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap ${
                currentCategory === key
                  ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/20"
                  : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800"
              }`}
            >
              <span>{config.icon}</span>
              <span>{config.label}</span>
            </button>
          ))}
        </div>

        {/* ====== 主内容区 ====== */}
        <div className="min-h-[400px]">
          {showRegistry ? (
            <FileListView />
          ) : (
            <div className="flex gap-0">
              {showTree && (
                <DirectoryTree
                  currentPath={currentPath}
                  onNavigate={handleTreeNavigate}
                  roots={TREE_ROOTS}
                  currentRoot={currentCategory}
                  onRootChange={handleRootChange}
                />
              )}
              <div className="flex-1 min-w-0">
                {/* 统计概览 */}
                {fileStats && !showRegistry && (
                  <div className="flex items-center gap-6 px-4 py-2 mb-3 border rounded-lg bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/10 dark:to-purple-900/10 border-gray-200 dark:border-gray-700">
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      📁 文件总数:{" "}
                      <strong className="text-gray-700 dark:text-gray-300">
                        {fileStats.totalFiles}
                      </strong>
                    </span>
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      📦 总大小:{" "}
                      <strong className="text-gray-700 dark:text-gray-300">
                        {formatSize(fileStats.totalSize)}
                      </strong>
                    </span>
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      📤 今日入站:{" "}
                      <strong className="text-gray-700 dark:text-gray-300">
                        {fileStats.todayInbound}
                      </strong>
                    </span>
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      🔁 去重节省:{" "}
                      <strong className="text-gray-700 dark:text-gray-300">
                        {fileStats.dedupSaved} 次
                      </strong>
                      {fileStats.dedupSize > 0 && (
                        <span className="text-gray-400 ml-1">
                          ({formatSize(fileStats.dedupSize)})
                        </span>
                      )}
                    </span>
                  </div>
                )}

                {/* 工具栏 */}
                <div className="flex items-center justify-between py-2 mb-3">
                  <div className="flex items-center gap-3">
                    <SearchInput
                      value={searchQuery}
                      onChange={setSearchQuery}
                      placeholder="过滤当前目录..."
                      className="w-64"
                    />
                    <div className="relative">
                      <button
                        onClick={() =>
                          setActiveMenu(
                            activeMenu === "workspace" ? null : "workspace",
                          )
                        }
                        className="flex items-center gap-2 px-3 py-1.5 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
                      >
                        <span>📁</span>
                        <span>{currentWorkspace?.name || "选择工作空间"}</span>
                        <span className="text-gray-400">▼</span>
                      </button>
                      {activeMenu === "workspace" && (
                        <div className="absolute top-full left-0 mt-1 w-48 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-10">
                          {workspaces.map((ws) => (
                            <button
                              key={ws.id}
                              onClick={() => {
                                setWorkspace(ws);
                                setActiveMenu(null);
                              }}
                              className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${
                                currentWorkspace?.id === ws.id
                                  ? "bg-blue-50 dark:bg-blue-900/20"
                                  : ""
                              }`}
                            >
                              {ws.name}
                            </button>
                          ))}
                          {workspaces.length === 0 && (
                            <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">
                              暂无工作空间
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={goUp}
                      disabled={
                        currentPath.split("/").filter(Boolean).length <= 1
                      }
                      className="px-3 py-1.5 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      上级目录
                    </button>
                    <button
                      onClick={handleUploadClick}
                      disabled={uploading}
                      className="px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:opacity-50 transition-colors"
                    >
                      {uploading ? "上传中..." : "上传文件"}
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      onChange={handleFileChange}
                      className="hidden"
                      multiple
                    />
                  </div>
                </div>

                {/* 文件列表 */}
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  {isDragging && (
                    <div className="p-8 border-2 border-dashed border-green-500 bg-green-50 dark:bg-green-900/20 rounded-lg text-center">
                      <p className="text-lg font-medium text-green-600 dark:text-green-400">
                        📁 释放文件以上传
                      </p>
                    </div>
                  )}
                  {isLoading ? (
                    <div className="p-6">
                      <SkeletonTable />
                    </div>
                  ) : error ? (
                    <div className="text-center py-12">
                      <p className="text-red-500 dark:text-red-400 mb-2">
                        {error}
                      </p>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                        请确认后端服务（Liri_coding）是否已正常启动
                      </p>
                      <button
                        onClick={() => loadDir(currentPath)}
                        className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                      >
                        重新加载
                      </button>
                    </div>
                  ) : sortedEntries.length === 0 ? (
                    <div className="text-center py-12">
                      <p className="text-gray-500 dark:text-gray-400">暂无文件</p>
                      <p className="text-sm text-gray-400 dark:text-gray-500 mt-2">
                        {currentCategory === "all"
                          ? "这是您的 Liri 数据目录（~/.pyapp/），子目录将在此展示"
                          : currentCategory === "output"
                            ? "AI 生成的输出文件将出现在此目录"
                            : currentCategory === "downloads"
                              ? "下载的材料将保存到此目录"
                              : currentCategory === "attachments"
                                ? "上传的文件将保存到此目录。拖拽文件到此处或点击「上传文件」按钮"
                                : "拖拽文件到此处或点击上传按钮添加文件"}
                      </p>
                    </div>
                  ) : viewMode === "list" ? (
                    <DetailedFileList
                      entries={sortedEntries}
                      selectedFile={selectedFile}
                      loading={isLoading}
                      onItemClick={handleItemClick}
                      onPreview={(entry) => handlePreview(entry)}
                      onSendToAI={handleSendToAI}
                      onSaveToKnowledge={handleSaveToKnowledge}
                      onSaveToMemory={handleSaveToMemory}
                    />
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                      {sortedEntries.map((entry) => (
                        <div
                          key={entry.path}
                          onClick={() => handleItemClick(entry)}
                          className={`relative p-4 rounded-xl border-2 transition-all cursor-pointer ${
                            isFileSelected(entry)
                              ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                              : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600"
                          }`}
                        >
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-2xl flex-shrink-0">
                                {entry.type === "directory" ? "📁" : "📄"}
                              </span>
                              <span className="font-medium text-gray-900 dark:text-gray-100 truncate text-sm">
                                {entry.name}
                              </span>
                            </div>
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                            <span>{formatSize(entry.size)}</span>
                            <span className="mx-2">|</span>
                            <span>{formatDate(entry.modified_at)}</span>
                          </div>
                          {entry.type === "file" && (
                            <div className="flex flex-col gap-1.5">
                              <div className="flex gap-1.5">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handlePreview(entry);
                                  }}
                                  disabled={previewLoading}
                                  className="flex-1 px-2 py-1 text-xs bg-gray-500 hover:bg-gray-600 text-white rounded-md transition-colors disabled:opacity-50"
                                >
                                  👁️ 预览
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleSendToAI(entry.path);
                                  }}
                                  className="flex-1 px-2 py-1 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded-md transition-colors"
                                >
                                  🤖 AI
                                </button>
                              </div>
                              <div className="flex gap-1.5">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleSaveToKnowledge(entry.path);
                                  }}
                                  className="flex-1 px-2 py-1 text-xs bg-orange-500 hover:bg-orange-600 text-white rounded-md transition-colors"
                                >
                                  📚 知识库
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleSaveToMemory(entry.path);
                                  }}
                                  className="flex-1 px-2 py-1 text-xs bg-pink-500 hover:bg-pink-600 text-white rounded-md transition-colors"
                                >
                                  🧠 记忆
                                </button>
                              </div>
                            </div>
                          )}
                          {entry.type === "directory" && (
                            <div className="text-xs text-gray-400 dark:text-gray-500 text-center py-2">
                              点击进入
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ====== 文件预览弹窗 ====== */}
        {previewFile && (
          <FilePreviewModal
            preview={previewFile}
            onClose={closePreview}
            onSendToAI={handleSendToAI}
            onSaveToKnowledge={handleSaveToKnowledge}
          />
        )}
      </div>
    </div>
  );
}

/**
 * 文件预览弹窗属性
 */
interface FilePreviewModalProps {
  preview: FilePreview;
  onClose: () => void;
  onSendToAI: (path: string) => void;
  onSaveToKnowledge: (path: string) => void;
}

/**
 * 文件预览弹窗组件
 * 根据文件类型选择不同的渲染方式：
 * - image: 图片直接显示（含错误回退）
 * - code: 语法高亮（复用 CodeBlock）
 * - markdown: Markdown 渲染（复用 MarkdownRenderer）
 * - json: 格式化 JSON
 * - yaml: 语法高亮展示
 * - pdf/docx/pptx: 使用 MarkdownRenderer 渲染后端转换后的文本
 * - text: 纯文本显示
 */
function FilePreviewModal({
  preview,
  onClose,
  onSendToAI,
  onSaveToKnowledge,
}: FilePreviewModalProps) {
  const [copySuccess, setCopySuccess] = useState(false);
  const [imageError, setImageError] = useState(false);

  const handleCopyContent = async () => {
    try {
      await navigator.clipboard.writeText(preview.content);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      /* ignore */
    }
  };

  /** 是否为文本类内容（可复制） */
  const isTextContent = preview.type !== "image";

  // 图片渲染
  if (preview.type === "image") {
    return (
      <ModalOverlay onClose={onClose}>
        <ModalHeader
          preview={preview}
          onClose={onClose}
          onSendToAI={onSendToAI}
          onSaveToKnowledge={onSaveToKnowledge}
          onCopy={handleCopyContent}
          copySuccess={copySuccess}
          showCopy={false}
        />
        <div className="flex-1 overflow-auto p-4 bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
          {imageError ? (
            <div className="text-center text-gray-400 dark:text-gray-500">
              <svg
                className="w-12 h-12 mx-auto mb-2"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
                />
              </svg>
              <p className="text-sm">图片加载失败</p>
            </div>
          ) : (
            <img
              src={preview.content}
              alt={preview.name}
              className="max-w-full max-h-full object-contain rounded-lg"
              onError={() => setImageError(true)}
            />
          )}
        </div>
      </ModalOverlay>
    );
  }

  // JSON 渲染（格式化）
  if (preview.type === "json") {
    return (
      <ModalOverlay onClose={onClose}>
        <ModalHeader
          preview={preview}
          onClose={onClose}
          onSendToAI={onSendToAI}
          onSaveToKnowledge={onSaveToKnowledge}
          onCopy={handleCopyContent}
          copySuccess={copySuccess}
          showCopy={isTextContent}
        />
        <div className="flex-1 overflow-auto p-4">
          <pre className="text-sm font-mono leading-relaxed text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
            <PrettyJson content={preview.content} />
          </pre>
        </div>
      </ModalOverlay>
    );
  }

  // Markdown 渲染
  if (preview.type === "markdown") {
    return (
      <ModalOverlay onClose={onClose}>
        <ModalHeader
          preview={preview}
          onClose={onClose}
          onSendToAI={onSendToAI}
          onSaveToKnowledge={onSaveToKnowledge}
          onCopy={handleCopyContent}
          copySuccess={copySuccess}
          showCopy={isTextContent}
        />
        <div className="flex-1 overflow-auto p-4 prose dark:prose-invert max-w-none">
          <MarkdownRenderer content={preview.content} />
        </div>
      </ModalOverlay>
    );
  }

  // PDF/DOCX/PPTX — 后端已转换为文本，使用 Markdown 渲染
  if (
    preview.type === "pdf" ||
    preview.type === "docx" ||
    preview.type === "pptx"
  ) {
    return (
      <ModalOverlay onClose={onClose}>
        <ModalHeader
          preview={preview}
          onClose={onClose}
          onSendToAI={onSendToAI}
          onSaveToKnowledge={onSaveToKnowledge}
          onCopy={handleCopyContent}
          copySuccess={copySuccess}
          showCopy={isTextContent}
        />
        <div className="flex-1 overflow-auto p-4 prose dark:prose-invert max-w-none">
          <MarkdownRenderer content={preview.content} />
        </div>
      </ModalOverlay>
    );
  }

  // code / yaml / text — 使用语法高亮渲染
  const language =
    preview.language ||
    (preview.type === "yaml"
      ? "yaml"
      : preview.type === "code"
        ? undefined
        : "text");
  return (
    <ModalOverlay onClose={onClose}>
      <ModalHeader
        preview={preview}
        onClose={onClose}
        onSendToAI={onSendToAI}
        onSaveToKnowledge={onSaveToKnowledge}
        onCopy={handleCopyContent}
        copySuccess={copySuccess}
        showCopy={isTextContent}
      />
      <div className="flex-1 overflow-auto">
        <CodeBlock language={language || "text"} code={preview.content} />
      </div>
    </ModalOverlay>
  );
}

/**
 * 模态框遮罩层
 */
function ModalOverlay({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-[90vw] h-[85vh] bg-white dark:bg-gray-800 rounded-xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * 模态框头部
 */
interface ModalHeaderProps {
  preview: FilePreview;
  onClose: () => void;
  onSendToAI: (path: string) => void;
  onSaveToKnowledge: (path: string) => void;
  onCopy: () => void;
  copySuccess: boolean;
  showCopy: boolean;
}

function ModalHeader({
  preview,
  onClose,
  onSendToAI,
  onSaveToKnowledge,
  onCopy,
  copySuccess,
  showCopy,
}: ModalHeaderProps) {
  return (
    <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-700">
      <div className="flex items-center gap-3 min-w-0">
        <FileTypeBadge type={preview.type} />
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 truncate">
          {preview.name}
        </h3>
        {preview.size !== undefined && (
          <span className="text-xs text-gray-400 font-mono flex-shrink-0">
            {formatSize(preview.size)}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {showCopy && (
          <button
            onClick={onCopy}
            className="px-3 py-1.5 text-sm bg-gray-500 hover:bg-gray-600 text-white rounded-lg transition-colors"
          >
            {copySuccess ? "✅ 已复制" : "📋 复制内容"}
          </button>
        )}
        <button
          onClick={() => onSendToAI(preview.path)}
          className="px-3 py-1.5 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"
        >
          🤖 发送给 AI
        </button>
        <button
          onClick={() => onSaveToKnowledge(preview.path)}
          className="px-3 py-1.5 text-sm bg-orange-500 hover:bg-orange-600 text-white rounded-lg transition-colors"
        >
          📚 存入知识库
        </button>
        <button
          onClick={onClose}
          className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

/**
 * 文件类型徽标
 */
function FileTypeBadge({ type }: { type: FilePreview["type"] }) {
  const badges: Record<string, { label: string; color: string }> = {
    image: {
      label: "图片",
      color:
        "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
    },
    code: {
      label: "代码",
      color: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    },
    markdown: {
      label: "Markdown",
      color:
        "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
    },
    json: {
      label: "JSON",
      color:
        "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
    },
    yaml: {
      label: "YAML",
      color: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300",
    },
    text: {
      label: "文本",
      color: "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300",
    },
    pdf: {
      label: "PDF",
      color: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
    },
    docx: {
      label: "文档",
      color: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    },
    pptx: {
      label: "演示",
      color:
        "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
    },
  };
  const badge = badges[type] || badges.text;

  return (
    <span
      className={`px-2 py-0.5 text-xs font-medium rounded-full ${badge.color}`}
    >
      {badge.label}
    </span>
  );
}

/**
 * JSON 美化渲染组件
 */
function PrettyJson({ content }: { content: string }) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return <code>{content}</code>;
  }

  const formatted = JSON.stringify(parsed, null, 2);

  return <code>{formatted}</code>;
}

export default FileExplorerPage;
