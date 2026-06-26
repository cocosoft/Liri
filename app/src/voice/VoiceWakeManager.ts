/**
 * VoiceWakeManager
 * 实时语音唤醒管理
 * 基于 OpenClaw voicewake.ts 设计思路
 * 负责唤醒词配置持久化、唤醒词检测、触发路由
 */

import { Logger, LogLevel } from '@modules/monitoring';
import { join } from 'path';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolvePyappHome } from '@modules/core';
import { WakeWordEngine } from './WakeWordEngine';
import type { WakeWordResult } from './WakeWordEngine';
import { broadcastWakeEvent } from './WakeWebSocketServer';

const logger = new Logger({ level: LogLevel.INFO });

/** 唤醒词配置 */
export interface VoiceWakeConfig {
  triggers: string[];
  updatedAtMs: number;
}

/** 唤醒检测结果 */
export interface WakeDetectionResult {
  /** 是否检测到唤醒 */
  detected: boolean;
  /** 匹配的唤醒词 */
  matchedTrigger: string | null;
  /** 去除唤醒词后的剩余文本 */
  remainingText: string | null;
}

// ========== 默认配置 ==========

/** 默认唤醒词列表（中文 + 英文） */
const DEFAULT_TRIGGERS: string[] = ['小鸟小鸟', 'Hi Liri'];

// ========== 持久化 ==========

/** JSON 文件读锁防止并发写入冲突 */
let writeLock: Promise<void> = Promise.resolve();

/**
 * 获取唤醒词配置文件路径
 */
function getConfigPath(): string {
  return join(resolvePyappHome(), 'settings', 'voicewake.json');
}

/**
 * 获取默认唤醒词列表副本
 */
export function defaultVoiceWakeTriggers(): string[] {
  return [...DEFAULT_TRIGGERS];
}

/**
 * 规范化唤醒词：去空格、转小写、去空
 */
export function sanitizeTriggers(triggers: string[]): string[] {
  const cleaned = triggers
    .map((w) => w.trim().toLowerCase())
    .filter((w) => w.length > 0);
  return cleaned.length > 0 ? cleaned : defaultVoiceWakeTriggers();
}

/**
 * 确保配置目录存在
 */
