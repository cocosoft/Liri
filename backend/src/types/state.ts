/**
 * 状态管理类型定义
 */

export interface AppState {
  // 应用状态
  app: {
    isLoading: boolean;
    error: string | null;
    version: string;
  };

  // 用户状态
  user: {
    isAuthenticated: boolean;
    userId: string | null;
    preferences: UserPreferences;
  };

  // 会话状态
  session: {
    currentSessionId: string | null;
    sessions: Session[];
  };

  // 插件状态
  plugins: {
    loaded: boolean;
    plugins: any[];
  };

  // 工具状态
  tools: {
    enabled: string[];
    disabled: string[];
  };

  // 其他状态
  [key: string]: any;
}

export interface UserPreferences {
  theme: 'light' | 'dark' | 'system';
  language: string;
  autoSave: boolean;
  [key: string]: any;
}

export interface Session {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  messages: any[];
  [key: string]: any;
}

export interface StateSelector<T> {
  (state: AppState): T;
}

export interface StateListener {
  (state: AppState): void;
}

export interface StateMutator {
  (state: AppState): AppState;
}

export interface Store {
  getState(): AppState;
  setState(newState: AppState | StateMutator): void;
  subscribe(listener: StateListener): () => void;
  select<T>(selector: StateSelector<T>): T;
  dispatch(action: any): void;
}
