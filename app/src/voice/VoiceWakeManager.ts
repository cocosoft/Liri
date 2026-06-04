/**
 * VoiceWakeManager
 * 实时语音唤醒管理
 * 基于 OpenClaw voicewake.ts 设计思路
 * 负责唤醒词配置持久化、唤醒词检测、触发路由
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { join } from 'path';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolvePyappHome } from '@modules/core/paths';

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

/** 默认唤醒词列表 */
const DEFAULT_TRIGGERS: string[] = ['pyapp', 'assistant', 'computer'];

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
    logger.info('VoiceWakeManager · 配置已加载', { triggers: parsed.triggers });
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
