import { create } from 'zustand';
import { translateService } from '../services/translateService';
import type { TranslateResult, TranslateHistoryRecord } from '../services/translateService';

/** 模块级 AbortController，用于取消流式翻译 */
let abortController: AbortController | null = null;

interface TranslateStore {
  // 翻译状态
  sourceText: string;
  sourceLang: string;
  targetLang: string;
  translatedText: string;
  isTranslating: boolean;
  isStreaming: boolean;
  error: string | null;
  canFallback: boolean;
  lastResult: TranslateResult | null;

  // 历史状态
  history: TranslateHistoryRecord[];
  historyTotal: number;
  historyPage: number;
  isLoadingHistory: boolean;
  searchQuery: string;

  // 动作
  setSourceText: (text: string) => void;
  setSourceLang: (lang: string) => void;
  setTargetLang: (lang: string) => void;
  swapLanguages: () => void;
  translate: () => void;
  abortTranslation: () => void;
  fallbackToNonStream: () => Promise<void>;
  clearResult: () => void;
  loadHistory: (page?: number) => Promise<void>;
  setSearchQuery: (query: string) => void;
  toggleStar: (id: string) => Promise<void>;
  deleteHistory: (ids: string[]) => Promise<void>;
}

export const useTranslateStore = create<TranslateStore>()((set, get) => ({
  sourceText: '',
  sourceLang: 'auto',
  targetLang: 'en',
  translatedText: '',
  isTranslating: false,
  isStreaming: false,
  error: null,
  canFallback: false,
  lastResult: null,
  history: [],
  historyTotal: 0,
  historyPage: 1,
  isLoadingHistory: false,
  searchQuery: '',

  setSourceText: (text) => set({ sourceText: text }),

  setSourceLang: (lang) => set({ sourceLang: lang }),

  setTargetLang: (lang) => set({ targetLang: lang }),

  swapLanguages: () => {
    const { sourceLang, targetLang } = get();
    if (sourceLang === 'auto') return;
    set({ sourceLang: targetLang, targetLang: sourceLang });
  },

  /**
   * 执行流式翻译
   *
   * 调用 translateService.streamTranslate() 逐 token 接收结果，
   * 实时更新 translatedText，完成后设置 lastResult。
   */
  translate: () => {
    const { sourceText, sourceLang, targetLang } = get();
    if (!sourceText.trim()) return;

    // 取消之前的流
    if (abortController) {
      abortController.abort();
    }

    set({ isTranslating: true, isStreaming: true, error: null, canFallback: false, translatedText: '' });

    abortController = translateService.streamTranslate(
      { text: sourceText, sourceLang, targetLang },
      (token) => {
        set((state) => ({ translatedText: state.translatedText + token }));
      },
      (result) => {
        set({
          translatedText: result.translatedText,
          lastResult: result,
          sourceLang: result.sourceLang,
          isTranslating: false,
          isStreaming: false,
        });
        abortController = null;
      },
      (error, canFallback) => {
        set({
          error,
          canFallback,
          isTranslating: false,
          isStreaming: false,
        });
        abortController = null;
      },
    );
  },

  /** 取消当前流式翻译 */
  abortTranslation: () => {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    set({ isTranslating: false, isStreaming: false, canFallback: false });
  },

  /** 降级到非流式翻译 */
  fallbackToNonStream: async () => {
    const { sourceText, sourceLang, targetLang } = get();
    if (!sourceText.trim()) return;

    set({ isTranslating: true, isStreaming: false, error: null, canFallback: false });

    try {
      const result = await translateService.translate({
        text: sourceText,
        sourceLang,
        targetLang,
      });
      set({
        translatedText: result.translatedText,
        lastResult: result,
        sourceLang: result.sourceLang,
        isTranslating: false,
      });
    } catch (err) {
      set({
        error: String(err),
        isTranslating: false,
      });
    }
  },

  clearResult: () => {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    set({
      sourceText: '',
      translatedText: '',
      error: null,
      lastResult: null,
      isTranslating: false,
      isStreaming: false,
    });
  },

  loadHistory: async (page = 1) => {
    set({ isLoadingHistory: true });
    try {
      const { searchQuery } = get();
      const result = await translateService.getHistory({
        page,
        pageSize: 20,
        search: searchQuery || undefined,
      });
      set({
        history: result.records,
        historyTotal: result.total,
        historyPage: result.page,
        isLoadingHistory: false,
      });
    } catch {
      set({ isLoadingHistory: false });
    }
  },

  setSearchQuery: (query) => {
    set({ searchQuery: query, historyPage: 1 });
    // 自动重新搜索
    get().loadHistory(1);
  },

  toggleStar: async (id) => {
    try {
      const starred = await translateService.toggleStar(id);
      set((state) => ({
        history: state.history.map((h) =>
          h.id === id ? { ...h, starred } : h
        ),
      }));
    } catch {
      // 非关键操作，静默失败
    }
  },

  deleteHistory: async (ids) => {
    try {
      await translateService.deleteByIds(ids);
      const { loadHistory } = get();
      loadHistory(1);
    } catch {
      // 非关键操作，静默失败
    }
  },
}));