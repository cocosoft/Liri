/**
 * thumbCache — 缩略图本地缓存（Phase 6.5）
 *
 * 策略：
 *   - 一级缓存：内存 Map（访问最快，页面关闭即释放）
 *   - 二级缓存：localStorage（跨会话持久化，30 分钟 TTL）
 *   - 首次加载：从 URL 加载图片 → canvas 转 base64 → 写入缓存
 *   - 后续加载：直接从缓存读取 base64，无需网络请求
 */

const CACHE_TTL = 30 * 60 * 1000; // 30 分钟
const STORAGE_PREFIX = "pyapp_thumb:";
const MAX_STORAGE_ENTRIES = 200; // 最多缓存 200 张缩略图

interface CacheEntry {
  data: string;
  ts: number;
}

/** 内存缓存 */
const memCache = new Map<string, string>();

/** 获取缓存的缩略图 base64 */
export function getCachedThumb(url: string): string | null {
  // 一级：内存
  const mem = memCache.get(url);
  if (mem) return mem;

  // 二级：localStorage
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + url);
    if (raw) {
      const entry: CacheEntry = JSON.parse(raw);
      if (Date.now() - entry.ts < CACHE_TTL) {
        memCache.set(url, entry.data);
        return entry.data;
      }
      // 过期则删除
      localStorage.removeItem(STORAGE_PREFIX + url);
    }
  } catch {
    /* ignore */
  }

  return null;
}

/** 缓存缩略图 */
export function setCachedThumb(url: string, dataUrl: string): void {
  memCache.set(url, dataUrl);

  // 限制 localStorage 条目数
  try {
    const keys = Object.keys(localStorage).filter((k) =>
      k.startsWith(STORAGE_PREFIX),
    );
    if (keys.length >= MAX_STORAGE_ENTRIES) {
      // 删除最旧的 20%
      const toRemove = keys
        .map((k) => ({
          key: k,
          ts: JSON.parse(localStorage.getItem(k) || "{}").ts || 0,
        }))
        .sort((a, b) => a.ts - b.ts)
        .slice(0, Math.ceil(MAX_STORAGE_ENTRIES * 0.2));
      for (const item of toRemove) {
        localStorage.removeItem(item.key);
      }
    }

    localStorage.setItem(
      STORAGE_PREFIX + url,
      JSON.stringify({ data: dataUrl, ts: Date.now() }),
    );
  } catch {
    /* localStorage 满则忽略 */
  }
}

/**
 * 从图片 URL 生成缩略图 base64 并缓存
 * 使用离屏 canvas 缩放至最大 300px 宽
 */
export async function generateAndCacheThumb(url: string): Promise<string> {
  // 先查缓存
  const cached = getCachedThumb(url);
  if (cached) return cached;

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      const maxWidth = 300;
      let w = img.naturalWidth;
      let h = img.naturalHeight;

      if (w > maxWidth) {
        h = Math.round((h * maxWidth) / w);
        w = maxWidth;
      }

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;

      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(img, 0, 0, w, h);
      }

      const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
      setCachedThumb(url, dataUrl);
      resolve(dataUrl);
    };

    img.onerror = () => resolve(url); // 失败时回退到原始 URL
    img.src = url;
  });
}

/** 清除所有缓存 */
export function clearThumbCache(): void {
  memCache.clear();
  try {
    const keys = Object.keys(localStorage).filter((k) =>
      k.startsWith(STORAGE_PREFIX),
    );
    for (const key of keys) {
      localStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
}
