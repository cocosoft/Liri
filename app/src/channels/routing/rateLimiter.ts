// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 渠道入站消息限流（P1-5 / 4.8）
 *
 * 按渠道 + 发送者的令牌桶限流，防止 open 策略渠道（email/irc/line/matrix 等）
 * 被刷爆 token 成本。默认阈值可通过环境变量调整：
 * - CHANNEL_RATE_LIMIT_ENABLED   = 'false' 时关闭
 * - CHANNEL_RATE_LIMIT_CAPACITY  = 桶容量（初始 token 数，默认 10）
 * - CHANNEL_RATE_LIMIT_REFILL_MS = 补充一个 token 的间隔（默认 60000，即 1 条/分钟）
 */

import { configManager } from '@modules/config';
import { getLogger } from '@modules/monitoring';
const logger = getLogger('channels:routing:rate-limiter');

interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

/**
 * 解析正整数环境变量；非法值（NaN/非正数）回退默认值并告警，
 * 避免 `NaN <= 0` 恒 false 导致限流被静默关闭（P3）
 */
function parsePositiveIntEnv(
  raw: string | undefined,
  fallback: number,
  name: string
): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    logger.warning(`环境变量 ${name} 无效，回退默认值 ${fallback}`, { raw });
    return fallback;
  }
  return parsed;
}

/**
 * 桶容量（burst 上限）— 惰性读取，避免模块加载时立即访问 configManager 触发 TDZ（循环导入）
 */
function getBucketCapacity(): number {
  return parsePositiveIntEnv(
    configManager.env('CHANNEL_RATE_LIMIT_CAPACITY'),
    10,
    'CHANNEL_RATE_LIMIT_CAPACITY'
  );
}
/** 补充速率：每 REFILL_MS 恢复一个 token — 惰性读取，同上 */
function getRefillMs(): number {
  return parsePositiveIntEnv(
    configManager.env('CHANNEL_RATE_LIMIT_REFILL_MS'),
    60000,
    'CHANNEL_RATE_LIMIT_REFILL_MS'
  );
}

const buckets = new Map<string, TokenBucket>();

/** 定期清理空闲桶，防止内存增长 */
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    // 超过 3 个 refill 周期未使用 → 回收
    if (now - bucket.lastRefill > getRefillMs() * 3) {
      buckets.delete(key);
    }
  }
}, 60_000).unref();

/**
 * 限流检查（消费 1 个 token）
 *
 * @param channel 渠道 ID/名称
 * @param sender 发送者 ID
 * @returns true=放行，false=触发限流
 */
export function checkRateLimit(channel: string, sender: string): boolean {
  if (configManager.env('CHANNEL_RATE_LIMIT_ENABLED') === 'false') return true;

  const key = `${channel}:${sender}`;
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: getBucketCapacity(), lastRefill: now };
    buckets.set(key, bucket);
  }

  // 补充 token
  const refillMs = getRefillMs();
  if (now - bucket.lastRefill >= refillMs) {
    const elapsed = now - bucket.lastRefill;
    const refill = Math.floor(elapsed / refillMs);
    if (refill > 0) {
      bucket.tokens = Math.min(getBucketCapacity(), bucket.tokens + refill);
      bucket.lastRefill += refill * refillMs;
    }
  }

  if (bucket.tokens <= 0) {
    logger.warning('渠道消息触发限流', { channel, sender, key });
    return false;
  }
  bucket.tokens -= 1;
  return true;
}
