/**
 * useKnowledgeBaseList — KnowledgeBaseList 的全部状态与操作逻辑 (Phase 1 W1)
 *
 * 从组件中提取 reducer、state 类型、action 类型和所有 handler 函数，
 * 使 KnowledgeBaseList.tsx 专注渲染。
 */
import { useEffect, useCallback, useReducer } from "react";
import type { KnowledgeBase, KnowledgeFile } from "../../types";
import { knowledgeService } from "../../services/knowledgeService";
import { useKnowledgeStore } from "../../stores/knowledgeStore";
import { createLogger } from "@/utils/logger";
import { handleClientError } from "../../utils/handleError";
import type { SortBy } from "./DocFilterBar";

const logger = createLogger("components:knowledgeBaseList");

// ── State & Actions ──────────────────────────────────────────

export interface ListState {
  bases: KnowledgeBase[];
  files: KnowledgeFile[];
  loading: boolean;
  searching: boolean;
  searchQuery: string;
  searchResults: KnowledgeFile[];
  showCreateModal: boolean;
  newBaseName: string;
  newBaseLabel: string;
  newBaseIcon: string;
  createStatus: "idle" | "creating" | "error";
  editingBase: string | null;
  editLabel: string;
  sortBy: SortBy;
  selectedCategory: string | null;
  selectedSource: string | null;
  selectedFileIds: Set<string>;
  showBatchTagModal: boolean;
  batchTagInput: string;
  batchTagStatus: "idle" | "saving" | "error";
  compileStatus: "idle" | "compiling" | "success" | "error";
  compileMessage: string;
  total: number;
  page: number;
  pageSize: number;
}

export type ListAction =
  | { type: "SET_BASES"; bases: KnowledgeBase[] }
  | { type: "SET_FILES"; files: KnowledgeFile[]; total: number }
  | { type: "SET_LOADING"; loading: boolean }
  | { type: "SET_SEARCHING"; searching: boolean }
  | { type: "SET_SEARCH_QUERY"; query: string }
  | { type: "SET_SEARCH_RESULTS"; results: KnowledgeFile[] }
  | { type: "OPEN_CREATE_MODAL" }
  | { type: "CLOSE_CREATE_MODAL" }
  | { type: "SET_NEW_BASE"; field: "name" | "label" | "icon"; value: string }
  | { type: "SET_CREATE_STATUS"; status: "idle" | "creating" | "error" }
  | { type: "START_EDIT_BASE"; name: string; label: string }
  | { type: "SET_EDIT_LABEL"; label: string }
  | { type: "CANCEL_EDIT_BASE" }
  | { type: "SET_SORT_BY"; sortBy: SortBy }
  | { type: "SET_CATEGORY"; category: string | null }
  | { type: "SET_SOURCE"; source: string | null }
  | { type: "TOGGLE_FILE_SELECTION"; id: string }
  | { type: "CLEAR_SELECTION" }
  | { type: "OPEN_BATCH_TAG_MODAL" }
  | { type: "CLOSE_BATCH_TAG_MODAL" }
  | { type: "SET_BATCH_TAG_INPUT"; input: string }
  | { type: "SET_BATCH_TAG_STATUS"; status: "idle" | "saving" | "error" }
  | {
      type: "SET_COMPILE_STATUS";
      status: "idle" | "compiling" | "success" | "error";
    }
  | { type: "SET_COMPILE_MESSAGE"; message: string }
  | { type: "CLEAR_COMPILE" }
  | { type: "SET_PAGE"; page: number };

function listReducer(state: ListState, action: ListAction): ListState {
  switch (action.type) {
    case "SET_BASES":
      return { ...state, bases: action.bases };
    case "SET_FILES":
      return {
        ...state,
        files: action.files,
        total: action.total,
        loading: false,
      };
    case "SET_LOADING":
      return { ...state, loading: action.loading };
    case "SET_SEARCHING":
      return { ...state, searching: action.searching };
    case "SET_SEARCH_QUERY":
      return { ...state, searchQuery: action.query };
    case "SET_SEARCH_RESULTS":
      return { ...state, searchResults: action.results, searching: false };
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
    case "SET_NEW_BASE":
      return {
        ...state,
        [action.field === "name"
          ? "newBaseName"
          : action.field === "label"
            ? "newBaseLabel"
            : "newBaseIcon"]: action.value,
      };
    case "SET_CREATE_STATUS":
      return { ...state, createStatus: action.status };
    case "START_EDIT_BASE":
      return { ...state, editingBase: action.name, editLabel: action.label };
    case "SET_EDIT_LABEL":
      return { ...state, editLabel: action.label };
    case "CANCEL_EDIT_BASE":
      return { ...state, editingBase: null };
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
    case "SET_COMPILE_STATUS":
      return { ...state, compileStatus: action.status };
    case "SET_COMPILE_MESSAGE":
      return { ...state, compileMessage: action.message };
    case "CLEAR_COMPILE":
      return { ...state, compileStatus: "idle", compileMessage: "" };
    case "SET_PAGE":
      return { ...state, page: action.page };
    default:
      return state;
  }
}

// ── Hook ─────────────────────────────────────────────────────

export interface UseKnowledgeBaseListOpts {
  selectedBase: string | null;
  onSelectBase: (name: string | null) => void;
  onRefreshBases?: () => void;
  externalSearchQuery?: string;
}

