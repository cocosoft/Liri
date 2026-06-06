import { useEffect, useRef, useState } from "react";
import { useFileStore } from "../../stores/fileStore";
import { useAppStore } from "../../stores/appStore";
import { useToastStore } from "../../stores/toastStore";
import { SkeletonTable } from "../common/Skeleton";
import SearchInput from "../common/SearchInput";
import { fileService } from "../../services/fileService";
import type { FileCategory, FilePreview } from "../../types";

type SortField = "name" | "size" | "modified_at";
type SortOrder = "asc" | "desc";

function formatSize(bytes?: number): string {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(ts?: number): string {
  if (!ts) return "";
  return new Date(ts).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const CATEGORY_CONFIG: Record<FileCategory, { label: string; icon: string; color: string }> = {
  output: { label: "AI 输出", icon: "📤", color: "bg-blue-500" },
  downloads: { label: "下载材料", icon: "📥", color: "bg-green-500" },
  attachments: { label: "上传文件", icon: "📁", color: "bg-purple-500" },
  knowledge: { label: "知识库", icon: "📚", color: "bg-orange-500" },
  memory: { label: "记忆", icon: "🧠", color: "bg-pink-500" },
};

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
  
  const setActivePage = useAppStore((s) => s.setActivePage);
  const addToast = useToastStore((s) => s.addToast);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");
  const [previewFile, setPreviewFile] = useState<FilePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    loadDir(currentPath);
    loadWorkspaces();
  }, []);

  const filteredEntries = entries.filter((entry) => {
    if (!searchQuery) return true;
    return entry.name.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const sortedEntries = [...filteredEntries].sort((a, b) => {
    // 目录始终排在前面
    if (a.type === "directory" && b.type !== "directory") return -1;
    if (a.type !== "directory" && b.type === "directory") return 1;

    let comparison = 0;
    switch (sortField) {
      case "name":
        comparison = a.name.localeCompare(b.name);
        break;
      case "size":
        comparison = (a.size || 0) - (b.size || 0);
        break;
      case "modified_at":
        comparison = (a.modified_at || 0) - (b.modified_at || 0);
        break;
    }
    return sortOrder === "asc" ? comparison : -comparison;
  });

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("asc");
    }
  };

  const getFileType = (fileName: string): "code" | "markdown" | "json" | "yaml" | "image" | "text" => {
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    const imageExts = ["jpg", "jpeg", "png", "gif", "bmp", "webp", "svg"];
    const codeExts = ["js", "ts", "tsx", "jsx", "py", "java", "cpp", "c", "go", "rs", "rb", "php"];
    const jsonExts = ["json"];
    const yamlExts = ["yaml", "yml"];
    const markdownExts = ["md", "markdown"];

    if (imageExts.includes(ext)) return "image";
    if (codeExts.includes(ext)) return "code";
    if (jsonExts.includes(ext)) return "json";
    if (yamlExts.includes(ext)) return "yaml";
    if (markdownExts.includes(ext)) return "markdown";
    return "text";
  };

  const handlePreview = async (entry: { name: string; path: string; size?: number }) => {
    try {
      setPreviewLoading(true);
      const content = await fileService.readFile(entry.path);
      const fileType = getFileType(entry.name);

      setPreviewFile({
        name: entry.name,
        path: entry.path,
        content,
        type: fileType,
        size: entry.size,
      });
    } catch (e) {
      addToast("error", `预览失败: ${e}`);
    } finally {
      setPreviewLoading(false);
    }
  };

  const closePreview = () => {
    setPreviewFile(null);
  };

  const handleItemClick = (entry: {
    name: string;
    path: string;
    type: "file" | "directory";
  }) => {
    if (entry.type === "directory") {
      navigateTo(entry.path);
      selectFile(null);
    } else {
      selectFile({ name: entry.name, path: entry.path });
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      uploadFile(file);
      e.target.value = "";
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    files.forEach((file) => uploadFile(file));
  };

  const handleSendToAI = async (filePath: string) => {
    try {
      await sendToAI(filePath);
      addToast("success", "文件已发送给 AI 分析");
      setActivePage("chat");
    } catch (e) {
      addToast("error", `发送失败: ${e}`);
    }
  };

  const handleSaveToKnowledge = async (filePath: string) => {
    try {
      await saveToKnowledge(filePath);
      addToast("success", "文件已存入知识库");
    } catch (e) {
      addToast("error", `存入失败: ${e}`);
    }
  };

  const handleSaveToMemory = async (filePath: string) => {
    try {
      await saveToMemory(filePath);
      addToast("success", "文件内容已存入记忆");
    } catch (e) {
      addToast("error", `存入失败: ${e}`);
    }
  };

  const isFileSelected = (entry: { name: string; path: string }) => {
    return selectedFile?.path === entry.path;
  };

  return (
    <div className="flex-1 flex flex-col bg-gray-50 dark:bg-gray-900">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
            文件枢纽
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {currentWorkspace ? `工作空间: ${currentWorkspace.name}` : "未选择工作空间"}
          </p>
        </div>
        <div className="flex gap-3 items-center">
          <button
            onClick={() => setActivePage("chat")}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            返回聊天
          </button>
        </div>
      </div>

      <div className="flex border-b border-gray-200 dark:border-gray-700">
        {Object.entries(CATEGORY_CONFIG).map(([key, config]) => (
          <button
            key={key}
            onClick={() => setCategory(key as FileCategory)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
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

      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <SearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="搜索文件..."
            className="w-64"
          />
          <div className="relative">
            <button
              onClick={() => setActiveMenu(activeMenu === "workspace" ? null : "workspace")}
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
                      currentWorkspace?.id === ws.id ? "bg-blue-50 dark:bg-blue-900/20" : ""
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
          <div className="relative">
            <button
              onClick={() => setActiveMenu(activeMenu === "sort" ? null : "sort")}
              className="flex items-center gap-2 px-3 py-1.5 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              <span>⇅</span>
              <span>排序</span>
              <span className="text-gray-400">▼</span>
            </button>
            {activeMenu === "sort" && (
              <div className="absolute top-full left-0 mt-1 w-48 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-10">
                <button
                  onClick={() => {
                    toggleSort("name");
                    setActiveMenu(null);
                  }}
                  className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${
                    sortField === "name" ? "bg-blue-50 dark:bg-blue-900/20" : ""
                  }`}
                >
                  名称 {sortField === "name" && (sortOrder === "asc" ? "↑" : "↓")}
                </button>
                <button
                  onClick={() => {
                    toggleSort("size");
                    setActiveMenu(null);
                  }}
                  className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${
                    sortField === "size" ? "bg-blue-50 dark:bg-blue-900/20" : ""
                  }`}
                >
                  大小 {sortField === "size" && (sortOrder === "asc" ? "↑" : "↓")}
                </button>
                <button
                  onClick={() => {
                    toggleSort("modified_at");
                    setActiveMenu(null);
                  }}
                  className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${
                    sortField === "modified_at" ? "bg-blue-50 dark:bg-blue-900/20" : ""
                  }`}
                >
                  修改时间 {sortField === "modified_at" && (sortOrder === "asc" ? "↑" : "↓")}
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={goUp}
            disabled={currentPath.split("/").filter(Boolean).length <= 1}
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

      <div
        className="flex-1 overflow-y-auto p-6"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDragging && (
          <div className="mb-6 p-8 border-2 border-dashed border-green-500 bg-green-50 dark:bg-green-900/20 rounded-lg text-center">
            <p className="text-lg font-medium text-green-600 dark:text-green-400">
              📁 释放文件以上传
            </p>
          </div>
        )}

        {isLoading ? (
          <SkeletonTable />
        ) : error ? (
          <div className="text-center py-12">
            <p className="text-red-500 dark:text-red-400">{error}</p>
          </div>
        ) : sortedEntries.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 dark:text-gray-400">暂无文件</p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-2">
              拖拽文件到此处或点击上传按钮添加文件
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">
                      {entry.type === "directory" ? "📁" : "📄"}
                    </span>
                    <span className="font-medium text-gray-900 dark:text-gray-100 truncate">
                      {entry.name}
                    </span>
                  </div>
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                  <span>{formatSize(entry.size)}</span>
                  <span className="mx-2">|</span>
                  <span>{formatDate(entry.modified_at)}</span>
                </div>
                {entry.type === "file" && (
                  <div className="flex gap-2 mb-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePreview(entry);
                      }}
                      disabled={previewLoading}
                      className="flex-1 px-2 py-1.5 text-xs bg-gray-500 hover:bg-gray-600 text-white rounded-md transition-colors disabled:opacity-50"
                    >
                      👁️ 预览
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSendToAI(entry.path);
                      }}
                      className="flex-1 px-2 py-1.5 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded-md transition-colors"
                    >
                      🤖 发送给 AI
                    </button>
                  </div>
                )}
                {entry.type === "file" && (
                  <div className="flex gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSaveToKnowledge(entry.path);
                      }}
                      className="flex-1 px-2 py-1.5 text-xs bg-orange-500 hover:bg-orange-600 text-white rounded-md transition-colors"
                    >
                      📚 存入知识库
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSaveToMemory(entry.path);
                      }}
                      className="flex-1 px-2 py-1.5 text-xs bg-pink-500 hover:bg-pink-600 text-white rounded-md transition-colors"
                    >
                      🧠 存入记忆
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 文件预览模态框 */}
      {previewFile && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={closePreview}
        >
          <div
            className="relative w-full max-w-4xl max-h-[90vh] bg-white dark:bg-gray-800 rounded-xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 预览头部 */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
              <div className="flex items-center gap-2">
                <span className="text-lg">
                  {previewFile.type === "image" ? "🖼️" : "📄"}
                </span>
                <span className="font-medium text-gray-900 dark:text-gray-100">
                  {previewFile.name}
                </span>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {formatSize(previewFile.size)}
                </span>
              </div>
              <button
                onClick={closePreview}
                className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              >
                ✕
              </button>
            </div>

            {/* 预览内容 */}
            <div className="p-6 overflow-auto max-h-[calc(90vh-60px)]">
              {previewFile.type === "image" ? (
                <div className="flex items-center justify-center">
                  <img
                    src={previewFile.content}
                    alt={previewFile.name}
                    className="max-w-full max-h-[70vh] object-contain rounded-lg shadow-md"
                  />
                </div>
              ) : previewFile.type === "markdown" ? (
                <div className="prose dark:prose-invert max-w-none">
                  <pre className="whitespace-pre-wrap text-sm text-gray-800 dark:text-gray-200">
                    {previewFile.content}
                  </pre>
                </div>
              ) : previewFile.type === "json" ? (
                <pre className="text-sm font-mono text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
                  {(() => {
                    try {
                      return JSON.stringify(JSON.parse(previewFile.content), null, 2);
                    } catch {
                      return previewFile.content;
                    }
                  })()}
                </pre>
              ) : (
                <pre className="text-sm font-mono text-gray-800 dark:text-gray-200 whitespace-pre-wrap overflow-x-auto">
                  {previewFile.content}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default FileExplorerPage;
