/**
 * Knowledge Store — 独立 Zustand Store
 *
 * 管理知识库页面完整状态：CRUD、视图、编辑器、搜索、列表（bases/files/筛选/分页）。
 * Phase 1 W2: 将 KnowledgePage 的 13 个 useState 全部迁移到此。
 * UX U1: 搜索状态重构——侧边栏搜索结果存入 store 供右侧面板展示。
 * P3-1: 收编 useKnowledgeBaseList 的 useReducer 列表状态（list slice + dispatchList），
 *       搜索状态统一为 search slice（query/listResults/isListSearching），消除双轨同步。
 */
import { create } from "zustand";
import type { KnowledgeFile, KnowledgeBase, KnowledgeSortBy } from "../types";

// ── 子状态接口 ──────────────────────────────────────────

interface ViewState {
  selectedBase: string | null;
  selectedFile: KnowledgeFile | null;
  isInitialLoading: boolean;
}

interface EditorState {
  isEditing: boolean;
  editTitle: string;
  editContent: string;
  editingTags: boolean;
  editTagsInput: string;
  saveStatus: "idle" | "saving" | "saved" | "error";
}

interface EditorDraft {
  title: string;
  content: string;
}

interface SearchState {
  /** 搜索框当前输入（侧边栏 + 标签点击共用，P3-1 后为唯一事实） */
  query: string;
  /** 侧边栏搜索结果列表（供右侧面板展示） */
  listResults: KnowledgeFile[];
  /** 侧边栏是否正在搜索 */
  isListSearching: boolean;
}

// ── 列表状态（P3-1：由 useKnowledgeBaseList 的 useReducer 收编） ──

export type ListCreateStatus = "idle" | "creating" | "error";
export type ListSaveStatus = "idle" | "saving" | "error";
export type ListCompileStatus = "idle" | "compiling" | "success" | "error";

export interface KnowledgeListState {
  bases: KnowledgeBase[];
  files: KnowledgeFile[];
  loading: boolean;
  showCreateModal: boolean;
  newBaseName: string;
  newBaseLabel: string;
  newBaseIcon: string;
  createStatus: ListCreateStatus;
  editingBase: string | null;
  editLabel: string;
  sortBy: KnowledgeSortBy;
  selectedCategory: string | null;
  selectedSource: string | null;
  selectedFileIds: Set<string>;
  showBatchTagModal: boolean;
  batchTagInput: string;
  batchTagStatus: ListSaveStatus;
  compileStatus: ListCompileStatus;
  compileMessage: string;
  searchTags: string[];
  total: number;
  page: number;
  pageSize: number;
  /** KB-前端刷新信号：保存/删除等操作后递增，hook 监听并重载列表 */
  refreshTick: number;
}

/** 列表操作（与 P3-1 前 useKnowledgeBaseList 的 ListAction 语义一致） */
export type KnowledgeListAction =
  | { type: "SET_BASES"; bases: KnowledgeBase[] }
  | { type: "SET_FILES"; files: KnowledgeFile[]; total: number }
  | { type: "SET_LOADING"; loading: boolean }
  | { type: "SET_SEARCHING"; searching: boolean }
  | { type: "SET_SEARCH_QUERY"; query: string }
  | { type: "SET_SEARCH_RESULTS"; results: KnowledgeFile[] }
  | { type: "OPEN_CREATE_MODAL" }
  | { type: "CLOSE_CREATE_MODAL" }
  | { type: "SET_NEW_BASE"; field: "name" | "label" | "icon"; value: string }
  | { type: "SET_CREATE_STATUS"; status: ListCreateStatus }
  | { type: "START_EDIT_BASE"; name: string; label: string }
  | { type: "SET_EDIT_LABEL"; label: string }
  | { type: "CANCEL_EDIT_BASE" }
  | { type: "SET_SORT_BY"; sortBy: KnowledgeSortBy }
  | { type: "SET_CATEGORY"; category: string | null }
  | { type: "SET_SOURCE"; source: string | null }
  | { type: "TOGGLE_FILE_SELECTION"; id: string }
  | { type: "CLEAR_SELECTION" }
  | { type: "OPEN_BATCH_TAG_MODAL" }
  | { type: "CLOSE_BATCH_TAG_MODAL" }
  | { type: "SET_BATCH_TAG_INPUT"; input: string }
  | { type: "SET_BATCH_TAG_STATUS"; status: ListSaveStatus }
  | {
      type: "SET_COMPILE_STATUS";
      status: ListCompileStatus;
    }
  | { type: "SET_COMPILE_MESSAGE"; message: string }
  | { type: "CLEAR_COMPILE" }
  | { type: "SET_SEARCH_TAGS"; tags: string[] }
  | { type: "SET_PAGE"; page: number }
  | { type: "REFRESH_LIST" };

/** 列表初始状态 */
export function createInitialListState(): KnowledgeListState {
  return {
    bases: [],
    files: [],
    loading: true,
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
    searchTags: [],
    total: 0,
    page: 0,
    pageSize: 50,
    refreshTick: 0,
  };
}

