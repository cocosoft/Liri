import { useEffect, useCallback, useReducer } from "react";
import type { KnowledgeBase, KnowledgeFile } from "../../types";
import { knowledgeService } from "../../services/knowledgeService";
import FileUploadZone from "./FileUploadZone";
import { createLogger } from "@/utils/logger";
import { formatFileSize, formatDate } from "./shared/utils";
import { sourceLabels } from "./shared/constants";
import { handleClientError } from "../../utils/handleError";

const logger = createLogger("components:knowledgeBaseList");

interface KnowledgeBaseListProps {
  isDark: boolean;
  selectedBase: string | null;
  onSelectBase: (name: string | null) => void;
  onSelectFile: (file: KnowledgeFile) => void;
  selectedFileId: string | null;
  onRefreshBases?: () => void;
  externalSearchQuery?: string;
}

// ── useReducer state & actions ──────────────────────────────────────────
interface ListState {
  bases: KnowledgeBase[];
  files: KnowledgeFile[];
  loading: boolean;
  searchQuery: string;
  showCreateModal: boolean;
  newBaseName: string;
  newBaseLabel: string;
  newBaseIcon: string;
  createStatus: "idle" | "creating" | "error";
  editingBase: string | null;
  editLabel: string;
  compileStatus: "idle" | "compiling" | "success" | "error";
  compileMessage: string;
  sortBy: "updated" | "title" | "created";
  selectedCategory: string | null;
  selectedSource: string | null;
  selectedFileIds: Set<string>;
  showBatchTagModal: boolean;
  batchTagInput: string;
  batchTagStatus: "idle" | "saving" | "error";
  // pagination
  total: number;
  page: number;
  pageSize: number;
}

type ListAction =
  | { type: "SET_BASES"; bases: KnowledgeBase[] }
  | { type: "SET_FILES"; files: KnowledgeFile[] }
  | { type: "SET_LOADING"; loading: boolean }
  | { type: "SET_SEARCH_QUERY"; query: string }
  | { type: "OPEN_CREATE_MODAL" }
  | { type: "CLOSE_CREATE_MODAL" }
  | { type: "SET_NEW_BASE"; field: "name" | "label" | "icon"; value: string }
  | { type: "SET_CREATE_STATUS"; status: "idle" | "creating" | "error" }
  | { type: "START_EDIT_BASE"; name: string; label: string }
  | { type: "SET_EDIT_LABEL"; label: string }
  | { type: "CANCEL_EDIT_BASE" }
  | {
      type: "SET_COMPILE_STATUS";
      status: "idle" | "compiling" | "success" | "error";
    }
  | { type: "SET_COMPILE_MESSAGE"; message: string }
  | { type: "CLEAR_COMPILE" }
  | { type: "SET_SORT_BY"; sortBy: "updated" | "title" | "created" }
  | { type: "SET_CATEGORY"; category: string | null }
  | { type: "SET_SOURCE"; source: string | null }
  | { type: "TOGGLE_FILE_SELECTION"; id: string }
  | { type: "CLEAR_SELECTION" }
  | { type: "OPEN_BATCH_TAG_MODAL" }
  | { type: "CLOSE_BATCH_TAG_MODAL" }
  | { type: "SET_BATCH_TAG_INPUT"; input: string }
  | { type: "SET_BATCH_TAG_STATUS"; status: "idle" | "saving" | "error" }
  | { type: "SET_PAGE"; page: number; total: number };

