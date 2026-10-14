/**
 * HD-P1-2（硬编码治理方案 §4.1 A8 / §7.2）—— **退避/重试默认值单一真源守卫**。
 *
 * 本仓退避默认值的**真源与已知变体**（回仓逐处取证后的结论）：
 *
 * **HTTP 重试退避** —— 标准真源 `app/src/utils/withRetry.ts` 的 `DEFAULT_RETRY_CONFIG`
 * （该文件自述「项目标准重试实现……所有模块应优先使用本模块的 withRetry」）。
 * 同名的**同族变体**（形状各不相同 ⇒ **未合并**，合并=改字段名=行为面）：
 * - `app/src/query/withRetry.ts`（多 `jitterFactor`，查询层专用，文件自述「已知变体（待合并）」）
 * - `app/src/ai/providers/BaseAIProvider.ts`（用 `baseDelayMs` 而非 `initialDelayMs`）
 * - `app/src/streaming/IncrementalRetry.ts`（`IncrementalRetryConfig`，流式增量重试）
 *
 * **Bridge API 退避** —— 唯一真源 `app/src/bridge/types/BridgeApiTypes.ts` 的
 * `DEFAULT_BACKOFF_CONFIG`（`bridge/api/BridgeApi.ts` 原先**自带同值副本** ⇒ 已删）。
 *
 * **已合一的消费点**：`ai/services/aiService.ts` · `agent/harness/index.ts` ·
 * `chat/services/ImageDownloader.ts` 的重试次数默认值改为引用标准真源。
 *
 * ⚠️ **不纳入本守卫的 `maxRetries: 3`**（约 20 处）属**不同语义子系统**的独立默认值
 * （cron 任务 · 短信/邮件通道 · OAuth token · 执行策略 · 任务评审 ……）—— 概念不同，
 * 强行合一属语义错配（CS01/CS05），故**有意不动**。
 */
import { describe, it, expect } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { DEFAULT_RETRY_CONFIG } from '../../src/utils/withRetry';

const APP = join(import.meta.dir, '..', '..');
const SRC = join(APP, 'src');

function collectTs(dir: string, out: string[]): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '__tests__') continue;
      collectTs(join(dir, e.name), out);
    } else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name)) {
      out.push(join(dir, e.name));
    }
  }
}

const ALL: string[] = [];
collectTs(SRC, ALL);

const rel = (p: string) => relative(APP, p).split('\\').join('/');
const read = (p: string) => readFileSync(p, 'utf-8');

/** 在 `src` 内按正则找命中（返回排序后的 `文件:行号`） */
function findHits(pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const p of ALL) {
    const r = rel(p);
    read(p)
      .split('\n')
      .forEach((line, i) => {
        if (pattern.test(line)) hits.push(`${r}:${i + 1}`);
      });
  }
  return hits;
}

/** 命中所在的文件集合（去重、排序） */
function hitFiles(pattern: RegExp): string[] {
  return [...new Set(findHits(pattern).map((h) => h.split(':')[0]))].sort();
}

describe('HD-P1-2 A8 · 退避/重试默认值单一真源', () => {
  it('`DEFAULT_RETRY_CONFIG` 的声明点被钉住（真源 + 3 个已登记同族变体，不得新增）', () => {
    expect(
      hitFiles(/const DEFAULT_RETRY_CONFIG\b/),
      '新增同名默认配置前，先回台账 HARDCODE-HDP1-2-A8-BACKOFF-DEFAULTS 复核（能否复用真源？）'
    ).toEqual([
      'src/ai/providers/BaseAIProvider.ts',
      'src/query/withRetry.ts',
      'src/streaming/IncrementalRetry.ts',
      'src/utils/withRetry.ts',
    ]);
  });

  it('Bridge 退避默认值 `DEFAULT_BACKOFF_CONFIG` 只声明一次（bridge/types/BridgeApiTypes.ts）', () => {
    const hits = findHits(/const DEFAULT_BACKOFF_CONFIG\b/);
    expect(hits).toHaveLength(1);
    expect(hits[0].startsWith('src/bridge/types/BridgeApiTypes.ts:')).toBe(
      true
    );
  });

  it('已合一的消费点：引用真源，且本文件内不再内联重试次数默认值', () => {
    const consumers: Array<[string, RegExp]> = [
      ['src/ai/services/aiService.ts', /maxRetries:\s*3\b/],
      ['src/agent/harness/index.ts', /maxRetries\s*\?\?\s*3\b/],
      [
        'src/chat/services/ImageDownloader.ts',
        /envInt\(\s*'IMAGE_DOWNLOAD_MAX_RETRIES',\s*3\s*\)/,
      ],
    ];
    for (const [f, inlinePattern] of consumers) {
      const src = read(join(APP, f));
      expect(src, `${f} 应引用退避真源`).toContain('DEFAULT_RETRY_CONFIG');
      expect(inlinePattern.test(src), `${f} 不应再内联重试次数默认值`).toBe(
        false
      );
    }
  });

  it('真源取值（钉住，防改）', () => {
    expect(DEFAULT_RETRY_CONFIG.maxRetries).toBe(3);
    expect(DEFAULT_RETRY_CONFIG.backoffMultiplier).toBe(2);
    expect(DEFAULT_RETRY_CONFIG.initialDelayMs).toBe(1000);
    expect(DEFAULT_RETRY_CONFIG.maxDelayMs).toBe(30000);
  });

  it('**有意/待裁定的值差异**显式钉住（防止无声漂移）', () => {
    // Bridge API 的重试次数与 `withRetry` 标准**不同**（5 vs 3）—— 未合并（合并会改行为）
    expect(read(join(APP, 'src/bridge/types/BridgeApiTypes.ts'))).toMatch(
      /maxRetries:\s*5,/
    );

    // BridgeMain 与 PollManager 各有一份 `DEFAULT_BACKOFF`（conn/general 形态），
    // 其 general 值**不一致**（500/30000 vs 1000/60000）—— 未合并（合并会改行为）
    const main = read(join(APP, 'src/bridge/BridgeMain.ts'));
    const poll = read(join(APP, 'src/bridge/managers/PollManager.ts'));
    expect(main).toMatch(/generalInitialMs:\s*500,/);
    expect(main).toMatch(/generalCapMs:\s*30_000,/);
    expect(poll).toMatch(/generalInitialMs:\s*1000,/);
    expect(poll).toMatch(/generalCapMs:\s*60000,/);

    // 工具集成器的重试次数默认值（2）**不**随 withRetry 标准（3）—— 有意保留
    expect(read(join(APP, 'src/chat/tool/SmartToolIntegrator.ts'))).toMatch(
      /maxRetries:\s*number\s*=\s*2/
    );

    // 图片下载的退避基准（2000ms）与 `withRetry` 的 `initialDelayMs`（1000ms）**不同** —— 有意保留
    expect(read(join(APP, 'src/chat/services/ImageDownloader.ts'))).toMatch(
      /envInt\('IMAGE_DOWNLOAD_RETRY_DELAY_MS',\s*2000\)/
    );
  });
});
