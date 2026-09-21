/**
 * 存储工厂类
 * 用于创建统一存储实例
 */

import type { UnifiedSessionStorage } from './UnifiedStorage.js';
import { StorageConfig, StorageType } from './UnifiedStorage.js';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { getLogger } from '@modules/monitoring';
// 内置存储实现（循环导入消除，2026-09-20）：**单一注册中枢** —— 工厂是唯一知道全部实现的
// 模块，故由它 import 实现并注册；实现模块**不再反向 import 本模块**。此前每个实现模块顶层都
// 调用 `registerStorage()`（本模块的函数）⇒ 与本模块形成循环导入，单独加载时触发 TDZ
//（`Cannot access 'storageRegistry' before initialization`），并让相关测试无法单文件运行。
import { MemoryUnifiedStorage } from './MemoryUnifiedStorage.js';
import { FileSystemUnifiedStorage } from './FileSystemUnifiedStorage.js';
const logger = getLogger('session\storage\StorageFactory');

/**
 * 存储实例注册表
 */
const storageRegistry = new Map<
  StorageType,
  new (config: StorageConfig) => UnifiedSessionStorage
>();

/**
 * 注册存储实现
 * @param type 存储类型
 * @param storageClass 存储类
 */
export function registerStorage(
  type: StorageType,
  storageClass: new (config: StorageConfig) => UnifiedSessionStorage
): void {
  storageRegistry.set(type, storageClass);
}

/**
 * 内置实现注册（**调用时惰性注册**，2026-09-20）。
 *
 * 不在模块求值期调用 `registerStorage(...)` —— 实现模块（经 `@modules/*` barrel）与本模块之间
 * 存在回边，求值期访问实现绑定会触发 TDZ
 *（实测 `ReferenceError: Cannot access 'FileSystemUnifiedStorage' before initialization`）。
 * 首次使用工厂时再注册，此时所有模块均已完成求值，行为与"import 工厂即可 createStorage"一致。
 */
let builtinsRegistered = false;
function ensureBuiltinsRegistered(): void {
  if (builtinsRegistered) return;
  builtinsRegistered = true;
  registerStorage(StorageType.MEMORY, MemoryUnifiedStorage);
  registerStorage(StorageType.FILESYSTEM, FileSystemUnifiedStorage);
}

/**
 * 存储工厂类
 */
export class StorageFactory {
  private static defaultConfig: StorageConfig = {
    type: StorageType.MEMORY,
    enableCompression: false,
  };

  /**
   * 创建存储实例
   * @param config 存储配置
   * @returns 存储实例
   */
  static createStorage(
    config: StorageConfig = this.defaultConfig
  ): UnifiedSessionStorage {
    ensureBuiltinsRegistered();
    const StorageClass = storageRegistry.get(config.type);

    if (!StorageClass) {
      throw new AppError(
        `Storage type '${config.type}' is not registered. Available types: ${Array.from(storageRegistry.keys()).join(', ')}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    return new StorageClass(config);
  }

  /**
   * 创建内存存储
   * @returns 内存存储实例
   */
  static createMemoryStorage(): UnifiedSessionStorage {
    return this.createStorage({
      type: StorageType.MEMORY,
      enableCompression: false,
    });
  }

  /**
   * 创建文件系统存储
   * @param basePath 基础路径
   * @returns 文件系统存储实例
   */
  static createFileSystemStorage(basePath: string): UnifiedSessionStorage {
    return this.createStorage({
      type: StorageType.FILESYSTEM,
      basePath,
      enableCompression: true,
      maxFileSize: 50 * 1024 * 1024,
    });
  }

  /**
   * 获取已注册的存储类型
   * @returns 存储类型列表
   */
  static getRegisteredTypes(): StorageType[] {
    ensureBuiltinsRegistered();
    return Array.from(storageRegistry.keys());
  }

  /**
   * 检查存储类型是否已注册
   * @param type 存储类型
   * @returns 是否已注册
   */
  static isRegistered(type: StorageType): boolean {
    ensureBuiltinsRegistered();
    return storageRegistry.has(type);
  }

  /**
   * 获取默认存储类型
   * @returns 默认存储类型
   */
  static getDefaultType(): StorageType {
    return StorageType.MEMORY;
  }
}

/**
 * 创建默认存储工厂函数
 */
export function createStorageFactory(): StorageFactory {
  return new StorageFactory();
}