function listReducer(state: ListState, action: ListAction): ListState {
  switch (action.type) {
    case "SET_BASES":
      return { ...state, bases: action.bases };
    case "SET_FILES":
      return { ...state, files: action.files };
    case "SET_LOADING":
      return { ...state, loading: action.loading };
    case "SET_SEARCH_QUERY":
      return { ...state, searchQuery: action.query };
    case "OPEN_CREATE_MODAL":
      return {
        ...state,
        showCreateModal: true,
        newBaseName: "",
        newBaseLabel: "",
        newBaseIcon: "",
        createStatus: "idle",
      };
    case "CLOSE_CREATE_MODAL":
      return { ...state, showCreateModal: false };
    case "SET_NEW_BASE": {
      const fieldKey =
        action.field === "name"
          ? "newBaseName"
          : action.field === "label"
            ? "newBaseLabel"
            : "newBaseIcon";
      return { ...state, [fieldKey]: action.value };
    }
    case "SET_CREATE_STATUS":
      return { ...state, createStatus: action.status };
    case "START_EDIT_BASE":
      return { ...state, editingBase: action.name, editLabel: action.label };
    case "SET_EDIT_LABEL":
      return { ...state, editLabel: action.label };
    case "CANCEL_EDIT_BASE":
      return { ...state, editingBase: null };
    case "SET_COMPILE_STATUS":
      return { ...state, compileStatus: action.status };
    case "SET_COMPILE_MESSAGE":
      return { ...state, compileMessage: action.message };
    case "CLEAR_COMPILE":
      return { ...state, compileStatus: "idle", compileMessage: "" };
    case "SET_SORT_BY":
      return { ...state, sortBy: action.sortBy };
    case "SET_CATEGORY":
      return { ...state, selectedCategory: action.category };
    case "SET_SOURCE":
      return { ...state, selectedSource: action.source };
    case "TOGGLE_FILE_SELECTION": {
      const next = new Set(state.selectedFileIds);
      if (next.has(action.id)) next.delete(action.id);
      else next.add(action.id);
      return { ...state, selectedFileIds: next };
    }
    case "CLEAR_SELECTION":
      return { ...state, selectedFileIds: new Set() };
    case "OPEN_BATCH_TAG_MODAL":
      return {
        ...state,
        showBatchTagModal: true,
        batchTagInput: "",
        batchTagStatus: "idle",
      };
    case "CLOSE_BATCH_TAG_MODAL":
      return { ...state, showBatchTagModal: false };
    case "SET_BATCH_TAG_INPUT":
      return { ...state, batchTagInput: action.input };
    case "SET_BATCH_TAG_STATUS":
      return { ...state, batchTagStatus: action.status };
    case "SET_PAGE":
      return { ...state, page: action.page, total: action.total };
    default:
      return state;
  }
}

