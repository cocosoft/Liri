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
import { handleError } from '@modules/error';

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

/**
 * 获取 tiktoken 编码器（惰性加载，复用单例）
 * 对标 PilotDeck tokenizer.ts — o200k_base BPE
 */
export async function getTiktokenEncoder(): Promise<TiktokenEncoding | null> {
  if (_encoder !== undefined) return _encoder;
  if (_loadError) return null;

  try {
    const tiktoken = await import('js-tiktoken');
    // o200k_base: GPT-4o / Claude 3.5 等最新模型的通用 BPE 编码
    // js-tiktoken API 为 camelCase: encodingForModel
    const enc = (
      tiktoken as unknown as {
        encodingForModel(model: string): TiktokenEncoding;
      }
    ).encodingForModel('gpt-4o');
    _encoder = enc;
    logger.info('tiktoken:encoder_loaded', { model: 'gpt-4o (o200k_base)' });
    return enc;
  } catch (err) {
    _loadError = true;
    _encoder = null;
    await handleError(err, { module: 'ai:tokenizer', action: 'load' });
    return null;
  }
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
