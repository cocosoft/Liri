/**
 * 记忆系统 · 确定性 eval 基线（P3-1，2026-11-25）
 *
 * 规格：`.trae/specs/agent-memory-optimization.md` §4 P3-1
 * 五项指标中的四项可**确定性**度量（无需模型在环）：
 *   ① 跨会话事实召回  ② 过期/新旧事实纠正（新事实优先）
 *   ③ 重复抑制（空闲期去重）  ④ token 成本（会话注入预算 + 索引行预算 + 检索条数）
 *   ⑤ 注入遵循度 —— 需要真实模型评测，**不在**本文件冒充通过。
 *
 * 全部使用临时目录，不触碰 `~/.pyapp/data/memory`。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MemoryManagerImpl } from '@openliri/infra/memory/MemoryManager';
import { MemoryStoreImpl } from '@openliri/infra/memory/stores/MemoryStore';
import { createMemoryMetadata } from '@openliri/infra/memory/types/MemoryMetadata';
import { buildMemoryIndexSection } from '@openliri/infra/memory';
import {
  buildSessionMemoryInjection,
  type SessionMemorySource,
} from '@modules/chat/services/context/sessionMemoryInjection';

const createdDirs: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'memory-eval-'));
  createdDirs.push(root);
  return root;
}

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (!dir) continue;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // 清理失败不影响断言
    }
  }
});

describe('记忆 eval 基线（P3-1）', () => {
  it('① 跨会话事实召回：已知事实进入 top-K', async () => {
    const manager = new MemoryManagerImpl(makeRoot());
    await manager.createMemory({
      content: '部署窗口是每周二 03:00（Asia/Shanghai）',
      metadata: createMemoryMetadata({ name: '部署窗口', type: 'decision' }),
    });
    await manager.createMemory({
      content: '用户偏好中文回答',
      metadata: createMemoryMetadata({ name: '语言偏好', type: 'user_fact' }),
    });
    await manager.createMemory({
      content: '提交前先跑 typecheck 与门禁',
      metadata: createMemoryMetadata({ name: '提交流程', type: 'decision' }),
    });

    const hits = await manager.getRelevantMemories('部署窗口 几点', 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].content).toContain('部署窗口');
  });

  it('② 新旧事实纠正：更新的事实排在旧事实之前', async () => {
    const manager = new MemoryManagerImpl(makeRoot());
    const old = new Date(Date.now() - 60 * 86_400_000);

    await manager.createMemory({
      content: '发布分支是 release/1.0',
      metadata: createMemoryMetadata({
        name: '旧发布分支',
        type: 'decision',
        createdAt: old,
        updatedAt: old,
      }),
    });
    await manager.createMemory({
      content: '发布分支是 main',
      metadata: createMemoryMetadata({ name: '新发布分支', type: 'decision' }),
    });

    const hits = await manager.getRelevantMemories('发布分支', 5);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits[0].content).toContain('main');
  });

  it('③ 重复抑制：空闲期去重把同文条目收敛为 1 条', async () => {
    const root = makeRoot();
    const store = new MemoryStoreImpl(root);
    const now = new Date();
    for (const id of ['dup1', 'dup2']) {
      await store.saveMemory({
        id,
        content: '完全相同的记忆正文内容，用于去重评估用例。',
        metadata: createMemoryMetadata({ name: id, type: 'conversation' }),
        createdAt: now,
        updatedAt: now,
      });
    }
    await store.flushBatch();

    const manager = new MemoryManagerImpl(root);
    const result = await manager.runMaintenancePass();

    expect(result.removed).toBe(1);
    expect(await manager.getAllMemories()).toHaveLength(1);
  });

  it('④a token 成本：会话记忆超预算 ⇒ 降级为索引（体积受控）', () => {
    const longText = `## 会话历史记忆\n\n${'很长的流水账。'.repeat(500)}`;
    const source: SessionMemorySource = {
      getMemoryContext: () => longText,
      loadMemory: () => ({
        items: [
          { type: 'decision', content: '决策一' },
          { type: 'file_change', content: '改动 a.ts' },
        ],
      }),
    };

    const injection = buildSessionMemoryInjection(source, 's1', 100);
    expect(injection.mode).toBe('index');
    expect(injection.text.length).toBeLessThan(1_000);
    expect(injection.text).not.toContain('流水账。'.repeat(20));
  });

  it('④b token 成本：索引层按行预算截断并如实提示', () => {
    const root = makeRoot();
    mkdirSync(join(root, 'global'), { recursive: true });
    const entries = Array.from(
      { length: 300 },
      (_, i) => `- [条目${i}](m${i}.md) — hook ${i}`
    );
    writeFileSync(
      join(root, 'global', 'MEMORY.md'),
      ['# Memory Index', '', ...entries].join('\n'),
      'utf-8'
    );

    const section = buildMemoryIndexSection({
      memoryDir: root,
      maxLines: 200,
      maxBytes: 25_000,
    });
    const lines = section.split('\n');
    expect(lines.length).toBeLessThanOrEqual(210);
    expect(section).toContain('上面只载入最近');
  });

  it('④c token 成本：检索条数受 limit 约束', async () => {
    const manager = new MemoryManagerImpl(makeRoot());
    for (let i = 0; i < 10; i++) {
      await manager.createMemory({
        content: `关键词 记忆条目 ${i}`,
        metadata: createMemoryMetadata({
          name: `条目${i}`,
          type: 'conversation',
        }),
      });
    }
    const hits = await manager.getRelevantMemories('关键词', 4);
    expect(hits.length).toBeLessThanOrEqual(4);
  });
});
