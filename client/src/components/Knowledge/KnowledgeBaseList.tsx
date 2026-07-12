import { useState, useEffect, useCallback } from "react";
import type { KnowledgeBase, KnowledgeFile } from "../../types";
import { knowledgeService } from "../../services/knowledgeService";
import FileUploadZone from "./FileUploadZone";
import { createLogger } from "@/utils/logger";
import { formatFileSize, formatDate } from "./shared/utils";
import { sourceLabels } from "./shared/constants";

const logger = createLogger("components:knowledgeBaseList");

interface KnowledgeBaseListProps {
  isDark: boolean;
  selectedBase: string | null;
  onSelectBase: (name: string | null) => void;
  onSelectFile: (file: KnowledgeFile) => void;
  selectedFileId: string | null;
  onRefreshBases?: () => void;
}

function KnowledgeBaseList({
  isDark,
  selectedBase,
  onSelectBase,
  onSelectFile,
  selectedFileId,
  onRefreshBases,
}: KnowledgeBaseListProps) {
  const [bases, setBases] = useState<KnowledgeBase[]>([]);
  const [files, setFiles] = useState<KnowledgeFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newBaseName, setNewBaseName] = useState("");
  const [newBaseLabel, setNewBaseLabel] = useState("");
  const [newBaseIcon, setNewBaseIcon] = useState("");
  const [createStatus, setCreateStatus] = useState<
    "idle" | "creating" | "error"
  >("idle");
  const [editingBase, setEditingBase] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [compileStatus, setCompileStatus] = useState<
    "idle" | "compiling" | "success" | "error"
  >("idle");
  const [compileMessage, setCompileMessage] = useState("");
  const [sortBy, setSortBy] = useState<"updated" | "title" | "created">(
    "updated",
  );
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(
    new Set(),
  );
  const [showBatchTagModal, setShowBatchTagModal] = useState(false);
  const [batchTagInput, setBatchTagInput] = useState("");
  const [batchTagStatus, setBatchTagStatus] = useState<
    "idle" | "saving" | "error"
  >("idle");

  const bgClass = isDark ? "bg-gray-800" : "bg-gray-50";
  const textPrimary = isDark ? "text-gray-100" : "text-gray-900";
  const textSecondary = isDark ? "text-gray-400" : "text-gray-500";
  const textMuted = isDark ? "text-gray-500" : "text-gray-400";
  const activeBg = isDark ? "bg-gray-700" : "bg-blue-50";
  const borderColor = isDark ? "border-gray-700" : "border-gray-200";
  const inputBg = isDark
    ? "bg-gray-700 border-gray-600 text-white placeholder-gray-400"
    : "bg-white border-gray-300 text-gray-900 placeholder-gray-400";

  useEffect(() => {
    loadBases();
  }, []);

  useEffect(() => {
    if (selectedBase !== undefined) {
      loadFiles();
    }
  }, [selectedBase]);

  async function loadBases() {
    setLoading(true);
    try {
      const data = await knowledgeService.listBases();
      setBases(data);
      if (data.length > 0 && !selectedBase) {
        onSelectBase(data[0].name);
      }
    } catch (err) {
      logger.error("加载知识库列表失败", err);
    } finally {
      setLoading(false);
    }
  }

  async function loadFiles() {
    try {
      const data = await knowledgeService.listFiles(selectedBase || undefined);
      setFiles(data);
    } catch (err) {
      logger.error("加载知识文件失败", err);
      setFiles([]);
    }
  }

  function handleRefresh() {
    loadBases();
    onRefreshBases?.();
  }

  async function handleCompile() {
    setCompileStatus("compiling");
    setCompileMessage("");
    try {
      const result = await knowledgeService.triggerCompile(false);
      setCompileStatus("success");
      const msg = `编译完成: ${result.compiled} 个成功, ${result.skipped} 个跳过`;
      setCompileMessage(
        result.errors?.length ? `${msg}, ${result.errors.length} 个错误` : msg,
      );
      loadFiles();
    } catch (err) {
      setCompileStatus("error");
      setCompileMessage(
        "编译失败: " + (err instanceof Error ? err.message : "未知错误"),
      );
    }
    setTimeout(() => {
      setCompileStatus("idle");
      setCompileMessage("");
    }, 4000);
  }

  function handleUploadComplete() {
    loadFiles();
  }

  async function handleCreateBase() {
    const name = newBaseName.trim();
    const label = newBaseLabel.trim() || name;
    if (!name) return;

    setCreateStatus("creating");
    try {
      await knowledgeService.createBase(
        name,
        label,
        newBaseIcon.trim() || undefined,
      );
      setShowCreateModal(false);
      setNewBaseName("");
      setNewBaseLabel("");
      setNewBaseIcon("");
      setCreateStatus("idle");
      await loadBases();
    } catch {
      setCreateStatus("error");
    }
  }

  async function handleDeleteBase(name: string) {
    if (
      !confirm(
        `确定要删除知识库 "${name}" 吗？相关文件不会被删除，但知识库将不再显示。`,
      )
    )
      return;
    try {
      await knowledgeService.deleteBase(name);
      if (selectedBase === name) {
        onSelectBase(null);
      }
      await loadBases();
    } catch (err) {
      logger.error("删除知识库失败", err);
    }
  }

  async function handleRenameBase(name: string) {
    const label = editLabel.trim();
    if (!label || label === bases.find((b) => b.name === name)?.label) {
      setEditingBase(null);
      return;
    }
    try {
      await knowledgeService.updateBase(name, { label });
      setEditingBase(null);
      await loadBases();
    } catch (err) {
      logger.error("重命名知识库失败", err);
    }
  }

  const openCreateModal = useCallback(() => {
    setNewBaseName("");
    setNewBaseLabel("");
    setNewBaseIcon("");
    setCreateStatus("idle");
    setShowCreateModal(true);
  }, []);

  const categories = [
    ...new Set(files.map((f) => f.category).filter(Boolean)),
  ] as string[];

  const filteredByCategory = selectedCategory
    ? files.filter((f) => f.category === selectedCategory)
    : files;

  const filteredFiles = (
    searchQuery
      ? filteredByCategory.filter(
          (f) =>
            f.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            f.content.toLowerCase().includes(searchQuery.toLowerCase()),
        )
      : filteredByCategory
  ).sort((a, b) => {
    if (sortBy === "title") return a.title.localeCompare(b.title);
    if (sortBy === "created") return (b.created_at || 0) - (a.created_at || 0);
    return (b.updated_at || 0) - (a.updated_at || 0);
  });

  const hasSelection = selectedFileIds.size > 0;
  function toggleFileSelection(id: string) {
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }
  function clearSelection() {
    setSelectedFileIds(new Set());
  }

  async function handleBatchDelete() {
    if (selectedFileIds.size === 0) return;
    if (
      !confirm(
        `确定要删除选中的 ${selectedFileIds.size} 个文档吗？此操作不可撤销。`,
      )
    )
      return;
    try {
      await knowledgeService.batchDelete([...selectedFileIds]);
      clearSelection();
      loadFiles();
    } catch (err) {
      logger.error("批量删除失败", err);
    }
  }

  async function handleBatchTag() {
    if (selectedFileIds.size === 0) return;
    const tags = batchTagInput
      .split(/[,\n]/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (tags.length === 0) return;
    setBatchTagStatus("saving");
    try {
      await knowledgeService.batchTag([...selectedFileIds], tags);
      setShowBatchTagModal(false);
      setBatchTagInput("");
      setBatchTagStatus("idle");
      clearSelection();
      loadFiles();
    } catch (err) {
      logger.error("批量加标签失败", err);
      setBatchTagStatus("error");
    }
  }

  return (
    <div className={`flex flex-col h-full ${bgClass}`}>
      <div
        className={`flex items-center justify-between px-4 py-3 border-b ${borderColor}`}
      >
        <h2 className={`text-sm font-medium ${textPrimary}`}>知识库</h2>
        <div className="flex items-center gap-1">
          <button
            onClick={openCreateModal}
            className={`p-1 rounded ${textSecondary} hover:${isDark ? "text-gray-300" : "text-gray-700"} hover:bg-gray-100 dark:hover:bg-gray-700`}
            title="新建知识库"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
          </button>
          <button
            onClick={handleRefresh}
            className={`p-1 rounded ${textSecondary} hover:${isDark ? "text-gray-300" : "text-gray-700"} hover:bg-gray-100 dark:hover:bg-gray-700`}
            title="刷新"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
          <button
            onClick={handleCompile}
            disabled={compileStatus === "compiling"}
            className={`p-1 rounded ${textSecondary} hover:${isDark ? "text-gray-300" : "text-gray-700"} hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40`}
            title="编译 raw 文件"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
          </button>
        </div>
      </div>

      <div className="px-4 py-2">
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button
            onClick={() => onSelectBase(null)}
            className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              selectedBase === null
                ? "bg-blue-500 text-white"
                : isDark
                  ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            全部
          </button>
          {bases.map((base) => (
            <div key={base.name} className="relative group flex-shrink-0">
              <button
                onClick={() => {
                  if (editingBase === base.name) {
                    handleRenameBase(base.name);
                  } else {
                    onSelectBase(base.name);
                  }
                }}
                onDoubleClick={() => {
                  setEditingBase(base.name);
                  setEditLabel(base.label);
                }}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  selectedBase === base.name
                    ? "bg-blue-500 text-white"
                    : isDark
                      ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {editingBase === base.name ? (
                  <input
                    type="text"
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    onBlur={() => handleRenameBase(base.name)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRenameBase(base.name);
                      if (e.key === "Escape") setEditingBase(null);
                    }}
                    className="w-16 bg-transparent border-b border-current outline-none text-center"
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <>
                    {base.icon && <span className="mr-1">{base.icon}</span>}
                    {base.label}
                    <span
                      className={`ml-1 ${selectedBase === base.name ? "text-blue-200" : textMuted}`}
                    >
                      {base.docCount}
                    </span>
                  </>
                )}
              </button>
              {base.source === "user" && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteBase(base.name);
                  }}
                  className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  title="删除知识库"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="px-4 pb-2 space-y-1.5">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="搜索知识文档..."
          className={`w-full px-3 py-1.5 rounded-md text-xs border ${inputBg} focus:outline-none focus:ring-1 focus:ring-blue-500`}
        />
        <div className="flex items-center justify-between">
          <span className={`text-[10px] ${textMuted}`}>
            {filteredByCategory.length} 个文档
            {selectedCategory && (
              <span className="ml-1 opacity-60">（已筛选）</span>
            )}
          </span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className={`text-[10px] px-1.5 py-0.5 rounded border ${inputBg} focus:outline-none cursor-pointer`}
          >
            <option value="updated">最近更新</option>
            <option value="title">按名称</option>
            <option value="created">创建时间</option>
          </select>
        </div>
        {categories.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-thin">
            <button
              onClick={() => setSelectedCategory(null)}
              className={`flex-shrink-0 px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                selectedCategory === null
                  ? "bg-blue-500 text-white"
                  : isDark
                    ? "bg-gray-700 text-gray-400 hover:text-gray-200"
                    : "bg-gray-100 text-gray-500 hover:text-gray-700"
              }`}
            >
              全部分类
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() =>
                  setSelectedCategory(cat === selectedCategory ? null : cat)
                }
                className={`flex-shrink-0 px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                  selectedCategory === cat
                    ? "bg-blue-500 text-white"
                    : isDark
                      ? "bg-gray-700 text-gray-400 hover:text-gray-200"
                      : "bg-gray-100 text-gray-500 hover:text-gray-700"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        )}
      </div>

      {compileStatus !== "idle" && (
        <div className="px-4 pb-2">
          <div
            className={`text-xs px-2 py-1 rounded ${
              compileStatus === "compiling"
                ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300"
                : compileStatus === "success"
                  ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-300"
                  : "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-300"
            }`}
          >
            {compileStatus === "compiling" ? (
              <span className="flex items-center gap-1">
                <span className="animate-spin w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full inline-block" />
                编译中...
              </span>
            ) : (
              compileMessage
            )}
          </div>
        </div>
      )}

      <FileUploadZone
        isDark={isDark}
        baseName={selectedBase}
        onUploadComplete={handleUploadComplete}
      />

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {hasSelection && (
          <div
            className={`sticky top-0 z-10 px-2 py-1.5 mb-1.5 rounded-md flex items-center justify-between ${
              isDark
                ? "bg-blue-900/40 border border-blue-800"
                : "bg-blue-50 border border-blue-200"
            }`}
          >
            <span
              className={`text-xs font-medium ${isDark ? "text-blue-300" : "text-blue-700"}`}
            >
              已选 {selectedFileIds.size} 项
            </span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setShowBatchTagModal(true)}
                className={`px-2 py-0.5 text-[10px] rounded ${
                  isDark
                    ? "bg-blue-800 text-blue-200 hover:bg-blue-700"
                    : "bg-blue-200 text-blue-700 hover:bg-blue-300"
                }`}
              >
                批量加标签
              </button>
              <button
                onClick={handleBatchDelete}
                className={`px-2 py-0.5 text-[10px] rounded ${
                  isDark
                    ? "bg-red-900/50 text-red-300 hover:bg-red-800/60"
                    : "bg-red-100 text-red-600 hover:bg-red-200"
                }`}
              >
                删除
              </button>
              <button
                onClick={clearSelection}
                className={`px-2 py-0.5 text-[10px] rounded ${
                  isDark
                    ? "text-gray-400 hover:text-gray-200"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                取消
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className={`text-center py-8 ${textMuted}`}>
            <div className="animate-spin w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-2" />
            <span className="text-xs">加载中...</span>
          </div>
        ) : filteredFiles.length === 0 ? (
          <div className={`text-center py-8 ${textMuted}`}>
            <svg
              className="w-10 h-10 mx-auto mb-2 opacity-40"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            <p className="text-xs">暂无知识文档</p>
          </div>
        ) : (
          <div className="space-y-1">
            {filteredFiles.map((file) => (
              <div
                key={file.id}
                className={`px-1 py-2 rounded-md transition-colors flex items-start gap-1 ${
                  selectedFileId === file.id
                    ? activeBg
                    : isDark
                      ? "hover:bg-gray-700"
                      : "hover:bg-gray-100"
                }`}
              >
                <div
                  className="flex-shrink-0 pt-0.5 pl-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFileSelection(file.id);
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedFileIds.has(file.id)}
                    onChange={() => {}}
                    className="w-3 h-3 rounded cursor-pointer accent-blue-500"
                  />
                </div>
                <div
                  className="flex-1 min-w-0 cursor-pointer"
                  onClick={() => onSelectFile(file)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p
                        className={`text-sm font-medium truncate ${textPrimary}`}
                      >
                        {file.title || "未命名文档"}
                      </p>
                      <p
                        className={`text-xs ${textSecondary} mt-0.5 line-clamp-1`}
                      >
                        {file.content?.slice(0, 80) || "无内容"}
                      </p>
                    </div>
                    {file.source && (
                      <span
                        className={`flex-shrink-0 ml-2 px-1.5 py-0.5 rounded text-[10px] ${
                          isDark
                            ? "bg-gray-700 text-gray-400"
                            : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        {sourceLabels[file.source] || file.source}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className={`text-[10px] ${textMuted}`}>
                      {formatFileSize(file.size)}
                    </span>
                    {file.updated_at > 0 && (
                      <span className={`text-[10px] ${textMuted}`}>
                        {formatDate(file.updated_at)}
                      </span>
                    )}
                    {file.base && (
                      <span className={`text-[10px] ${textMuted}`}>
                        {file.base}
                      </span>
                    )}
                    {file.category && (
                      <span className={`text-[10px] ${textMuted}`}>
                        分类: {file.category}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showBatchTagModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div
            className={`w-72 p-4 rounded-xl shadow-xl ${
              isDark
                ? "bg-gray-800 border border-gray-700"
                : "bg-white border border-gray-200"
            }`}
          >
            <h3
              className={`text-sm font-semibold mb-1 ${isDark ? "text-gray-100" : "text-gray-900"}`}
            >
              批量加标签
            </h3>
            <p className={`text-xs mb-3 ${textSecondary}`}>
              为选中的 {selectedFileIds.size} 个文档添加以下标签：
            </p>
            <input
              type="text"
              value={batchTagInput}
              onChange={(e) => setBatchTagInput(e.target.value)}
              placeholder="输入标签，用逗号分隔"
              className={`w-full px-3 py-2 text-sm border rounded-md ${inputBg} focus:outline-none focus:ring-2 focus:ring-blue-500`}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleBatchTag();
                }
                if (e.key === "Escape") setShowBatchTagModal(false);
              }}
              autoFocus
            />
            {batchTagStatus === "error" && (
              <p className="text-xs text-red-500 mt-1">添加标签失败，请重试</p>
            )}
            <div className="flex items-center justify-end gap-2 mt-3">
              <button
                onClick={() => setShowBatchTagModal(false)}
                className="px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md"
              >
                取消
              </button>
              <button
                onClick={handleBatchTag}
                disabled={batchTagStatus === "saving" || !batchTagInput.trim()}
                className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-md"
              >
                {batchTagStatus === "saving" ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div
            className={`w-80 p-5 rounded-xl shadow-xl ${
              isDark
                ? "bg-gray-800 border border-gray-700"
                : "bg-white border border-gray-200"
            }`}
          >
            <h3
              className={`text-sm font-semibold mb-4 ${isDark ? "text-gray-100" : "text-gray-900"}`}
            >
              新建知识库
            </h3>
            <div className="space-y-3">
              <div>
                <label
                  className={`block text-xs mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
                >
                  名称（用于目录命名）
                </label>
                <input
                  type="text"
                  value={newBaseName}
                  onChange={(e) => setNewBaseName(e.target.value)}
                  placeholder="如: my-knowledge"
                  className={`w-full px-3 py-2 border rounded-md text-sm ${
                    isDark
                      ? "bg-gray-700 border-gray-600 text-white placeholder-gray-400"
                      : "bg-white border-gray-300 text-gray-900 placeholder-gray-400"
                  } focus:outline-none focus:ring-2 focus:ring-blue-500`}
                />
              </div>
              <div>
                <label
                  className={`block text-xs mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
                >
                  显示名称
                </label>
                <input
                  type="text"
                  value={newBaseLabel}
                  onChange={(e) => setNewBaseLabel(e.target.value)}
                  placeholder="如: 我的知识库"
                  className={`w-full px-3 py-2 border rounded-md text-sm ${
                    isDark
                      ? "bg-gray-700 border-gray-600 text-white placeholder-gray-400"
                      : "bg-white border-gray-300 text-gray-900 placeholder-gray-400"
                  } focus:outline-none focus:ring-2 focus:ring-blue-500`}
                />
              </div>
              <div>
                <label
                  className={`block text-xs mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
                >
                  图标（可选）
                </label>
                <input
                  type="text"
                  value={newBaseIcon}
                  onChange={(e) => setNewBaseIcon(e.target.value)}
                  placeholder="如: 📚"
                  className={`w-full px-3 py-2 border rounded-md text-sm ${
                    isDark
                      ? "bg-gray-700 border-gray-600 text-white placeholder-gray-400"
                      : "bg-white border-gray-300 text-gray-900 placeholder-gray-400"
                  } focus:outline-none focus:ring-2 focus:ring-blue-500`}
                />
              </div>
              {createStatus === "error" && (
                <p className="text-xs text-red-500">创建失败，请重试</p>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 mt-4">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md"
              >
                取消
              </button>
              <button
                onClick={handleCreateBase}
                disabled={createStatus === "creating" || !newBaseName.trim()}
                className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-md"
              >
                {createStatus === "creating" ? "创建中..." : "创建"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default KnowledgeBaseList;
