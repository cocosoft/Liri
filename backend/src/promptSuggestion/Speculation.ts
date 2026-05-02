/**
 * Speculation 超前执行模块
 * 基于CC源码设计
 */

import { randomUUID } from 'crypto';
import { join } from 'path';
import {
  IDLE_SPECULATION_STATE,
  type SpeculationState,
  type SpeculationResult,
  WRITE_TOOLS,
  SAFE_READ_ONLY_TOOLS,
  MAX_SPECULATION_TURNS,
  MAX_SPECULATION_MESSAGES,
} from './types';

let currentState: SpeculationState = { ...IDLE_SPECULATION_STATE };

/**
 * 获取Speculation临时目录路径
 */
function getOverlayPath(id: string): string {
  const tempDir = process.env.TEMP || process.env.TMP || '/tmp';
  return join(tempDir, 'speculation', String(process.pid), id);
}

/**
 * 安全删除叠加层目录
 */
function safeRemoveOverlay(overlayPath: string): void {
  try {
    if (process.env.DEBUG_SPECULATION === 'true') {
      console.log(`[Speculation] Would remove overlay: ${overlayPath}`);
    }
  } catch (error) {
    if (process.env.DEBUG_SPECULATION === 'true') {
      console.error('[Speculation] Error removing overlay:', error);
    }
  }
}

/**
 * 判断工具是否为只读操作
 */
export function isToolReadOnly(toolName: string): boolean {
  return SAFE_READ_ONLY_TOOLS.has(toolName);
}

/**
 * 判断工具是否为写入操作
 */
export function isToolWrite(toolName: string): boolean {
  return WRITE_TOOLS.has(toolName);
}

/**
 * 获取当前Speculation状态
 */
export function getSpeculationState(): SpeculationState {
  return { ...currentState };
}

/**
 * 设置Speculation状态
 */
export function setSpeculationState(state: Partial<SpeculationState>): void {
  currentState = { ...currentState, ...state };
}

/**
 * 重置Speculation状态
 */
export function resetSpeculationState(): void {
  if (currentState.overlayPath) {
    safeRemoveOverlay(currentState.overlayPath);
  }
  currentState = { ...IDLE_SPECULATION_STATE };
}

/**
 * 开始Speculation
 */
export async function startSpeculation(
  suggestion: string,
  messages: unknown[],
  setAppState?: (state: Partial<SpeculationState>) => void
): Promise<SpeculationResult | null> {
  if (currentState.status === 'active') {
    if (process.env.DEBUG_SPECULATION === 'true') {
      console.log('[Speculation] Already active, skipping');
    }
    return null;
  }

  const id = randomUUID();
  const overlayPath = getOverlayPath(id);

  setSpeculationState({
    status: 'active',
    id,
    suggestion,
    overlayPath,
    writtenPaths: new Set(),
    result: null,
  });

  if (setAppState) {
    setAppState(getSpeculationState());
  }

  if (process.env.DEBUG_SPECULATION === 'true') {
    console.log('[Speculation] Started', { id, suggestion, overlayPath });
  }

  const result: SpeculationResult = {
    status: 'incomplete',
    messages: [],
  };

  setSpeculationState({ result });

  return result;
}

/**
 * 中止Speculation
 */
export function abortSpeculation(): void {
  if (currentState.status !== 'active') {
    return;
  }

  if (process.env.DEBUG_SPECULATION === 'true') {
    console.log('[Speculation] Aborted', { id: currentState.id });
  }

  setSpeculationState({ status: 'aborted' });
  resetSpeculationState();
}

/**
 * 接受Speculation结果
 */
export async function acceptSpeculation(): Promise<boolean> {
  if (currentState.status !== 'active' && currentState.status !== 'aborted') {
    return false;
  }

  if (process.env.DEBUG_SPECULATION === 'true') {
    console.log('[Speculation] Accepted', { id: currentState.id });
  }

  setSpeculationState({ status: 'accepted' });
  resetSpeculationState();
  return true;
}

/**
 * 检查是否应该启用Speculation
 */
export function shouldEnableSpeculation(): boolean {
  if (process.env.DEBUG_SPECULATION === 'false') {
    return false;
  }

  const envOverride = process.env.CLAUDE_CODE_ENABLE_SPECULATION;
  if (envOverride === 'false' || envOverride === '0') {
    return false;
  }
  if (envOverride === 'true' || envOverride === '1') {
    return true;
  }

  return true;
}

/**
 * 记录写入路径
 */
export function recordWrittenPath(path: string): void {
  if (currentState.status === 'active') {
    currentState.writtenPaths.add(path);
  }
}

/**
 * 检查Speculation是否正在运行
 */
export function isSpeculationActive(): boolean {
  return currentState.status === 'active';
}
