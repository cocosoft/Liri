/**
 * 用户自定义绑定加载
 * 加载用户定义的按键绑定配置（来自 ~/.pyapp/keybindings.json）
 */
import { readFileSync, existsSync, watch } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { resolvePyappHome } from '@modules/core';
import type {
  KeybindingsLoadResult,
  ParsedBinding,
  KeybindingWarning,
} from './types.js';
import { validateKeybindings } from './schema.js';
import { parseChord, formatChord } from './parser.js';
import type { KeybindingContextName } from './types.js';
import { getLogger } from '@modules/monitoring';
const logger = getLogger('keybindings:loadUserBindings');

/**
 * 用户绑定文件路径
 */
export const USER_BINDINGS_PATH = join(resolvePyappHome(), 'keybindings.json');

/**
 * 用户绑定文件是否存在的标志
 */
let userBindingsFileExists = false;

/**
 * 文件观察器引用
 */
let fileWatcher: ReturnType<typeof watch> | null = null;

/**
 * 变更监听器集合
 */
const changeListeners = new Set<() => void>();

/**
 * 检查用户绑定文件是否存在
 */
export function isKeybindingCustomizationEnabled(): boolean {
  return existsSync(USER_BINDINGS_PATH);
}

/**
 * 同步加载用户绑定
 */
export function loadUserBindingsSync(): KeybindingsLoadResult {
  const result: KeybindingsLoadResult = {
    bindings: [],
    warnings: [],
    hasErrors: false,
  };

  try {
    // 检查文件是否存在
    if (!existsSync(USER_BINDINGS_PATH)) {
      userBindingsFileExists = false;
      result.warnings.push({
        type: 'warning',
        message: '用户绑定文件不存在，使用默认绑定',
      });
      return result;
    }

    userBindingsFileExists = true;

    // 读取文件内容
    const fileContent = readFileSync(USER_BINDINGS_PATH, 'utf-8');

    if (!fileContent.trim()) {
      result.warnings.push({
        type: 'warning',
        message: '用户绑定文件为空',
      });
      return result;
    }

    // 解析JSON
    let userConfig: unknown;
    try {
      userConfig = JSON.parse(fileContent);
    } catch (jsonError) {
      result.warnings.push({
        type: 'error',
        message: `JSON解析错误: ${jsonError instanceof Error ? jsonError.message : String(jsonError)}`,
      });
      result.hasErrors = true;
      return result;
    }

    // 验证配置
    const validationResult = validateKeybindings(userConfig);
    if (!validationResult.success) {
      result.warnings.push({
        type: 'error',
        message: '配置验证失败',
        context: 'schema',
      });

      // 添加详细的验证错误
      if (validationResult.errors) {
        for (const error of validationResult.errors) {
          result.warnings.push({
            type: 'error',
            message: `验证错误: ${error.message}`,
            context: 'schema',
          });
        }
      }

      result.hasErrors = true;
      return result;
    }

    // 转换配置为解析后的绑定
    const parsedBindings = parseUserBindings(validationResult.data!);
    result.bindings = parsedBindings.bindings;
    result.warnings.push(...parsedBindings.warnings);
    result.hasErrors = parsedBindings.warnings.some((w) => w.type === 'error');

    // 添加成功加载的消息
    if (!result.hasErrors) {
      result.warnings.push({
        type: 'warning',
        message: `成功加载 ${result.bindings.length} 个用户绑定`,
      });
    }
  } catch (error) {
    result.warnings.push({
      type: 'error',
      message: `加载用户绑定失败: ${error instanceof Error ? error.message : String(error)}`,
    });
    result.hasErrors = true;
  }

  return result;
}

/**
 * 解析用户绑定配置
 */
function parseUserBindings(config: any): {
  bindings: ParsedBinding[];
  warnings: KeybindingWarning[];
} {
  const bindings: ParsedBinding[] = [];
  const warnings: KeybindingWarning[] = [];

  for (const block of config.bindings) {
    const context = block.context as KeybindingContextName;

    for (const [keystrokeString, action] of Object.entries(block.bindings)) {
      // 处理取消绑定（null值）
      if (action === null) {
        // 取消绑定不需要创建ParsedBinding，但需要记录
        warnings.push({
          type: 'warning',
          message: `取消绑定: ${keystrokeString}`,
          context: context,
          key: keystrokeString,
        });
        continue;
      }

      // 解析和弦序列
      const chord = parseChord(keystrokeString);
      if (chord.length === 0) {
        warnings.push({
          type: 'error',
          message: `无效的按键序列: ${keystrokeString}`,
          context: context,
          key: keystrokeString,
        });
        continue;
      }

      // 创建绑定
      bindings.push({
        action: action as string,
        context: context,
        chord: {
          chords: chord,
          displayText: formatChord(chord),
        },
      });
    }
  }

  return { bindings, warnings };
}

