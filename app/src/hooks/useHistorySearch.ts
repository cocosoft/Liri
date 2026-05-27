/**
 * 历史搜索
 * 基于CC源码 cc_code/backend/hooks/useHistorySearch.ts 实现
 * 适配Backend架构的版本
 */

export interface HistoryEntry {
  id: string;
  text: string;
  timestamp: number;
  pastedContents?: Record<number, { content: string; timestamp: number }>;
}

export interface HistorySearchState {
  query: string;
  isSearching: boolean;
  matchIndex: number;
  matches: HistoryEntry[];
  failedMatch: boolean;
  originalInput: string;
  originalCursorOffset: number;
}

export interface HistorySearchActions {
  startSearch: (initialQuery?: string) => void;
  stopSearch: () => void;
  setQuery: (query: string) => void;
  nextMatch: () => void;
  prevMatch: () => void;
  acceptMatch: () => HistoryEntry | undefined;
  reset: () => void;
}

export type HistorySearchStore = HistorySearchState & HistorySearchActions;

let historySearchInstance: ReturnType<typeof createHistorySearchStore> | null =
  null;

export function createHistorySearchStore(): Omit<
  HistorySearchStore,
  | 'startSearch'
  | 'stopSearch'
  | 'setQuery'
  | 'nextMatch'
  | 'prevMatch'
  | 'acceptMatch'
  | 'reset'
> &
  HistorySearchActions {
  let state: HistorySearchState = {
    query: '',
    isSearching: false,
    matchIndex: -1,
    matches: [],
    failedMatch: false,
    originalInput: '',
    originalCursorOffset: 0,
  };

  const listeners = new Set<() => void>();

  const notify = () => {
    listeners.forEach((listener) => listener());
  };

  const getState = () => state;

  const startSearch = (initialQuery?: string) => {
    state = {
      ...getState(),
      query: initialQuery ?? '',
      isSearching: true,
      matchIndex: -1,
      matches: [],
      failedMatch: false,
    };
    notify();
  };

  const stopSearch = () => {
    state = {
      ...getState(),
      isSearching: false,
      query: '',
      matchIndex: -1,
      matches: [],
    };
    notify();
  };

  const setQuery = (query: string) => {
    state = {
      ...getState(),
      query,
      matchIndex: -1,
      matches: [],
      failedMatch: false,
    };
    notify();
  };

  const nextMatch = () => {
    const currentState = getState();
    if (currentState.matches.length === 0) {
      return;
    }
    const newIndex =
      (currentState.matchIndex + 1) % currentState.matches.length;
    state = {
      ...currentState,
      matchIndex: newIndex,
    };
    notify();
  };

  const prevMatch = () => {
    const currentState = getState();
    if (currentState.matches.length === 0) {
      return;
    }
    const newIndex =
      currentState.matchIndex <= 0
        ? currentState.matches.length - 1
        : currentState.matchIndex - 1;
    state = {
      ...currentState,
      matchIndex: newIndex,
    };
    notify();
  };

  const acceptMatch = (): HistoryEntry | undefined => {
    const currentState = getState();
    if (
      currentState.matchIndex >= 0 &&
      currentState.matchIndex < currentState.matches.length
    ) {
      return currentState.matches[currentState.matchIndex];
    }
    return undefined;
  };

  const reset = () => {
    state = {
      query: '',
      isSearching: false,
      matchIndex: -1,
      matches: [],
      failedMatch: false,
      originalInput: '',
      originalCursorOffset: 0,
    };
    notify();
  };

  return {
    get query() {
      return getState().query;
    },
    get isSearching() {
      return getState().isSearching;
    },
    get matchIndex() {
      return getState().matchIndex;
    },
    get matches() {
      return getState().matches;
    },
    get failedMatch() {
      return getState().failedMatch;
    },
    get originalInput() {
      return getState().originalInput;
    },
    get originalCursorOffset() {
      return getState().originalCursorOffset;
    },
    startSearch,
    stopSearch,
    setQuery,
    nextMatch,
    prevMatch,
    acceptMatch,
    reset,
  };
}

export function getDefaultHistorySearch(): ReturnType<
  typeof createHistorySearchStore
> {
  if (!historySearchInstance) {
    historySearchInstance = createHistorySearchStore();
  }
  return historySearchInstance;
}
