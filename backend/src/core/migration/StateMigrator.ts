/**
 * 状态迁移工具
 * 用于将现有模块状态迁移到新的AppState中
 */

import { AppState, getDefaultAppState } from '../state/AppState.js';
import {
  getGlobalStore,
  initializeGlobalStore,
} from '../state/AppStateStore.js';

/**
 * 状态迁移选项
 */
export interface StateMigrationOptions {
  /** 是否保留现有状态 */
  preserveExisting?: boolean;
  /** 是否验证迁移结果 */
  validate?: boolean;
  /** 迁移后是否通知监听器 */
  notifyListeners?: boolean;
}

/**
 * 状态迁移器
 */
export class StateMigrator {
  /**
   * 初始化应用状态
   */
  static initializeAppState(initialState?: Partial<AppState>): void {
    const defaultState = getDefaultAppState();
    const mergedState = { ...defaultState, ...initialState };

    // 确保嵌套对象正确合并
    if (initialState?.mcp) {
      mergedState.mcp = { ...defaultState.mcp, ...initialState.mcp };
    }

    if (initialState?.plugins) {
      mergedState.plugins = {
        ...defaultState.plugins,
        ...initialState.plugins,
      };
    }

    if (initialState?.plugins?.installationStatus) {
      mergedState.plugins.installationStatus = {
        ...defaultState.plugins.installationStatus,
        ...initialState.plugins.installationStatus,
      };
    }

    initializeGlobalStore(mergedState as AppState);
  }

  /**
   * 迁移模块状态
   */
  static migrateModuleState(
    moduleName: string,
    state: Record<string, any>,
    options: StateMigrationOptions = {}
  ): boolean {
    try {
      const store = getGlobalStore();
      const currentState = store.getState();

      let newState = { ...currentState };

      // 根据模块名称进行不同的迁移逻辑
      switch (moduleName) {
        case 'mcp':
          newState.mcp = { ...newState.mcp, ...state };
          break;

        case 'plugins':
          newState.plugins = { ...newState.plugins, ...state };
          break;

        case 'tasks':
          newState.tasks = { ...newState.tasks, ...state };
          break;

        case 'settings':
          newState.settings = { ...newState.settings, ...state };
          break;

        case 'permissions':
          newState.toolPermissionContext = {
            ...newState.toolPermissionContext,
            ...state,
          };
          break;

        default:
          console.warn(`Unknown module: ${moduleName}`);
          return false;
      }

      // 验证状态
      if (options.validate && !this.validateState(newState)) {
        console.error('Invalid state after migration');
        return false;
      }

      // 更新状态
      store.replaceState(newState);
      return true;
    } catch (error) {
      console.error(`Error migrating ${moduleName} state:`, error);
      return false;
    }
  }

  /**
   * 批量迁移多个模块状态
   */
  static migrateMultipleStates(
    states: Array<{ moduleName: string; state: Record<string, any> }>,
    options: StateMigrationOptions = {}
  ): boolean {
    try {
      const store = getGlobalStore();
      const currentState = store.getState();
      let newState = { ...currentState };

      // 应用所有迁移
      for (const { moduleName, state } of states) {
        switch (moduleName) {
          case 'mcp':
            newState.mcp = { ...newState.mcp, ...state };
            break;

          case 'plugins':
            newState.plugins = { ...newState.plugins, ...state };
            break;

          case 'tasks':
            newState.tasks = { ...newState.tasks, ...state };
            break;

          case 'settings':
            newState.settings = { ...newState.settings, ...state };
            break;

          case 'permissions':
            newState.toolPermissionContext = {
              ...newState.toolPermissionContext,
              ...state,
            };
            break;
        }
      }

      // 验证状态
      if (options.validate && !this.validateState(newState)) {
        console.error('Invalid state after batch migration');
        return false;
      }

      // 更新状态
      store.replaceState(newState);
      return true;
    } catch (error) {
      console.error('Error in batch state migration:', error);
      return false;
    }
  }

  /**
   * 验证状态
   */
  private static validateState(state: AppState): boolean {
    // 基本验证
    if (!state) return false;
    if (!state.mcp) return false;
    if (!state.plugins) return false;
    if (!state.tasks) return false;
    if (!state.settings) return false;
    if (!state.toolPermissionContext) return false;

    // 验证必填字段
    if (typeof state.verbose !== 'boolean') return false;
    if (typeof state.expandedView !== 'string') return false;
    if (typeof state.isBriefOnly !== 'boolean') return false;
    if (typeof state.selectedIPAgentIndex !== 'number') return false;
    if (typeof state.coordinatorTaskIndex !== 'number') return false;
    if (typeof state.viewSelectionMode !== 'string') return false;

    return true;
  }

  /**
   * 导出状态
   */
  static exportState(): AppState {
    const store = getGlobalStore();
    return store.getState();
  }

  /**
   * 导入状态
   */
  static importState(
    state: AppState,
    options: StateMigrationOptions = {}
  ): boolean {
    try {
      const store = getGlobalStore();

      // 验证状态
      if (options.validate && !this.validateState(state)) {
        console.error('Invalid state to import');
        return false;
      }

      // 更新状态
      store.replaceState(state);
      return true;
    } catch (error) {
      console.error('Error importing state:', error);
      return false;
    }
  }

  /**
   * 重置状态到默认值
   */
  static resetState(): void {
    const defaultState = getDefaultAppState();
    const store = getGlobalStore();
    store.replaceState(defaultState);
  }
}

/**
 * 便捷函数：初始化应用状态
 */
export function initializeAppState(initialState?: Partial<AppState>): void {
  StateMigrator.initializeAppState(initialState);
}

/**
 * 便捷函数：迁移模块状态
 */
export function migrateModuleState(
  moduleName: string,
  state: Record<string, any>,
  options?: StateMigrationOptions
): boolean {
  return StateMigrator.migrateModuleState(moduleName, state, options);
}

/**
 * 便捷函数：批量迁移多个模块状态
 */
export function migrateMultipleStates(
  states: Array<{ moduleName: string; state: Record<string, any> }>,
  options?: StateMigrationOptions
): boolean {
  return StateMigrator.migrateMultipleStates(states, options);
}

/**
 * 便捷函数：导出状态
 */
export function exportState(): AppState {
  return StateMigrator.exportState();
}

/**
 * 便捷函数：导入状态
 */
export function importState(
  state: AppState,
  options?: StateMigrationOptions
): boolean {
  return StateMigrator.importState(state, options);
}

/**
 * 便捷函数：重置状态
 */
export function resetState(): void {
  StateMigrator.resetState();
}