export function useKnowledgeBaseList(opts: UseKnowledgeBaseListOpts) {
  const { selectedBase, onSelectBase, onRefreshBases, externalSearchQuery } =
    opts;

  const [state, dispatch] = useReducer(listReducer, {
    bases: [],
    files: [],
    loading: true,
    searching: false,
    searchQuery: "",
    searchResults: [],
    showCreateModal: false,
    newBaseName: "",
    newBaseLabel: "",
    newBaseIcon: "",
    createStatus: "idle",
    editingBase: null,
    editLabel: "",
    sortBy: "updated",
    selectedCategory: null,
    selectedSource: null,
    selectedFileIds: new Set<string>(),
    showBatchTagModal: false,
    batchTagInput: "",
    batchTagStatus: "idle",
    compileStatus: "idle",
    compileMessage: "",
    total: 0,
    page: 0,
    pageSize: 50,
  });

  const {
    bases,
    files,
    loading,
    searching,
    searchQuery,
    searchResults,
    showCreateModal,
    newBaseName,
    newBaseLabel,
    newBaseIcon,
    createStatus,
    editingBase,
    editLabel,
    sortBy,
    selectedCategory,
    selectedSource,
    selectedFileIds,
    showBatchTagModal,
    batchTagInput,
    batchTagStatus,
    compileStatus,
    compileMessage,
    total,
    page,
    pageSize,
  } = state;

  // ── 数据加载 ──
  useEffect(() => {
    loadBases();
  }, []);
  useEffect(() => {
    if (selectedBase !== undefined) loadFiles();
  }, [selectedBase]);
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
      if (data.length > 0 && !selectedBase) onSelectBase(data[0].name);
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
      dispatch({ type: "SET_FILES", files: data.items, total: data.total });
    } catch (err) {
      logger.error("加载知识文件失败", err);
      dispatch({ type: "SET_FILES", files: [], total: 0 });
    }
  }

  function handleRefresh() {
    loadBases();
    onRefreshBases?.();
  }

  // ── W3: 服务端搜索 + U1: 结果写入 store ──
  const handleSearch = useCallback(
    async (query: string, base: string | null) => {
      if (!query.trim()) return;
      dispatch({ type: "SET_SEARCHING", searching: true });
      // UX U1: 同步写入 store 供 KnowledgePage 右侧面板展示
      useKnowledgeStore.getState().setListSearch([], query.trim(), true);
      try {
        const results = await knowledgeService.hybridSearch(
          query.trim(),
          base || undefined,
        );
        const mapped: KnowledgeFile[] = results.map((r) => ({
          id: r.id,
          title: r.title,
          content: r.content,
          category: r.category,
          tags: [],
          docPath: r.docPath || r.id,
          base: base || "",
          size: 0,
          source: "manual" as const,
          created_at: Date.now(),
          updated_at: Date.now(),
        }));
        dispatch({ type: "SET_SEARCH_RESULTS", results: mapped });
        useKnowledgeStore.getState().setListSearch(mapped, query.trim(), false);
      } catch (err) {
        logger.error("搜索失败", err);
        dispatch({ type: "SET_SEARCH_RESULTS", results: [] });
        useKnowledgeStore.getState().setListSearch([], query.trim(), false);
      }
    },
    [],
  );

  // ── 编译 ──
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
    setTimeout(() => dispatch({ type: "CLEAR_COMPILE" }), 4000);
  }

  // ── 创建/删除/重命名知识库 ──
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
      handleClientError(e, {
        module: "components:knowledge:KnowledgeBaseList",
        action: "handleCreateBase",
      });
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
      if (selectedBase === name) onSelectBase(null);
      await loadBases();
    } catch (err) {
      logger.error("删除知识库失败", err);
    }
  }

  async function handleCloneBase(name: string) {
    const newName = prompt("请输入新知识库名称（克隆含文档和索引）:", `${name}-clone`);
    if (!newName?.trim()) return;
    try {
      await knowledgeService.cloneBase(name, newName.trim());
      await loadBases();
    } catch (err) {
      logger.error("克隆知识库失败", err);
      alert(`克隆失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function handleDuplicateBase(name: string) {
    const newName = prompt("请输入新知识库名称（仅复制配置，不含文档）:", `${name}-copy`);
    if (!newName?.trim()) return;
    try {
      await knowledgeService.duplicateBase(name, newName.trim());
      await loadBases();
    } catch (err) {
      logger.error("复制知识库配置失败", err);
      alert(`复制失败: ${err instanceof Error ? err.message : String(err)}`);
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

  // ── 批量标签 ──
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
      dispatch({ type: "CLEAR_SELECTION" });
      loadFiles();
    } catch (err) {
      logger.error("批量加标签失败", err);
      dispatch({ type: "SET_BATCH_TAG_STATUS", status: "error" });
    }
  }

  return {
    // state
    bases,
    files,
    loading,
    searching,
    searchQuery,
    searchResults,
    showCreateModal,
    newBaseName,
    newBaseLabel,
    newBaseIcon,
    createStatus,
    editingBase,
    editLabel,
    sortBy,
    selectedCategory,
    selectedSource,
    selectedFileIds,
    showBatchTagModal,
    batchTagInput,
    batchTagStatus,
    compileStatus,
    compileMessage,
    total,
    page,
    pageSize,
    // dispatch
    dispatch,
    // handlers
    loadFiles,
    handleRefresh,
    handleSearch,
    handleCompile,
    handleCreateBase,
    handleDeleteBase,
    handleCloneBase,
    handleDuplicateBase,
    handleRenameBase,
    handleBatchTag,
  };
}
