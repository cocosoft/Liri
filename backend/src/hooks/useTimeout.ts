/**
 * 超时管理
 * 基于CC源码 cc_code/backend/hooks/useTimeout.ts 实现
 */

export interface TimeoutState {
  isElapsed: boolean;
  delay: number;
  resetTrigger: number;
}

export interface TimeoutActions {
  reset: (newDelay?: number) => void;
  setElapsed: (elapsed: boolean) => void;
}

export type TimeoutStore = TimeoutState & TimeoutActions;

let timeoutInstance: ReturnType<typeof createTimeoutStore> | null = null;
let timeoutId: ReturnType<typeof setTimeout> | null = null;

export function createTimeoutStore(
  defaultDelay: number = 1000,
): Omit<TimeoutStore, 'reset' | 'setElapsed'> & TimeoutActions {
  let state: TimeoutState = {
    isElapsed: false,
    delay: defaultDelay,
    resetTrigger: 0,
  };

  const listeners = new Set<() => void>();

  const notify = () => {
    listeners.forEach((listener) => listener());
  };

  const getState = () => state;

  const clearTimer = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  const startTimer = (delay: number) => {
    clearTimer();
    state = {
      ...getState(),
      isElapsed: false,
    };
    notify();
    timeoutId = setTimeout(() => {
      state = {
        ...getState(),
        isElapsed: true,
      };
      notify();
    }, delay);
  };

  const reset = (newDelay?: number) => {
    const delayToUse = newDelay ?? getState().delay;
    if (newDelay !== undefined) {
      state = {
        ...getState(),
        delay: newDelay,
        resetTrigger: getState().resetTrigger + 1,
      };
    } else {
      state = {
        ...getState(),
        resetTrigger: getState().resetTrigger + 1,
      };
    }
    startTimer(delayToUse);
  };

  const setElapsed = (elapsed: boolean) => {
    state = {
      ...getState(),
      isElapsed: elapsed,
    };
    notify();
  };

  startTimer(defaultDelay);

  return {
    get isElapsed() { return getState().isElapsed; },
    get delay() { return getState().delay; },
    get resetTrigger() { return getState().resetTrigger; },
    reset,
    setElapsed,
  };
}

export function getDefaultTimeout(): ReturnType<typeof createTimeoutStore> {
  if (!timeoutInstance) {
    timeoutInstance = createTimeoutStore();
  }
  return timeoutInstance;
}
