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
 *
 * H5-⑥ 收口（台账 D-212，子批 E `service -> app`）：原位置 `ai/tokenizer/TiktokenEstimator.ts`
 * （app 层），而 `services/prompt/DiagnosticsReport.ts` 需要 `getCachedTiktokenEncoder`
 * ⇒ `services -> ai` 倒挂。该文件**仅依赖 `monitoring`/`error`（infra）、零 app 依赖**
 * ⇒ **改归 infra**（`utils/`）；⚠️ **当时不可下沉 core**（会让 core 新增 2 条 `core -> infra` 边，净变差，同 D-207；
 * B2 解环后本文件已只依赖 `@openliri/kernel/*`，归属维持 `utils/` 不动，如需下沉另立批次）。
 * `ai/tokenizer/TiktokenEstimator.ts` 保留**同名转出**（既有消费方零改动）。
 */
import { getLogger } from '@openliri/kernel/loggerFacade';
import { handleError } from '@openliri/kernel/errorHandler';

const logger = getLogger('ai:tokenizer:tiktoken');

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

  // Phase 3: 加载失败 → 精度降级，handleError 告警
  _loadError = true;
  _encoder = null;
  await handleError(new Error('tiktoken:encoder_load_failed'), {
    module: 'ai:tokenizer',
    action: 'loadEncoder',
  });

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
  return getCachedTokenCount(text);
}

/**
 * token 计数缓存（2026-11-04，运行态排查 C2）。
 *
 * 背景：BPE 分词是**同步 CPU 热点** —— 事件循环探针实测 `bytePairMerge` 单次采样
 * 3.9–5.0 s、`encode` 1.2 s（占总 self time 的 25–34%），原因是长上下文在
 * 压缩评估 / 预算判定里被**反复整段编码**。
 *
 * 口径：
 * - key 用「文本长度 + FNV-1a 32 位哈希」而非原文 —— 原文是上百 KB 字符串，
 *   直接当 key 会让缓存本身占满内存；
 * - 哈希碰撞的后果只是**估算偏差**（该计数仅用于预算/分页），不影响计费真值；
 * - 定长 2000 条，超限按插入顺序淘汰最旧（够覆盖一轮上下文的多份快照）。
 */
const TOKEN_COUNT_CACHE_MAX = 2000;
const _tokenCountCache = new Map<string, number>();

/** FNV-1a 32 位哈希（纯 JS、无依赖、O(n) 但远低于 BPE） */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * **同步**取 token 数（要求编码器已加载；未加载返回 `null`，不触发加载）。
 * 与 `getTiktokenCount` 共用同一份缓存与同一份计算结果。
 */
export function getCachedTokenCount(text: string): number | null {
  const encoder = getCachedTiktokenEncoder();
  if (!encoder) return null;
  if (!text) return 0;

  const key = `${text.length}:${fnv1a(text)}`;
  const hit = _tokenCountCache.get(key);
  if (hit !== undefined) return hit;

  try {
    const result = encoder.encode(text);
    const count = Array.isArray(result) ? result.length : result.length;
    if (_tokenCountCache.size >= TOKEN_COUNT_CACHE_MAX) {
      const oldest = _tokenCountCache.keys().next().value;
      if (oldest !== undefined) _tokenCountCache.delete(oldest);
    }
    _tokenCountCache.set(key, count);
    return count;
  } catch {
    // @ignore-catch: 编码失败按"未知"处理（调用方回落估算器）
    return null;
  }
}

/** 清空计数缓存（测试 / 切换编码器时用） */
export function clearTokenCountCache(): void {
  _tokenCountCache.clear();
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
    await handleError(new Error('tiktoken:preload_failed'), {
      module: 'ai:tokenizer',
      action: 'preload',
    });
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
