/**
 * 经过时间追踪
 * 基于CC源码 cc_code/backend/hooks/useElapsedTime.ts 实现
 */

export interface ElapsedTimeState {
  startTime: number;
  isRunning: boolean;
  pausedMs: number;
  endTime?: number;
  updateIntervalMs: number;
}

export interface ElapsedTimeActions {
  start: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  reset: () => void;
  getElapsed: () => number;
  getFormatted: () => string;
}

export type ElapsedTimeStore = ElapsedTimeState & ElapsedTimeActions;

let elapsedTimeInstance: ReturnType<typeof createElapsedTimeStore> | null = null;

function formatDuration(ms: number): string {
  if (ms < 0) {
    return '0s';
  }

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

export function createElapsedTimeStore(
  defaultUpdateInterval: number = 1000,
): Omit<ElapsedTimeStore, 'start' | 'pause' | 'resume' | 'stop' | 'reset' | 'getElapsed' | 'getFormatted'> & ElapsedTimeActions {
  let state: ElapsedTimeState = {
    startTime: 0,
    isRunning: false,
    pausedMs: 0,
    endTime: undefined,
    updateIntervalMs: defaultUpdateInterval,
  };

  let pauseStartTime: number | null = null;
  let intervalId: ReturnType<typeof setInterval> | null = null;
  const listeners = new Set<() => void>();

  const notify = () => {
    listeners.forEach((listener) => listener());
  };

  const getState = () => state;

  const start = () => {
    const now = Date.now();
    state = {
      ...getState(),
      startTime: now,
      isRunning: true,
      pausedMs: 0,
      endTime: undefined,
    };
    notify();
  };

  const pause = () => {
    if (!getState().isRunning) {
      return;
    }
    pauseStartTime = Date.now();
    state = {
      ...getState(),
      isRunning: false,
    };
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    notify();
  };

  const resume = () => {
    if (getState().isRunning) {
      return;
    }
    if (pauseStartTime !== null) {
      const pauseDuration = Date.now() - pauseStartTime;
      state = {
        ...getState(),
        isRunning: true,
        pausedMs: getState().pausedMs + pauseDuration,
      };
      pauseStartTime = null;
    } else {
      state = {
        ...getState(),
        isRunning: true,
      };
    }
    notify();
  };

  const stop = () => {
    const now = Date.now();
    state = {
      ...getState(),
      isRunning: false,
      endTime: now,
    };
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    notify();
  };

  const reset = () => {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    pauseStartTime = null;
    state = {
      startTime: 0,
      isRunning: false,
      pausedMs: 0,
      endTime: undefined,
      updateIntervalMs: defaultUpdateInterval,
    };
    notify();
  };

  const getElapsed = (): number => {
    const currentState = getState();
    const endTs = currentState.endTime ?? Date.now();
    if (currentState.startTime === 0) {
      return 0;
    }
    return Math.max(0, endTs - currentState.startTime - currentState.pausedMs);
  };

  const getFormatted = (): string => {
    return formatDuration(getElapsed());
  };

  return {
    get startTime() { return getState().startTime; },
    get isRunning() { return getState().isRunning; },
    get pausedMs() { return getState().pausedMs; },
    get endTime() { return getState().endTime; },
    get updateIntervalMs() { return getState().updateIntervalMs; },
    start,
    pause,
    resume,
    stop,
    reset,
    getElapsed,
    getFormatted,
  };
}

export function getDefaultElapsedTime(): ReturnType<typeof createElapsedTimeStore> {
  if (!elapsedTimeInstance) {
    elapsedTimeInstance = createElapsedTimeStore();
  }
  return elapsedTimeInstance;
}