/** 纯函数：列表操作 → 状态变更（list + search 两个 slice） */
function applyListAction(
  list: KnowledgeListState,
  search: SearchState,
  action: KnowledgeListAction,
): { list: KnowledgeListState; search: SearchState } {
  switch (action.type) {
    case "SET_BASES":
      return { list: { ...list, bases: action.bases }, search };
    case "SET_FILES":
      return {
        list: {
          ...list,
          files: action.files,
          total: action.total,
          loading: false,
        },
        search,
      };
    case "SET_LOADING":
      return { list: { ...list, loading: action.loading }, search };
    case "SET_SEARCHING":
      return { list, search: { ...search, isListSearching: action.searching } };
    case "SET_SEARCH_QUERY":
      return { list, search: { ...search, query: action.query } };
    case "SET_SEARCH_RESULTS":
      return {
        list,
        search: {
          ...search,
          listResults: action.results,
          isListSearching: false,
        },
      };
    case "OPEN_CREATE_MODAL":
      return {
        list: {
          ...list,
          showCreateModal: true,
          newBaseName: "",
          newBaseLabel: "",
          newBaseIcon: "",
          createStatus: "idle",
        },
        search,
      };
    case "CLOSE_CREATE_MODAL":
      return { list: { ...list, showCreateModal: false }, search };
    case "SET_NEW_BASE": {
      const field =
        action.field === "name"
          ? "newBaseName"
          : action.field === "label"
            ? "newBaseLabel"
            : "newBaseIcon";
      return { list: { ...list, [field]: action.value }, search };
    }
    case "SET_CREATE_STATUS":
      return { list: { ...list, createStatus: action.status }, search };
    case "START_EDIT_BASE":
      return {
        list: { ...list, editingBase: action.name, editLabel: action.label },
        search,
      };
    case "SET_EDIT_LABEL":
      return { list: { ...list, editLabel: action.label }, search };
    case "CANCEL_EDIT_BASE":
      return { list: { ...list, editingBase: null }, search };
    case "SET_SORT_BY":
      return { list: { ...list, sortBy: action.sortBy }, search };
    case "SET_CATEGORY":
      return { list: { ...list, selectedCategory: action.category }, search };
    case "SET_SOURCE":
      return { list: { ...list, selectedSource: action.source }, search };
    case "TOGGLE_FILE_SELECTION": {
      const next = new Set(list.selectedFileIds);
      if (next.has(action.id)) next.delete(action.id);
      else next.add(action.id);
      return { list: { ...list, selectedFileIds: next }, search };
    }
    case "CLEAR_SELECTION":
      return { list: { ...list, selectedFileIds: new Set() }, search };
    case "OPEN_BATCH_TAG_MODAL":
      return {
        list: {
          ...list,
          showBatchTagModal: true,
          batchTagInput: "",
          batchTagStatus: "idle",
        },
        search,
      };
    case "CLOSE_BATCH_TAG_MODAL":
      return { list: { ...list, showBatchTagModal: false }, search };
    case "SET_BATCH_TAG_INPUT":
      return { list: { ...list, batchTagInput: action.input }, search };
    case "SET_BATCH_TAG_STATUS":
      return { list: { ...list, batchTagStatus: action.status }, search };
    case "SET_COMPILE_STATUS":
      return { list: { ...list, compileStatus: action.status }, search };
    case "SET_COMPILE_MESSAGE":
      return { list: { ...list, compileMessage: action.message }, search };
    case "CLEAR_COMPILE":
      return {
        list: { ...list, compileStatus: "idle", compileMessage: "" },
        search,
      };
    case "SET_SEARCH_TAGS":
      return { list: { ...list, searchTags: action.tags }, search };
    case "SET_PAGE":
      return { list: { ...list, page: action.page }, search };
    case "REFRESH_LIST":
      return {
        list: { ...list, refreshTick: list.refreshTick + 1 },
        search,
      };
    default:
      return { list, search };
  }
}

interface KnowledgeStore {
  view: ViewState;
  setView: (partial: Partial<ViewState>) => void;

  editor: EditorState;
  setEditor: (partial: Partial<EditorState>) => void;

  editorDraft: EditorDraft | null;
  setEditorDraft: (draft: EditorDraft | null) => void;

  search: SearchState;
  setSearch: (partial: Partial<SearchState>) => void;
  /** 设置侧边栏搜索结果 */
  setListSearch: (
    results: KnowledgeFile[],
    query: string,
    searching: boolean,
  ) => void;
  /** 清除搜索（恢复空状态） */
  clearSearch: () => void;

  /** 列表状态（P3-1：bases/files/筛选/分页/弹窗等） */
  list: KnowledgeListState;
  /** 列表操作（P3-1：原 useReducer dispatch 收编） */
  dispatchList: (action: KnowledgeListAction) => void;

  notification: { type: "success" | "error"; message: string } | null;
  showNotification: (type: "success" | "error", message: string) => void;
  clearNotification: () => void;
}

export const useKnowledgeStore = create<KnowledgeStore>()((set) => ({
  view: {
    selectedBase: null,
    selectedFile: null,
    isInitialLoading: true,
  },
  setView: (partial) =>
    set((state) => ({ view: { ...state.view, ...partial } })),

  editor: {
    isEditing: false,
    editTitle: "",
    editContent: "",
    editingTags: false,
    editTagsInput: "",
    saveStatus: "idle",
  },
  setEditor: (partial) =>
    set((state) => ({ editor: { ...state.editor, ...partial } })),

  editorDraft: null,
  setEditorDraft: (draft) => set({ editorDraft: draft }),

  search: { query: "", listResults: [], isListSearching: false },
  setSearch: (partial) =>
    set((state) => ({ search: { ...state.search, ...partial } })),

  setListSearch: (results, query, searching) =>
    set((state) => ({
      search: {
        ...state.search,
        listResults: results,
        query,
        isListSearching: searching,
      },
    })),

  clearSearch: () =>
    set((state) => ({
      search: {
        ...state.search,
        query: "",
        listResults: [],
        isListSearching: false,
      },
    })),

  list: createInitialListState(),
  dispatchList: (action) =>
    set((state) => applyListAction(state.list, state.search, action)),

  notification: null,
  showNotification: (type, message) => set({ notification: { type, message } }),
  clearNotification: () => set({ notification: null }),
}));
