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

import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({
  level: LogLevel.INFO,
  module: 'channels:routing:rate-limiter',
});

interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

/** 桶容量（burst 上限） */
const BUCKET_CAPACITY = parseInt(
  process.env.CHANNEL_RATE_LIMIT_CAPACITY || '10',
  10
);
/** 补充速率：每 REFILL_MS 恢复一个 token */
const REFILL_MS = parseInt(
  process.env.CHANNEL_RATE_LIMIT_REFILL_MS || '60000',
  10
);

const buckets = new Map<string, TokenBucket>();

/** 定期清理空闲桶，防止内存增长 */
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    // 超过 3 个 refill 周期未使用 → 回收
    if (now - bucket.lastRefill > REFILL_MS * 3) {
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
  if (process.env.CHANNEL_RATE_LIMIT_ENABLED === 'false') return true;

  const key = `${channel}:${sender}`;
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: BUCKET_CAPACITY, lastRefill: now };
    buckets.set(key, bucket);
  }

  // 补充 token
  if (now - bucket.lastRefill >= REFILL_MS) {
    const elapsed = now - bucket.lastRefill;
    const refill = Math.floor(elapsed / REFILL_MS);
    if (refill > 0) {
      bucket.tokens = Math.min(BUCKET_CAPACITY, bucket.tokens + refill);
      bucket.lastRefill += refill * REFILL_MS;
    }
  }

  if (bucket.tokens <= 0) {
    logger.warning('渠道消息触发限流', { channel, sender, key });
    return false;
  }
  bucket.tokens -= 1;
  return true;
}