function KnowledgeBaseList({
  isDark,
  selectedBase,
  onSelectBase,
  onSelectFile,
  selectedFileId,
  onRefreshBases,
  externalSearchQuery,
}: KnowledgeBaseListProps) {
  const [state, dispatch] = useReducer(listReducer, {
    bases: [],
    files: [],
    loading: true,
    searchQuery: "",
    showCreateModal: false,
    newBaseName: "",
    newBaseLabel: "",
    newBaseIcon: "",
    createStatus: "idle" as const,
    editingBase: null,
    editLabel: "",
    compileStatus: "idle" as const,
    compileMessage: "",
    sortBy: "updated" as const,
    selectedCategory: null,
    selectedSource: null,
    selectedFileIds: new Set<string>(),
    showBatchTagModal: false,
    batchTagInput: "",
    batchTagStatus: "idle" as const,
    total: 0,
    page: 0,
    pageSize: 50,
  });

  const {
    bases,
    files,
    loading,
    searchQuery,
    showCreateModal,
    newBaseName,
    newBaseLabel,
    newBaseIcon,
    createStatus,
    editingBase,
    editLabel,
    compileStatus,
    compileMessage,
    sortBy,
    selectedCategory,
    selectedSource,
    selectedFileIds,
    showBatchTagModal,
    batchTagInput,
    batchTagStatus,
    total,
    page,
    pageSize,
  } = state;

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

  // 同步外部传入的搜索关键词
  useEffect(() => {
    if (externalSearchQuery !== undefined) {
      dispatch({ type: "SET_SEARCH_QUERY", query: externalSearchQuery });
    }
  }, [externalSearchQuery]);

  async function loadBases() {
    dispatch({ type: "SET_LOADING", loading: true });
    try {
      const data = await knowledgeService.listBases();
      dispatch({ type: "SET_BASES", bases: data });
      if (data.length > 0 && !selectedBase) {
        onSelectBase(data[0].name);
      }
    } catch (err) {
      logger.error("加载知识库列表失败", err);
    } finally {
      dispatch({ type: "SET_LOADING", loading: false });
    }
  }

  async function loadFiles() {
    try {
      const data = await knowledgeService.listFiles(
        selectedBase || undefined,
        page * pageSize,
        pageSize,
      );
      dispatch({ type: "SET_FILES", files: data.items });
      dispatch({ type: "SET_PAGE", page, total: data.total });
    } catch (err) {
      logger.error("加载知识文件失败", err);
      dispatch({ type: "SET_FILES", files: [] });
    }
  }

  function handleRefresh() {
    loadBases();
    onRefreshBases?.();
  }

  async function handleCompile() {
    dispatch({ type: "SET_COMPILE_STATUS", status: "compiling" });
    dispatch({ type: "SET_COMPILE_MESSAGE", message: "" });
    try {
      const result = await knowledgeService.triggerCompile(false);
      dispatch({ type: "SET_COMPILE_STATUS", status: "success" });
      const msg = `编译完成: ${result.compiled} 个成功, ${result.skipped} 个跳过`;
      dispatch({
        type: "SET_COMPILE_MESSAGE",
        message: result.errors?.length
          ? `${msg}, ${result.errors.length} 个错误`
          : msg,
      });
      loadFiles();
    } catch (err) {
      dispatch({ type: "SET_COMPILE_STATUS", status: "error" });
      dispatch({
        type: "SET_COMPILE_MESSAGE",
        message:
          "编译失败: " + (err instanceof Error ? err.message : "未知错误"),
      });
    }
    setTimeout(() => {
      dispatch({ type: "CLEAR_COMPILE" });
    }, 4000);
  }

  function handleUploadComplete() {
    loadFiles();
  }

  async function handleCreateBase() {
    const name = newBaseName.trim();
    const label = newBaseLabel.trim() || name;
    if (!name) return;

    dispatch({ type: "SET_CREATE_STATUS", status: "creating" });
    try {
      await knowledgeService.createBase(
        name,
        label,
        newBaseIcon.trim() || undefined,
      );
      dispatch({ type: "CLOSE_CREATE_MODAL" });
      dispatch({ type: "SET_CREATE_STATUS", status: "idle" });
      await loadBases();
    } catch (e) {
      handleClientError(e, { module: "components:knowledge:KnowledgeBaseList", action: "handleCreateBase" });
      dispatch({ type: "SET_CREATE_STATUS", status: "error" });
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
      dispatch({ type: "CANCEL_EDIT_BASE" });
      return;
    }
    try {
      await knowledgeService.updateBase(name, { label });
      dispatch({ type: "CANCEL_EDIT_BASE" });
      await loadBases();
    } catch (err) {
      logger.error("重命名知识库失败", err);
    }
  }

  const openCreateModal = useCallback(() => {
    dispatch({ type: "OPEN_CREATE_MODAL" });
  }, []);

  const categories = [
    ...new Set(files.map((f) => f.category).filter(Boolean)),
  ] as string[];

  const filteredByCategory = selectedCategory
    ? files.filter((f) => f.category === selectedCategory)
    : files;

  const filteredBySource = selectedSource
    ? filteredByCategory.filter((f) => f.source === selectedSource)
    : filteredByCategory;

  const filteredFiles = (
    searchQuery
      ? filteredBySource.filter(
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
    dispatch({ type: "TOGGLE_FILE_SELECTION", id });
  }
  function clearSelection() {
    dispatch({ type: "CLEAR_SELECTION" });
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
    dispatch({ type: "SET_BATCH_TAG_STATUS", status: "saving" });
    try {
      await knowledgeService.batchTag([...selectedFileIds], tags);
      dispatch({ type: "CLOSE_BATCH_TAG_MODAL" });
      dispatch({ type: "SET_BATCH_TAG_STATUS", status: "idle" });
      clearSelection();
      loadFiles();
    } catch (err) {
      logger.error("批量加标签失败", err);
      dispatch({ type: "SET_BATCH_TAG_STATUS", status: "error" });
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
                  dispatch({
                    type: "START_EDIT_BASE",
                    name: base.name,
                    label: base.label,
                  });
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
                    onChange={(e) =>
                      dispatch({
                        type: "SET_EDIT_LABEL",
                        label: e.target.value,
                      })
                    }
                    onBlur={() => handleRenameBase(base.name)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRenameBase(base.name);
                      if (e.key === "Escape")
                        dispatch({ type: "CANCEL_EDIT_BASE" });
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
          onChange={(e) =>
            dispatch({ type: "SET_SEARCH_QUERY", query: e.target.value })
          }
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
            onChange={(e) =>
              dispatch({
                type: "SET_SORT_BY",
                sortBy: e.target.value as "updated" | "title" | "created",
              })
            }
            className={`text-[10px] px-1.5 py-0.5 rounded border ${inputBg} focus:outline-none cursor-pointer`}
          >
            <option value="updated">最近更新</option>
            <option value="title">按名称</option>
            <option value="created">按创建</option>
          </select>
          <select
            value={selectedSource || "all"}
            onChange={(e) => {
              const val = e.target.value;
              dispatch({
                type: "SET_SOURCE",
                source: val === "all" ? null : val,
              });
            }}
            className={`text-[10px] px-1.5 py-0.5 rounded border ${inputBg} focus:outline-none cursor-pointer`}
          >
            <option value="all">全部来源</option>
            <option value="manual">手动创建</option>
            <option value="upload">文件上传</option>
            <option value="chat-save">聊天保存</option>
            <option value="dream">梦境生成</option>
            <option value="compiled">LLM编译</option>
          </select>
        </div>
        {categories.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-thin">
            <button
              onClick={() => dispatch({ type: "SET_CATEGORY", category: null })}
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
                  dispatch({
                    type: "SET_CATEGORY",
                    category: cat === selectedCategory ? null : cat,
                  })
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
        {/* 分页控制 */}
        {total > pageSize && (
          <div className="flex items-center justify-between px-2 py-1.5 border-t border-gray-200 dark:border-gray-700">
            <span className="text-[10px] text-gray-400">
              {page * pageSize + 1}-{Math.min((page + 1) * pageSize, total)} /{" "}
              {total}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  dispatch({ type: "SET_PAGE", page: 0, total });
                  loadFiles();
                }}
                disabled={page === 0}
                className="text-[10px] px-1.5 py-0.5 rounded border disabled:opacity-30 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                首页
              </button>
              <button
                onClick={() => {
                  const p = Math.max(0, page - 1);
                  dispatch({ type: "SET_PAGE", page: p, total });
                  loadFiles();
                }}
                disabled={page === 0}
                className="text-[10px] px-1.5 py-0.5 rounded border disabled:opacity-30 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                上一页
              </button>
              <button
                onClick={() => {
                  const p = Math.min(Math.ceil(total / pageSize) - 1, page + 1);
                  dispatch({ type: "SET_PAGE", page: p, total });
                  loadFiles();
                }}
                disabled={(page + 1) * pageSize >= total}
                className="text-[10px] px-1.5 py-0.5 rounded border disabled:opacity-30 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                下一页
              </button>
            </div>
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
                onClick={() => dispatch({ type: "OPEN_BATCH_TAG_MODAL" })}
                className={`px-2 py-0.5 text-[10px] rounded ${
                  isDark
                    ? "bg-blue-800 text-blue-200 hover:bg-blue-700"
                    : "bg-blue-200 text-blue-700 hover:bg-blue-300"
                }`}
              >
                批量加标签
              </button>
              <select
                value=""
                onChange={async (e) => {
                  const target = e.target.value;
                  if (!target || selectedFileIds.size === 0) return;
                  (e.target as HTMLSelectElement).value = "";
                  // 移动文档到目标知识库
                  for (const id of selectedFileIds) {
                    await knowledgeService.updateDoc(id, "", undefined, {
                      base: target,
                    });
                  }
                  clearSelection();
                  loadFiles();
                }}
                className={`text-[10px] px-1.5 py-0.5 rounded ${
                  isDark
                    ? "bg-gray-700 border-gray-600 text-gray-300"
                    : "bg-gray-100 border-gray-300 text-gray-600"
                } border focus:outline-none cursor-pointer`}
              >
                <option value="">移至...</option>
                {bases
                  .filter((b) => b.name !== selectedBase)
                  .map((b) => (
                    <option key={b.name} value={b.name}>
                      {b.name}
                    </option>
                  ))}
              </select>
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
              onChange={(e) =>
                dispatch({ type: "SET_BATCH_TAG_INPUT", input: e.target.value })
              }
              placeholder="输入标签，用逗号分隔"
              className={`w-full px-3 py-2 text-sm border rounded-md ${inputBg} focus:outline-none focus:ring-2 focus:ring-blue-500`}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleBatchTag();
                }
                if (e.key === "Escape")
                  dispatch({ type: "CLOSE_BATCH_TAG_MODAL" });
              }}
              autoFocus
            />
            {batchTagStatus === "error" && (
              <p className="text-xs text-red-500 mt-1">添加标签失败，请重试</p>
            )}
            <div className="flex items-center justify-end gap-2 mt-3">
              <button
                onClick={() => dispatch({ type: "CLOSE_BATCH_TAG_MODAL" })}
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
                  onChange={(e) =>
                    dispatch({
                      type: "SET_NEW_BASE",
                      field: "name",
                      value: e.target.value,
                    })
                  }
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
                  onChange={(e) =>
                    dispatch({
                      type: "SET_NEW_BASE",
                      field: "label",
                      value: e.target.value,
                    })
                  }
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
                  onChange={(e) =>
                    dispatch({
                      type: "SET_NEW_BASE",
                      field: "icon",
                      value: e.target.value,
                    })
                  }
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
                onClick={() => dispatch({ type: "CLOSE_CREATE_MODAL" })}
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