/**
 * 订阅绑定变更
 */
export function subscribeToKeybindingChanges(callback: () => void): () => void {
  changeListeners.add(callback);

  // 如果还没有观察器，启动文件观察
  if (!fileWatcher && existsSync(USER_BINDINGS_PATH)) {
    startFileWatching();
  }

  // 返回取消订阅函数
  return () => {
    changeListeners.delete(callback);

    // 如果没有监听器了，停止文件观察
    if (changeListeners.size === 0 && fileWatcher) {
      fileWatcher.close();
      fileWatcher = null;
    }
  };
}

/**
 * 启动文件观察
 */
function startFileWatching(): void {
  if (fileWatcher) {
    return;
  }

  try {
    fileWatcher = watch(
      USER_BINDINGS_PATH,
      { persistent: false },
      (eventType) => {
        if (eventType === 'change') {
          // 文件变更，通知所有监听器
          for (const listener of changeListeners) {
            try {
              listener();
            } catch (error) {
              logger.error('Error in keybindings change listener:', { error });
            }
          }
        }
      }
    );

    // 处理观察器错误
    fileWatcher.on('error', (error) => {
      logger.error('Keybindings file watcher error:', { error });
      fileWatcher = null;
    });
  } catch (error) {
    logger.error('Failed to start keybindings file watcher:', { error });
  }
}

/**
 * 初始化按键绑定观察器
 */
export function initializeKeybindingWatcher(): void {
  // 检查文件是否存在
  if (existsSync(USER_BINDINGS_PATH)) {
    userBindingsFileExists = true;

    // 如果有监听器，启动文件观察
    if (changeListeners.size > 0) {
      startFileWatching();
    }
  }
}

/**
 * 获取用户绑定文件状态
 */
export function getUserBindingsStatus(): {
  exists: boolean;
  path: string;
  listenerCount: number;
  watching: boolean;
} {
  return {
    exists: userBindingsFileExists,
    path: USER_BINDINGS_PATH,
    listenerCount: changeListeners.size,
    watching: fileWatcher !== null,
  };
}

/**
 * 重新加载用户绑定
 */
export function reloadUserBindings(): KeybindingsLoadResult {
  // 停止当前观察器
  if (fileWatcher) {
    fileWatcher.close();
    fileWatcher = null;
  }

  // 重新加载绑定
  const result = loadUserBindingsSync();

  // 重新启动观察器（如果有监听器）
  if (changeListeners.size > 0 && existsSync(USER_BINDINGS_PATH)) {
    startFileWatching();
  }

  return result;
}

/**
 * 同步加载用户绑定并显示警告
 */
export function loadUserBindingsSyncWithWarnings(): KeybindingsLoadResult {
  const result = loadUserBindingsSync();

  // 显示警告信息
  if (result.warnings.length > 0) {
    logger.info('Keybinding warnings:');
    for (const warning of result.warnings) {
      const prefix = warning.type === 'error' ? '❌' : '⚠️';
      logger.info(`${prefix} ${warning.message}`);
      if (warning.context) {
        logger.info(`   Context: ${warning.context}`);
      }
      if (warning.key) {
        logger.info(`   Key: ${warning.key}`);
      }
    }
  }

  return result;
}

/**
 * 创建默认用户绑定文件
 */
export function createDefaultUserBindingsFile(): boolean {
  try {
    const fs = require('fs');
    const { join, dirname } = require('path');

    // 确保目录存在
    const dir = dirname(USER_BINDINGS_PATH);
    if (!existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // 创建默认配置文件
    const defaultConfig = {
      $schema: './keybindings.schema.json',
      $docs: 'https://docs.Liri.dev/keybindings',
      bindings: [
        {
          context: 'Global',
          bindings: {
            // 在这里添加你的自定义绑定
            // 'ctrl+p': 'app:quickOpen'
          },
        },
      ],
    };

    fs.writeFileSync(
      USER_BINDINGS_PATH,
      JSON.stringify(defaultConfig, null, 2)
    );
    userBindingsFileExists = true;

    return true;
  } catch (error) {
    logger.error('Failed to create default user bindings file:', { error });
    return false;
  }
}
