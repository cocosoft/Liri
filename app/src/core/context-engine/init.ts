import { registerContextEngine } from './registry.js';
import { LegacyContextEngine } from './legacy.js';

let initialized = false;

/**
 * 确保所有内置上下文引擎已注册。
 * Legacy 引擎始终注册为安全回退，确保 resolveContextEngine()
 * 能解析默认的 "legacy" 插槽。
 */
export function ensureContextEnginesInitialized(): void {
  if (initialized) {
    return;
  }
  initialized = true;

  registerContextEngine('legacy', () => new LegacyContextEngine());
}

/**
 * 重置初始化状态（用于测试）。
 */
export function resetContextEngineInit(): void {
  initialized = false;
}