async function ensureConfigDir(): Promise<void> {
  const configPath = getConfigPath();
  const dir = join(configPath, '..');
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

/**
 * 加载唤醒词配置
 * 配置文件不存在时返回默认值
 */
export async function loadVoiceWakeConfig(): Promise<VoiceWakeConfig> {
  const configPath = getConfigPath();

  try {
    const content = await readFile(configPath, 'utf-8');
    const parsed = JSON.parse(content) as VoiceWakeConfig;
    logger.info('VoiceWakeManager · 配置已加载', {
      triggers: parsed.triggers,
    });
    return {
      triggers: sanitizeTriggers(parsed.triggers),
      updatedAtMs:
        typeof parsed.updatedAtMs === 'number' && parsed.updatedAtMs > 0
          ? parsed.updatedAtMs
          : 0,
    };
  } catch {
    logger.warn('VoiceWakeManager · 配置文件不存在，使用默认值', {
      defaultTriggers: defaultVoiceWakeTriggers(),
    });
    return { triggers: defaultVoiceWakeTriggers(), updatedAtMs: 0 };
  }
}

/**
 * 保存唤醒词配置
 * 使用原子写入（write-lock 防并发）
 */
export async function setVoiceWakeTriggers(
  triggers: string[]
): Promise<VoiceWakeConfig> {
  const sanitized = sanitizeTriggers(triggers);
  const configPath = getConfigPath();

  writeLock = writeLock.then(async () => {
    await ensureConfigDir();
    const config: VoiceWakeConfig = {
      triggers: sanitized,
      updatedAtMs: Date.now(),
    };
    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
  });

  await writeLock;
  logger.info('VoiceWakeManager · 唤醒词已保存', { triggers: sanitized });

  // 如果引擎正在运行，同步更新触发词
  if (engine && engine.status === 'listening') {
    engine.setTriggers(sanitized);
  }

  return { triggers: sanitized, updatedAtMs: Date.now() };
}

/**
 * 在转录文本中检测唤醒词
 * 返回匹配的唤醒词及去除唤醒词后的剩余文本
 * @param transcript 语音转录文本
 * @param triggers 唤醒词列表（可选，默认从配置加载）
 */
export async function detectWakeWord(
  transcript: string,
  triggers?: string[]
): Promise<WakeDetectionResult> {
  if (!transcript || transcript.trim().length === 0) {
    return { detected: false, matchedTrigger: null, remainingText: null };
  }

  const activeTriggers = triggers ?? (await loadVoiceWakeConfig()).triggers;
  const normalized = transcript.trim().toLowerCase();

  // 按长度降序排列，优先匹配较长（更精确）的唤醒词
  const sorted = [...activeTriggers].sort((a, b) => b.length - a.length);

  for (const trigger of sorted) {
    const idx = normalized.indexOf(trigger);
    if (idx !== -1) {
      // 提取唤醒词后的剩余文本
      const afterTrigger = transcript.slice(idx + trigger.length).trim();
      logger.info('VoiceWakeManager · 检测到唤醒词', {
        trigger,
        remainingText: afterTrigger?.slice(0, 80),
      });
      return {
        detected: true,
        matchedTrigger: trigger,
        remainingText: afterTrigger.length > 0 ? afterTrigger : null,
      };
    }
  }

  return { detected: false, matchedTrigger: null, remainingText: null };
}

// ========== 唤醒监听生命周期 ==========

/** 全局唤醒引擎实例 */
let engine: WakeWordEngine | null = null;

/** 唤醒事件回调列表 */
const wakeCallbacks: Set<(result: WakeDetectionResult) => void> = new Set();

/** 当前是否正在唤醒监听中 */
let _isWakeListening: boolean = false;

/**
 * 当前是否正在监听唤醒词
 */
export function isWakeListening(): boolean {
  return _isWakeListening;
}

/**
 * 启动唤醒监听
 *
 * 初始化 WakeWordEngine 并开始侦听音频级唤醒词检测。
 * 引擎一旦检测到唤醒词，通过 VoiceWakeManager 做文本级二次确认后
 * 触发注册的 onWake 回调。
 *
 * @param triggers 唤醒词列表（可选，默认从配置加载）
 */
export async function startWakeListening(triggers?: string[]): Promise<void> {
  if (_isWakeListening) {
    logger.warn('VoiceWakeManager · 唤醒监听已在运行中');
    return;
  }

  const activeTriggers = triggers ?? (await loadVoiceWakeConfig()).triggers;

  try {
    engine = new WakeWordEngine({
      triggers: activeTriggers,
      silenceHoldMs: 500,
      minSpeechDurationMs: 200,
      maxSpeechDurationMs: 8000,
    });

    engine.onWake = async (wakeResult: WakeWordResult) => {
      // 文本级二次确认
      const configTriggers = (await loadVoiceWakeConfig()).triggers;
      const detection = await detectWakeWord(
        wakeResult.transcript,
        configTriggers
      );

      if (detection.detected) {
        logger.info('VoiceWakeManager · 唤醒成功（音频+文本二次确认）', {
          trigger: detection.matchedTrigger,
          transcript: wakeResult.transcript,
        });

        // 广播到所有连接的唤醒 WS 客户端
        broadcastWakeEvent(detection);

        // 通知所有注册的回调（如 VoiceServiceBridge）
        for (const cb of wakeCallbacks) {
          try {
            cb(detection);
          } catch (err) {
            logger.error('VoiceWakeManager · 唤醒回调异常', {
              error: String(err),
            });
          }
        }
      }
    };

    await engine.initialize();
    _isWakeListening = true;
    logger.info('VoiceWakeManager · 唤醒监听已启动', {
      triggers: activeTriggers,
    });
  } catch (err) {
    logger.error('VoiceWakeManager · 启动唤醒监听失败', {
      error: String(err),
    });
    engine?.destroy();
    engine = null;
    _isWakeListening = false;
    throw err;
  }
}

/**
 * 停止唤醒监听
 */
export async function stopWakeListening(): Promise<void> {
  if (!_isWakeListening) return;

  if (engine) {
    engine.destroy();
    engine = null;
  }

  _isWakeListening = false;
  logger.info('VoiceWakeManager · 唤醒监听已停止');
}

/**
 * 送入音频数据给唤醒引擎
 * 仅在唤醒监听模式下有效，由上游（WebSocket / HTTP stream）调用
 *
 * @param samples Float32Array PCM 样本
 */
export function feedWakeAudio(samples: Float32Array): void {
  if (!_isWakeListening || !engine) return;
  engine.feedAudio(samples);
}

/**
 * 注册唤醒事件回调
 * @param callback 唤醒时调用的回调函数
 * @returns 取消注册的函数
 */
export function onWake(
  callback: (result: WakeDetectionResult) => void
): () => void {
  wakeCallbacks.add(callback);
  return () => {
    wakeCallbacks.delete(callback);
  };
}

/**
 * 重置唤醒管理器状态
 */
export function resetWakeManager(): void {
  wakeCallbacks.clear();
  if (engine) {
    engine.destroy();
    engine = null;
  }
  _isWakeListening = false;
}
