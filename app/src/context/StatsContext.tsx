import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { ErrorCodes } from '@modules/error';
import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
  useEffect,
} from 'react';

export interface StatsData {
  tokenCount: number;
  messageCount: number;
  toolCallCount: number;
  sessionDurationMs: number;
  apiCallCount: number;
  errorCount: number;
}

export interface StatsContextType {
  stats: StatsData;
  incrementTokenCount: (count: number) => void;
  incrementMessageCount: () => void;
  incrementToolCallCount: () => void;
  incrementApiCallCount: () => void;
  incrementErrorCount: () => void;
  updateSessionDuration: (durationMs: number) => void;
  resetStats: () => void;
}

const StatsContext = createContext<StatsContextType | undefined>(undefined);

export function StatsProvider({ children }: { children: ReactNode }) {
  const [stats, setStats] = useState<StatsData>({
    tokenCount: 0,
    messageCount: 0,
    toolCallCount: 0,
    sessionDurationMs: 0,
    apiCallCount: 0,
    errorCount: 0,
  });

  const incrementTokenCount = useCallback((count: number) => {
    setStats((prev) => ({
      ...prev,
      tokenCount: prev.tokenCount + count,
    }));
  }, []);

  const incrementMessageCount = useCallback(() => {
    setStats((prev) => ({
      ...prev,
      messageCount: prev.messageCount + 1,
    }));
  }, []);

  const incrementToolCallCount = useCallback(() => {
    setStats((prev) => ({
      ...prev,
      toolCallCount: prev.toolCallCount + 1,
    }));
  }, []);

  const incrementApiCallCount = useCallback(() => {
    setStats((prev) => ({
      ...prev,
      apiCallCount: prev.apiCallCount + 1,
    }));
  }, []);

  const incrementErrorCount = useCallback(() => {
    setStats((prev) => ({
      ...prev,
      errorCount: prev.errorCount + 1,
    }));
  }, []);

  const updateSessionDuration = useCallback((durationMs: number) => {
    setStats((prev) => ({
      ...prev,
      sessionDurationMs: durationMs,
    }));
  }, []);

  const resetStats = useCallback(() => {
    setStats({
      tokenCount: 0,
      messageCount: 0,
      toolCallCount: 0,
      sessionDurationMs: 0,
      apiCallCount: 0,
      errorCount: 0,
    });
  }, []);

  return (
    <StatsContext.Provider
      value={{
        stats,
        incrementTokenCount,
        incrementMessageCount,
        incrementToolCallCount,
        incrementApiCallCount,
        incrementErrorCount,
        updateSessionDuration,
        resetStats,
      }}
    >
      {children}
    </StatsContext.Provider>
  );
}

export function useStats() {
  const context = useContext(StatsContext);
  if (!context) {
    throw new AppError(
      ErrorCodes.INTERNAL.message,
      ErrorCategory.VALIDATION,
      ErrorSeverity.LOW,
      'CONTEXT_NOT_AVAILABLE',
      { hook: 'useStats', provider: 'StatsProvider' }
    );
  }
  return context;
}
