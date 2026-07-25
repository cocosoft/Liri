/**
 * Knowledge Store — 独立 Zustand Store
 *
 * 管理知识库页面完整状态：CRUD、视图、编辑器、搜索。
 * Phase 1 W2: 将 KnowledgePage 的 13 个 useState 全部迁移到此。
 * UX U1: 搜索状态重构——侧边栏搜索结果存入 store 供右侧面板展示。
 */
import { create } from "zustand";
import { knowledgeService } from "../services/knowledgeService";
import { handleClientError } from "@/utils/handleError";
import type { KnowledgeItem, KnowledgeFile } from "../types";

export type { KnowledgeItem };

// ── 子状态接口 ──────────────────────────────────────────

interface ViewState {
  activeTab: "knowledge" | "semantic" | "faq";
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
  /** 搜索框当前输入（侧边栏 + 标签点击共用） */
  query: string;
  /** 侧边栏搜索结果列表（供右侧面板展示） */
  listResults: KnowledgeFile[];
  /** 侧边栏是否正在搜索 */
  isListSearching: boolean;
}

interface KnowledgeStore {
  items: KnowledgeItem[];
  isLoading: boolean;
  error: string | null;
  loadItems: () => Promise<void>;
  createItem: (
    item: Omit<KnowledgeItem, "id" | "created_at" | "updated_at">,
  ) => Promise<void>;
  updateItem: (id: string, updates: Partial<KnowledgeItem>) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;

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

  notification: { type: "success" | "error"; message: string } | null;
  showNotification: (type: "success" | "error", message: string) => void;
  clearNotification: () => void;
}

export const useKnowledgeStore = create<KnowledgeStore>()((set) => ({
  items: [],
  isLoading: false,
  error: null,

  loadItems: async () => {
    set({ isLoading: true, error: null });
    try {
      const items = await knowledgeService.list();
      set({ items, isLoading: false });
    } catch (e) {
      handleClientError(
        e,
        { module: "stores:knowledgeStore", action: "loadItems" },
        "warn",
      );
      set({ error: String(e), isLoading: false });
    }
  },

  createItem: async (item) => {
    try {
      const created = await knowledgeService.create(item);
      set((state) => ({ items: [...state.items, created] }));
    } catch (e) {
      handleClientError(
        e,
        { module: "stores:knowledgeStore", action: "createItem" },
        "warn",
      );
      set({ error: String(e) });
    }
  },

  updateItem: async (id, updates) => {
    try {
      const updated = await knowledgeService.update(id, updates);
      set((state) => ({
        items: state.items.map((i) => (i.id === id ? updated : i)),
      }));
    } catch (e) {
      handleClientError(
        e,
        { module: "stores:knowledgeStore", action: "updateItem" },
        "warn",
      );
      set({ error: String(e) });
    }
  },

  deleteItem: async (id) => {
    try {
      await knowledgeService.delete(id);
      set((state) => ({ items: state.items.filter((i) => i.id !== id) }));
    } catch (e) {
      handleClientError(
        e,
        { module: "stores:knowledgeStore", action: "deleteItem" },
        "warn",
      );
      set({ error: String(e) });
    }
  },

  view: {
    activeTab: "knowledge",
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

  notification: null,
  showNotification: (type, message) => set({ notification: { type, message } }),
  clearNotification: () => set({ notification: null }),
}));
