/**
 * 全局状态管理器
 *
 * 提供集中式状态管理，支持状态持久化和状态变更通知机制
 */

type Listener = () => void;
type OnChange<T> = (args: { newState: T; oldState: T }) => void;

export interface Store<T> {
  getState: () => T;
  setState: (updater: (prev: T) => T) => void;
  subscribe: (listener: Listener) => () => void;
  getSnapshot: () => T;
}

class StateManager {
  private stores: Map<string, Store<any>> = new Map();
  private persistenceAdapter: PersistenceAdapter | null = null;

  /**
   * 设置持久化适配器
   * @param adapter 持久化适配器
   */
  setPersistenceAdapter(adapter: PersistenceAdapter): void {
    this.persistenceAdapter = adapter;
  }

  /**
   * 创建状态存储
   * @param name 存储名称
   * @param initialState 初始状态
   * @param onChange 状态变更回调
   */
  createStore<T>(
    name: string,
    initialState: T,
    onChange?: OnChange<T>
  ): Store<T> {
    if (this.stores.has(name)) {
      return this.stores.get(name) as Store<T>;
    }

    const persistedState = this.persistenceAdapter?.load(name);
    const state = persistedState !== undefined ? persistedState : initialState;

    let currentState = state;
    const listeners = new Set<Listener>();

    const store: Store<T> = {
      getState: () => currentState,

      setState: (updater: (prev: T) => T) => {
        const prev = currentState;
        const next = updater(prev);

        if (Object.is(next, prev)) return;

        currentState = next;
        onChange?.({ newState: next, oldState: prev });

        this.persistenceAdapter?.save(name, next);

        for (const listener of listeners) {
          listener();
        }
      },

      subscribe: (listener: Listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },

      getSnapshot: () => {
        return currentState;
      },
    };

    this.stores.set(name, store);
    return store;
  }

  /**
   * 获取状态存储
   * @param name 存储名称
   */
  getStore<T>(name: string): Store<T> | undefined {
    return this.stores.get(name) as Store<T> | undefined;
  }

  /**
   * 检查存储是否存在
   * @param name 存储名称
   */
  hasStore(name: string): boolean {
    return this.stores.has(name);
  }

  /**
   * 删除状态存储
   * @param name 存储名称
   */
  deleteStore(name: string): boolean {
    return this.stores.delete(name);
  }

  /**
   * 获取所有存储名称
   */
  getStoreNames(): string[] {
    return Array.from(this.stores.keys());
  }

  /**
   * 清除所有状态
   */
  clearAll(): void {
    this.stores.clear();
    this.persistenceAdapter?.clear();
  }

  /**
   * 导出所有状态
   */
  exportState(): Record<string, any> {
    const state: Record<string, any> = {};
    for (const [name, store] of this.stores.entries()) {
      state[name] = store.getSnapshot();
    }
    return state;
  }

  /**
   * 导入状态
   * @param state 状态对象
   */
  importState(state: Record<string, any>): void {
    for (const [name, value] of Object.entries(state)) {
      const store = this.stores.get(name);
      if (store) {
        store.setState(() => value);
      }
    }
  }
}

export interface PersistenceAdapter {
  save(key: string, state: any): void;
  load(key: string): any | undefined;
  clear(): void;
}

export interface StateSelector<T, R> {
  (state: T): R;
}

export interface DerivedState<T, R> {
  get: () => R;
  subscribe: (listener: Listener) => () => void;
}

class GlobalStateManager {
  private static instance: GlobalStateManager;
  private stateManager: StateManager;
  private derivedStates: Map<string, { unsubscribe: () => void }> = new Map();

  private constructor() {
    this.stateManager = new StateManager();
  }

  static getInstance(): GlobalStateManager {
    if (!GlobalStateManager.instance) {
      GlobalStateManager.instance = new GlobalStateManager();
    }
    return GlobalStateManager.instance;
  }

  /**
   * 创建命名空间状态存储
   * @param namespace 命名空间
   * @param initialState 初始状态
   */
  createNamespacedStore<T>(namespace: string, initialState: T): Store<T> {
    return this.stateManager.createStore(namespace, initialState);
  }

  /**
   * 获取命名空间状态存储
   * @param namespace 命名空间
   */
  getNamespacedStore<T>(namespace: string): Store<T> | undefined {
    return this.stateManager.getStore<T>(namespace);
  }

  /**
   * 创建派生状态
   * @param source 源存储
   * @param selector 选择器函数
   */
  createDerivedState<T, R>(
    source: Store<T>,
    selector: StateSelector<T, R>
  ): DerivedState<T, R> {
    let currentValue = selector(source.getState());

    const subscribe = (listener: Listener) => {
      return source.subscribe(() => {
        const newValue = selector(source.getState());
        if (newValue !== currentValue) {
          currentValue = newValue;
          listener();
        }
      });
    };

    return {
      get: () => selector(source.getState()),
      subscribe,
    };
  }

  /**
   * 设置持久化适配器
   * @param adapter 持久化适配器
   */
  setPersistenceAdapter(adapter: PersistenceAdapter): void {
    this.stateManager.setPersistenceAdapter(adapter);
  }

  /**
   * 导出所有状态
   */
  exportState(): Record<string, any> {
    return this.stateManager.exportState();
  }

  /**
   * 导入状态
   * @param state 状态对象
   */
  importState(state: Record<string, any>): void {
    this.stateManager.importState(state);
  }

  /**
   * 清除所有状态
   */
  clearAll(): void {
    this.stateManager.clearAll();
    for (const { unsubscribe } of this.derivedStates.values()) {
      unsubscribe();
    }
    this.derivedStates.clear();
  }
}

export const globalStateManager = GlobalStateManager.getInstance();

export { StateManager };
export default globalStateManager;
