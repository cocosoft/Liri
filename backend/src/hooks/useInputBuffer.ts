/**
 * 输入缓冲区管理
 * 基于CC源码 cc_code/backend/hooks/useInputBuffer.ts 实现
 * 适配Backend的Zustand store架构
 */

export interface BufferEntry {
  text: string;
  cursorOffset: number;
  pastedContents: Record<number, { content: string; timestamp: number }>;
  timestamp: number;
}

export interface InputBufferState {
  entries: BufferEntry[];
  currentIndex: number;
  maxBufferSize: number;
  debounceMs: number;
}

export interface InputBufferActions {
  pushToBuffer: (
    text: string,
    cursorOffset: number,
    pastedContents?: Record<number, { content: string; timestamp: number }>,
  ) => void;
  undo: () => BufferEntry | undefined;
  canUndo: () => boolean;
  clearBuffer: () => void;
  reset: () => void;
}

export type InputBufferStore = InputBufferState & InputBufferActions;

let pendingPushTimeout: ReturnType<typeof setTimeout> | null = null;
let lastPushTime = 0;

export function createInputBufferStore(
  maxBufferSize: number = 100,
  debounceMs: number = 100,
): Omit<InputBufferStore, 'pushToBuffer' | 'undo' | 'canUndo' | 'clearBuffer' | 'reset'> & InputBufferActions {
  let state: InputBufferState = {
    entries: [],
    currentIndex: -1,
    maxBufferSize,
    debounceMs,
  };

  const listeners = new Set<() => void>();

  const notify = () => {
    listeners.forEach((listener) => listener());
  };

  const getState = () => state;

  const pushToBuffer = (
    text: string,
    cursorOffset: number,
    pastedContents: Record<number, { content: string; timestamp: number }> = {},
  ) => {
    const now = Date.now();

    if (pendingPushTimeout) {
      clearTimeout(pendingPushTimeout);
      pendingPushTimeout = null;
    }

    if (now - lastPushTime.current < debounceMs) {
      pendingPushTimeout = setTimeout(() => {
        pushToBuffer(text, cursorOffset, pastedContents);
      }, debounceMs);
      return;
    }

    lastPushTime = now;

    const currentState = getState();
    let newEntries = [...currentState.entries];

    if (currentState.currentIndex >= 0) {
      newEntries = newEntries.slice(0, currentState.currentIndex + 1);
    }

    const lastEntry = newEntries[newEntries.length - 1];
    if (lastEntry && lastEntry.text === text) {
      return;
    }

    const updatedBuffer = [
      ...newEntries,
      { text, cursorOffset, pastedContents, timestamp: now },
    ];

    if (updatedBuffer.length > maxBufferSize) {
      newEntries = updatedBuffer.slice(-maxBufferSize);
    } else {
      newEntries = updatedBuffer;
    }

    const newIndex = currentState.currentIndex >= 0 ? currentState.currentIndex + 1 : currentState.entries.length;

    state = {
      ...currentState,
      entries: newEntries,
      currentIndex: Math.min(newIndex, maxBufferSize - 1),
    };
    notify();
  };

  const undo = (): BufferEntry | undefined => {
    const currentState = getState();
    if (currentState.currentIndex < 0 || currentState.entries.length === 0) {
      return undefined;
    }

    state = {
      ...currentState,
      currentIndex: currentState.currentIndex - 1,
    };
    notify();
    return state.entries[currentState.currentIndex];
  };

  const canUndo = (): boolean => {
    return getState().currentIndex >= 0;
  };

  const clearBuffer = () => {
    state = {
      ...getState(),
      entries: [],
      currentIndex: -1,
    };
    notify();
  };

  const reset = () => {
    if (pendingPushTimeout) {
      clearTimeout(pendingPushTimeout);
      pendingPushTimeout = null;
    }
    state = {
      entries: [],
      currentIndex: -1,
      maxBufferSize,
      debounceMs,
    };
    notify();
  };

  return {
    get entries() { return getState().entries; },
    get currentIndex() { return getState().currentIndex; },
    get maxBufferSize() { return getState().maxBufferSize; },
    get debounceMs() { return getState().debounceMs; },
    pushToBuffer,
    undo,
    canUndo,
    clearBuffer,
    reset,
  };
}

let defaultInputBufferInstance: ReturnType<typeof createInputBufferStore> | null = null;

export function getDefaultInputBuffer(): ReturnType<typeof createInputBufferStore> {
  if (!defaultInputBufferInstance) {
    defaultInputBufferInstance = createInputBufferStore();
  }
  return defaultInputBufferInstance;
}
