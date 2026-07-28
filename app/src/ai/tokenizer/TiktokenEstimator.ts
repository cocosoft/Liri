/**
 * Tiktoken BPE 真值分词估算器（PilotDeck 对标）
 *
 * 基于 OpenAI tiktoken (o200k_base) 编码器提供精确 token 计数。
 * 作为 TokenEstimator 的高精度替代路径，CJK 感知估算为 fallback。
 *
 * 使用方式：
 *   const tokens = await getTiktokenCount("Hello 世界");
 *   // 或
 *   const encoder = await getTiktokenEncoder();
 *   const tokens = encoder.count("Hello 世界");
 *
 * 惰性初始化：首次调用时加载 wasm，后续调用零延迟。
 */
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({
  module: 'ai:tokenizer:tiktoken',
  level: LogLevel.INFO,
});

type TiktokenModule = {
  encoding_for_model(model: string): TiktokenEncoding;
};

type TiktokenEncoding = {
  encode(text: string): { length: number } | number[];
  free(): void;
};

let _encoder: TiktokenEncoding | null | undefined;
let _loadError = false;
const TIKTOKEN_RETRY_MS = 30_000; // 首次失败后 30s 重试

/** 执行编码器加载（内部实现） */
async function _loadEncoder(): Promise<TiktokenEncoding | null> {
  try {
    const tiktoken = await import('js-tiktoken');
    const enc = (
      tiktoken as unknown as {
        encodingForModel(model: string): TiktokenEncoding;
      }
    ).encodingForModel('gpt-4o');
    return enc;
  } catch (err) {
    return null;
  }
}

/**
 * 获取 tiktoken 编码器（惰性加载，复用单例）
 * 对标 PilotDeck tokenizer.ts — o200k_base BPE
 */
export async function getTiktokenEncoder(): Promise<TiktokenEncoding | null> {
  if (_encoder !== undefined) return _encoder;
  if (_loadError) return null;

  const enc = await _loadEncoder();
  if (enc) {
    _encoder = enc;
    logger.info('tiktoken:encoder_loaded', { model: 'gpt-4o (o200k_base)' });
    return enc;
  }

  // Phase 3: 加载失败 → 精度降级，logger.error 告警
  _loadError = true;
  _encoder = null;
  logger.error(
    'tiktoken:encoder_load_failed — 精度降至启发式估算，30s 后自动重试',
    {
      model: 'gpt-4o (o200k_base)',
      retryMs: TIKTOKEN_RETRY_MS,
    }
  );

  // Phase 3: 30s 后自动重试一次
  setTimeout(() => {
    _loadError = false;
    _encoder = undefined;
    logger.info('tiktoken:encoder_retry — 重新尝试加载编码器');
    getTiktokenEncoder().catch(() => {
      /* 重试静默 */
    });
  }, TIKTOKEN_RETRY_MS);

  return null;
}

/**
 * 同步获取已缓存的 tiktoken 编码器（不触发加载）
 * 用于压缩决策等同步路径：若编码器已加载则直接使用，否则返回 null
 */
export function getCachedTiktokenEncoder(): TiktokenEncoding | null {
  if (_encoder !== undefined && _encoder !== null) return _encoder;
  return null;
}

/**
 * 使用 tiktoken 精确计算 token 数（异步）
 * 对标 PilotDeck estimateTokens() — 真值 BPE 分词
 */
export async function getTiktokenCount(text: string): Promise<number | null> {
  const encoder = await getTiktokenEncoder();
  if (!encoder) return null;

  try {
    const result = encoder.encode(text);
    return Array.isArray(result) ? result.length : result.length;
  } catch {
    // @ignore-catch: tiktoken not loaded
    return null;
  }
}

/**
 * Phase 3: 应用启动时预加载 tiktoken wasm，不在首次 API 请求路径上 lazy init。
 * 调用方（如 main.ts 启动入口）应在应用初始化时调用此函数。
 */
export async function preloadTiktoken(): Promise<void> {
  logger.info('tiktoken:preload_start');
  const encoder = await getTiktokenEncoder();
  if (encoder) {
    logger.info('tiktoken:preload_success');
  } else {
    logger.error('tiktoken:preload_failed — 将在 30s 后自动重试');
  }
}

/**
 * 重置编码器（测试用）
 */
export function resetTiktokenEncoder(): void {
  if (_encoder && typeof _encoder.free === 'function') {
    try {
      _encoder.free();
    } catch {
      /* @ignore-catch: encoder free best-effort */
    }
  }
  _encoder = undefined;
  _loadError = false;
}
