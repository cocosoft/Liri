/**
 * 通道出站**分片**守卫（2026-10-12 · 通道治理 阶段 1.1「分片全覆盖」）。
 *
 * 反模式：`content.slice(0, <META>.maxMessageLength)` —— 这是**截断**（尾部静默丢失，
 * 且可能把 Markdown 代码围栏截成"半开"）。长文本必须走**共享分片器** `splitMessage()`
 * （`channels/messageSplitter.ts`；结构感知、保围栏成对）。
 *
 * 本守卫对全 `src/channels/**` 做**源码扫描**，任何通道再出现该截断写法即失败 ——
 * 防止已收敛的 telegram / qq（本次）被回退，也防止新通道重犯。
 */
import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync, type Dirent } from 'node:fs';
import { join, relative } from 'node:path';

const CHANNELS_DIR = join(import.meta.dir, '../../src/channels');

/** `.slice(0, <任意>.maxMessageLength)` —— 截断反模式（`content.slice(0, 80)` 这类预览不算） */
const TRUNCATION_RE = /\.slice\(\s*0\s*,\s*[\w.]*maxMessageLength\s*\)/;

function walk(dir: string, out: string[] = []): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // 交由"扫描面非空"断言暴露
  }
  for (const e of entries) {
    const abs = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules') walk(abs, out);
      continue;
    }
    if (e.name.endsWith('.ts') || e.name.endsWith('.tsx')) out.push(abs);
  }
  return out;
}

/** 命中"截断反模式"的通道源文件（行级；跳过注释行） */
function findTruncationSites(): string[] {
  const hits: string[] = [];
  for (const abs of walk(CHANNELS_DIR)) {
    const content = readFileSync(abs, 'utf-8');
    if (!content.includes('maxMessageLength')) continue; // 快速预筛
    const rel = relative(CHANNELS_DIR, abs).replace(/\\/g, '/');
    for (const line of content.split('\n')) {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'))
        continue;
      if (TRUNCATION_RE.test(line)) {
        hits.push(rel);
        break;
      }
    }
  }
  return hits.sort();
}

describe('通道出站分片守卫（反「slice 截断」）', () => {
  it('src/channels/** 不得出现 `.slice(0, *.maxMessageLength)` 截断写法（长文本走 splitMessage）', () => {
    expect(findTruncationSites()).toEqual([]);
  }, 30_000);

  it('扫描面非空（防止 walk 失效导致守卫静默通过）', () => {
    expect(walk(CHANNELS_DIR).length).toBeGreaterThan(50);
  }, 30_000);
});
