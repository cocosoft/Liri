/**
 * useApp Hook
 * 用于管理应用状态
 */

import { useState, useCallback } from 'react';

export interface AppState {
  isLoading: boolean;
  isError: boolean;
  errorMessage: string;
}

export interface UseAppReturn {
  state: AppState;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

export const useApp = (initialState?: Partial<AppState>): UseAppReturn => {
  const [state, setState] = useState<AppState>({
    isLoading: false,
    isError: false,
    errorMessage: '',
    ...initialState,
  });

  const setLoading = useCallback((loading: boolean) => {
    setState((prev) => ({
      ...prev,
      isLoading: loading,
    }));
  }, []);

  const setError = useCallback((error: string | null) => {
    setState((prev) => ({
      ...prev,
      isError: !!error,
      errorMessage: error || '',
    }));
  }, []);

  const reset = useCallback(() => {
    setState({
      isLoading: false,
      isError: false,
      errorMessage: '',
    });
  }, []);

  return {
    state,
    setLoading,
    setError,
    reset,
  };
};
