/**
 * 状态管理Store
 * 负责管理应用状态，支持订阅和选择器
 */

import type {
  AppState,
  StateListener,
  StateMutator,
  StateSelector,
} from '../types/state';

// 默认状态
const defaultState: AppState = {
  app: {
    isLoading: false,
    error: null,
    version: '1.0.0',
  },
  user: {
    isAuthenticated: false,
    userId: null,
    preferences: {
      theme: 'system',
      language: 'zh-CN',
      autoSave: true,
    },
  },
  session: {
    currentSessionId: null,
    sessions: [],
  },
  plugins: {
    loaded: false,
    plugins: [],
  },
  tools: {
    enabled: [],
    disabled: [],
  },
};

export class Store {
  private state: AppState;
  private listeners: StateListener[];

  constructor(initialState: AppState = defaultState) {
    this.state = initialState;
    this.listeners = [];
  }

  /**
   * 获取当前状态
   * @returns 当前状态
   */
  getState(): AppState {
    return this.state;
  }

  /**
   * 设置状态
   * @param newState 新状态或状态变更函数
   */
  setState(newState: AppState | StateMutator): void {
    if (typeof newState === 'function') {
      this.state = newState(this.state);
    } else {
      this.state = newState;
    }
    this.notifyListeners();
  }

  /**
   * 订阅状态变更
   * @param listener 状态变更监听器
   * @returns 取消订阅函数
   */
  subscribe(listener: StateListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /**
   * 使用选择器获取状态的一部分
   * @param selector 状态选择器
   * @returns 选择的状态部分
   */
  select<T>(selector: StateSelector<T>): T {
    return selector(this.state);
  }

  /**
   * 分发action
   * @param action action对象
   */
  dispatch(action: any): void {
    // 这里可以添加中间件逻辑
    // 目前直接更新状态
    this.setState((prevState) => ({
      ...prevState,
      ...this.reducer(prevState, action),
    }));
  }

  /**
   * 状态 reducer
   * @param state 当前状态
   * @param action action对象
   * @returns 新状态
   */
  private reducer(state: AppState, action: any): Partial<AppState> {
    switch (action.type) {
      case 'SET_LOADING':
        return {
          app: {
            ...state.app,
            isLoading: action.payload,
          },
        };
      case 'SET_ERROR':
        return {
          app: {
            ...state.app,
            error: action.payload,
          },
        };
      case 'SET_USER':
        return {
          user: {
            ...state.user,
            ...action.payload,
          },
        };
      case 'SET_CURRENT_SESSION':
        return {
          session: {
            ...state.session,
            currentSessionId: action.payload,
          },
        };
      case 'ADD_SESSION':
        return {
          session: {
            ...state.session,
            sessions: [...state.session.sessions, action.payload],
          },
        };
      case 'SET_PLUGINS':
        return {
          plugins: {
            ...state.plugins,
            plugins: action.payload,
            loaded: true,
          },
        };
      default:
        return {};
    }
  }

  /**
   * 通知所有监听器
   */
  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  /**
   * 重置状态
   */
  resetState(): void {
    this.setState(defaultState);
  }

  /**
   * 批量更新状态
   * @param updates 状态更新对象
   */
  batchUpdate(updates: Partial<AppState>): void {
    this.setState((prevState) => ({
      ...prevState,
      ...updates,
    }));
  }
}

// 导出单例
export const store = new Store();
