// MIT License
// Copyright (c) 2026 190615273@qq.com
// 跨会话记忆适配器单元测试（D 阶段，2026-09-02，接入文档 v5 P0-4）
// 覆盖：纯映射/幂等键回退链/metadata.sessionId/长度守卫/幂等 upsert/
// consolidator 高相似多阶段存活/类型注册与"未注册先扫描"回归/全量对齐式重建。

import { describe, expect, it, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MemoryManagerImpl } from '../../src/memory/MemoryManager';
import { MemoryScannerImpl } from '../../src/memory/scanners/MemoryScanner';
import {
  registerSessionSummaryMemoryType,
  idempotencyKey,
  buildSessionSummaryMemoryInput,
  rollupSessionSummaryToLongTerm,
  rebuildForSession,
  clearSessionSummaries,
  SESSION_SUMMARY_MEMORY_TYPE,
  type SessionSummaryAdapterInput,
} from '../../src/memory/adapters/SessionSummaryAdapter';
import { isValidMemoryType } from '../../src/memory/types/MemoryType';

const createdDirs: string[] = [];
afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop()!;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // 清理失败不影响断言
    }
  }
});

function tmpDir(prefix = 'sumadapter-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

function inputOf(
  sessionId: string,
  content: string,
  extra?: Partial<SessionSummaryAdapterInput>
): SessionSummaryAdapterInput {
  return {
    sessionId,
    content,
    keywords: extra?.keywords ?? ['AI-AGENT'],
    compactedRange: extra?.compactedRange ?? { startSeq: 1, endSeq: 10 },
    sourceEventSeqs: extra?.sourceEventSeqs ?? [1, 5, 10],
    summarySeq: extra?.summarySeq ?? 20,
    ...extra,
  };
}

describe('扫描路径（v5 P0-⑥）：未注册静默剔除 / 注册后可见', () => {
  it('session_summary 的扫描可见性随注册状态正确切换（自适应：bun worker 复用致跨文件注册污染）', async () => {
    // registerMemoryType 是模块级全局（v2 P2-8）。bun test 全量运行时 worker 复用会让
    // import 缓存跨文件共享——本文件前若有其他文件注册过 session_summary，此处无法复现
    // "未注册"纯态。故自适应断言：未注册 → 剔除(0)；已注册 → 可见(1)。两种状态都验证
    // 扫描不崩、且可见性严格跟随 isValidMemoryType。
    const unregistered = !isValidMemoryType('session_summary');
    const dir = tmpDir();
    writeFileSync(
      join(dir, 'm1.md'),
      [
        '---',
        'id: m1',
        'type: session_summary',
        "name: '会话摘要'",
        "description: ''",
        'createdAt: 2026-09-02T00:00:00.000Z',
        'updatedAt: 2026-09-02T00:00:00.000Z',
        'tags: []',
        '---',
        '阶段摘要正文内容',
        '',
      ].join('\n'),
      'utf-8'
    );
    const scanned = await new MemoryScannerImpl().scan(dir);
    if (unregistered) {
      expect(scanned.length).toBe(0); // 未注册 → isValidMemoryType false → 剔除（不崩、静默）
    } else {
      expect(scanned.length).toBe(1); // 已被同 worker 前置文件注册 → 可见
    }
  });
});

describe('buildSessionSummaryMemoryInput 纯映射 + 幂等键', () => {
  it('回退链①：区间为主键', () => {
    const input = inputOf('sess-abc', '完成 AI-AGENT 调研并产出 HTML 日报');
    expect(idempotencyKey(input)).toBe('sess-abc#1-10');
  });

  it('回退链②：无区间用摘要事件 seq', () => {
    const input = inputOf('sess-abc', '正文', {
      compactedRange: undefined,
      summarySeq: 42,
    });
    expect(idempotencyKey(input)).toBe('sess-abc#42');
  });

  it('回退链③：区间与 seq 均缺失用 contentHash8', () => {
    const input = inputOf('sess-abc', '仅内容兜底键', {
      compactedRange: undefined,
      summarySeq: undefined,
    });
    const key = idempotencyKey(input);
    expect(key).toMatch(/^sess-abc#c[0-9a-f]{8}$/);
    // 同内容 → 同键；不同内容 → 不同键
    const same = idempotencyKey(inputOf('sess-abc', '仅内容兜底键', {
      compactedRange: undefined,
      summarySeq: undefined,
    }));
    expect(same).toBe(key);
  });

  it('content 含前缀/来源行，metadata.sessionId 映射与全量字段', () => {
    const input = inputOf('sess-abcdef12', '阶段一结论：完成 AI-AGENT 前沿动态调研并产出 HTML 日报');
    const built = buildSessionSummaryMemoryInput(input);
    expect(built).not.toBeNull();
    const b = built!;
    expect(b.content).toContain('【会话 sess-abc 阶段摘要】');
    expect(b.content).toContain('[来源] 会话 sess-abcdef12 · 事件区间 1-10');
    expect(b.content).toContain('摘要事件 seq 20');
    expect(b.metadata.type).toBe(SESSION_SUMMARY_MEMORY_TYPE);
    expect(b.metadata.sessionId).toBe('sess-abcdef12'); // v3 P0：映射到分目录前提
    expect(b.metadata.name).toBe('sess-abcdef12#1-10');
    expect(b.metadata.tags).toContain('session-summary');
    expect(b.metadata.tags).toContain('sess-abcdef12');
    expect(b.metadata.tags).toContain('AI-AGENT');
    expect(b.metadata.source).toBe('session_compaction');
  });

  it('长度守卫：拼接后整串判长，超限截断正文使总长 ≤2000（v5 P2-2）', () => {
    const long = '长'.repeat(1990);
    const input = inputOf('sess-x', long, { keywords: [] });
    const built = buildSessionSummaryMemoryInput(input)!;
    expect(built.content.trim().length).toBeLessThanOrEqual(2000);
    expect(built.content.length).toBeGreaterThan(20);
    // 短/空内容 → 不入库（null）
    expect(buildSessionSummaryMemoryInput(inputOf('sess-x', ''))).toBeNull();
    expect(
      buildSessionSummaryMemoryInput(inputOf('sess-x', '  '))
    ).toBeNull();
  });

  it('sessionId 含不安全路径字符被 rollup 拒绝（v5 P2-1）', async () => {
    const dir = tmpDir();
    const mm = new MemoryManagerImpl(dir);
    const bad = inputOf('a/../../etc', '内容', {});
    expect(await rollupSessionSummaryToLongTerm(bad, mm)).toBe(false);
    expect((await mm.getAllMemories()).length).toBe(0);
  });
});

describe('rollupSessionSummaryToLongTerm 幂等 + consolidator 存活', () => {
  it('同幂等键二次写入不新增（upsert 覆盖）', async () => {
    const dir = tmpDir();
    const mm = new MemoryManagerImpl(dir);
    const input = inputOf('sess-1', '阶段 A：完成 AI-AGENT 前沿动态调研并产出 HTML 日报');
    expect(await rollupSessionSummaryToLongTerm(input, mm)).toBe(true);
    const key = idempotencyKey(input);
    // 同键（内容微调）二次写入 → 覆盖不新增
    const again = inputOf('sess-1', '阶段 A：完成 AI-AGENT 前沿动态调研并产出 HTML 日报（修订补充）');
    expect(await rollupSessionSummaryToLongTerm(again, mm)).toBe(true);
    const all = (await mm.getAllMemories()).filter(
      (m) =>
        m.metadata.type === SESSION_SUMMARY_MEMORY_TYPE &&
        m.metadata.name === key
    );
    expect(all.length).toBe(1);
    expect(all[0].content).toContain('修订');
  });

  it('不同幂等键但内容高相似（相邻阶段）两条都存活（skipConsolidation，v5 B 案）', async () => {
    const dir = tmpDir();
    const mm = new MemoryManagerImpl(dir);
    const a = inputOf('sess-2', '阶段一：完成 AI-AGENT 前沿动态调研，产出 HTML 日报', {
      compactedRange: { startSeq: 1, endSeq: 100 },
      summarySeq: 101,
    });
    const b = inputOf('sess-2', '阶段二：继续 AI-AGENT 前沿动态调研，补充供应商与招标部分，最终完善 HTML 日报', {
      compactedRange: { startSeq: 102, endSeq: 400 },
      summarySeq: 401,
    });
    expect(await rollupSessionSummaryToLongTerm(a, mm)).toBe(true);
    expect(await rollupSessionSummaryToLongTerm(b, mm)).toBe(true);
    const summaries = (await mm.getAllMemories()).filter(
      (m) => m.metadata.type === SESSION_SUMMARY_MEMORY_TYPE
    );
    // 两条不同键、内容高相似（共享前缀/术语）都必须存活——防"相似即删"静默丢阶段摘要
    expect(summaries.length).toBe(2);
    expect(summaries.map((s) => s.metadata.name).sort()).toEqual([
      'sess-2#1-100',
      'sess-2#102-400',
    ]);
  });
});

describe('rebuildForSession 全量对齐式重建（v5 P1-⑦）', () => {
  it('C−E 删除 / E−C 创建 / E∩C 覆盖', async () => {
    const dir = tmpDir();
    const mm = new MemoryManagerImpl(dir);
    const r1 = inputOf('sess-r', '阶段一摘要：完成 AI-AGENT 调研与 HTML 日报初稿', { compactedRange: { startSeq: 1, endSeq: 50 } });
    const r2 = inputOf('sess-r', '阶段二摘要：补充供应商评审与招标文件转换', { compactedRange: { startSeq: 51, endSeq: 100 } });
    expect(await rollupSessionSummaryToLongTerm(r1, mm)).toBe(true);
    expect(await rollupSessionSummaryToLongTerm(r2, mm)).toBe(true);

    // events 侧演进：阶段二已折叠进阶段三（r2 不在 events），新增 r3
    const r3 = inputOf('sess-r', '阶段三摘要：完成 AI-AGENT 调研、供应商评审与招标转换并产出最终 HTML 日报', {
      compactedRange: { startSeq: 51, endSeq: 200 },
    });
    const res = await rebuildForSession('sess-r', [r1, r3], mm);
    expect(res.deleted).toBe(1); // r2（51-100）不再在期望集 → 删除
    expect(res.created).toBe(1); // r3 → 新建
    expect(res.updated).toBe(1); // r1 → 幂等键相同覆盖
    const survivors = (await mm.getAllMemories()).filter(
      (m) => m.metadata.type === SESSION_SUMMARY_MEMORY_TYPE
    );
    expect(survivors.length).toBe(2);
    expect(survivors.map((s) => s.metadata.name).sort()).toEqual([
      'sess-r#1-50',
      'sess-r#51-200',
    ]);
  });
});

describe('类型注册与扫描路径（v5 P0-⑥）', () => {
  it('注册幂等 + 注册后扫描可见', async () => {
    registerSessionSummaryMemoryType();
    registerSessionSummaryMemoryType(); // 幂等：重复调用不抛
    expect(isValidMemoryType('session_summary')).toBe(true);

    const dir = tmpDir();
    writeFileSync(
      join(dir, 'm2.md'),
      [
        '---',
        'id: m2',
        'type: session_summary',
        "name: '会话摘要2'",
        "description: ''",
        'createdAt: 2026-09-02T00:00:00.000Z',
        'updatedAt: 2026-09-02T00:00:00.000Z',
        'tags: [session-summary]',
        '---',
        '阶段摘要正文内容二',
        '',
      ].join('\n'),
      'utf-8'
    );
    const scanned = await new MemoryScannerImpl().scan(dir);
    expect(scanned.length).toBe(1);
    expect(scanned[0].metadata.type).toBe('session_summary');
  });
});

describe('D-P1：清理命令与 stats 自定义类型计入', () => {
  it('clearSessionSummaries：按会话删 / 全库删', async () => {
    const dir = tmpDir();
    const mm = new MemoryManagerImpl(dir);
    const a1 = inputOf('sess-a', '阶段一摘要：AI-AGENT 调研与日报生成完成', { compactedRange: { startSeq: 1, endSeq: 50 } });
    const b1 = inputOf('sess-b', '阶段一摘要：供应商评审与招标文件转换并输出 HTML 报告', { compactedRange: { startSeq: 1, endSeq: 50 } });
    expect(await rollupSessionSummaryToLongTerm(a1, mm)).toBe(true);
    expect(await rollupSessionSummaryToLongTerm(b1, mm)).toBe(true);

    const bySession = await clearSessionSummaries('sess-a', mm);
    expect(bySession.deleted).toBe(1);
    const rest = (await mm.getAllMemories()).filter(
      (m) => m.metadata.type === SESSION_SUMMARY_MEMORY_TYPE
    );
    expect(rest.length).toBe(1);
    expect(rest[0].metadata.sessionId).toBe('sess-b');

    const all = await clearSessionSummaries(undefined, mm);
    expect(all.deleted).toBe(1);
    const none = (await mm.getAllMemories()).filter(
      (m) => m.metadata.type === SESSION_SUMMARY_MEMORY_TYPE
    );
    expect(none.length).toBe(0);
  });

  it('getMemoryStats.byType 计入自定义类型（D-P1 类型层放宽）', async () => {
    const dir = tmpDir();
    const mm = new MemoryManagerImpl(dir);
    expect(await rollupSessionSummaryToLongTerm(inputOf('sess-s', '阶段摘要内容：完成 AI-AGENT 前沿动态调研与日报产出', {}), mm)).toBe(true);
    // 确定性落盘：pendingBatch 由 getAllMemories 内 flush 落盘后再统计（全量高并发下
    // 避免定时 flush 与统计读盘交错导致计数缺失）
    await mm.getAllMemories();
    const stats = await mm.getMemoryStats();
    // 自定义类型键可访问且计数正确；内置枚举键仍为 number（类型层不再写死枚举）
    expect(stats.byType.session_summary).toBe(1);
    expect(stats.byType.user_fact).toBe(0);
    expect(stats.total).toBe(1);
  });
});
