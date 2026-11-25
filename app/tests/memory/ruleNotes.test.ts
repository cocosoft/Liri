/**
 * P2-2（2026-11-25）：规则笔记 schema 与「失败 → 理论 → 验证 → 规则」闭环。
 *
 * 规格：`.trae/specs/agent-memory-optimization.md` §8.7
 * 覆盖：frontmatter 往返 · MCP `memory_write` 规则参数映射 ·
 * Validate 命中证据即写 `testedAt`（不改写正文）· 维护期完整性报告。
 * 全程临时目录，不触碰 `~/.pyapp/data/memory`。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  MemoryManagerImpl,
  setMemoryEvidenceProvider,
} from '@openliri/infra/memory/MemoryManager';
import { MemoryStoreImpl } from '@openliri/infra/memory/stores/MemoryStore';
import { createMemoryMetadata } from '@openliri/infra/memory/types/MemoryMetadata';
import { buildMemoryWriteMetadata } from '../../src/entrypoints/mcp-memory';

const createdDirs: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'memory-rule-'));
  createdDirs.push(root);
  return root;
}

afterEach(() => {
  setMemoryEvidenceProvider(null);
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

describe('规则笔记（P2-2）', () => {
  it('frontmatter 往返：rule/whyTrue/evidenceSeqs/traps/testedAt 全部保留', async () => {
    const root = makeRoot();
    const store = new MemoryStoreImpl(root);
    const now = new Date('2026-02-03T04:05:06.000Z');

    await store.saveMemory({
      id: 'r1',
      content: '提交前先跑 typecheck',
      metadata: {
        ...createMemoryMetadata({ name: 'r1', type: 'rule' }),
        ruleNote: {
          rule: '提交前先跑 typecheck',
          whyTrue: '类型错误在 CI 才暴露会返工',
          evidenceSeqs: [12, 34],
          traps: ['只跑单包 tsc 会漏掉 scripts'],
          testedAt: now,
        },
      },
      createdAt: now,
      updatedAt: now,
    });
    await store.flushBatch();

    const reloaded = await new MemoryStoreImpl(root).readMemory('r1');
    expect(reloaded?.metadata.ruleNote).toEqual({
      rule: '提交前先跑 typecheck',
      whyTrue: '类型错误在 CI 才暴露会返工',
      evidenceSeqs: [12, 34],
      traps: ['只跑单包 tsc 会漏掉 scripts'],
      testedAt: now,
    });
  });

  it('MCP memory_write：提供 rule ⇒ 结构化规则笔记；testedAt 非法则报错', () => {
    const now = new Date('2026-03-01T00:00:00.000Z');
    const metadata = buildMemoryWriteMetadata(
      {
        content: '不要直接改生成文件',
        tags: ['rule'],
        rule: '不要直接改生成文件',
        whyTrue: '下次生成会被覆盖',
        evidenceSeqs: [7],
        traps: ['手工补丁看似生效'],
        testedAt: '2026-02-28T10:00:00.000Z',
      },
      now
    );
    expect(metadata.type).toBe('rule');
    expect(metadata.ruleNote?.rule).toBe('不要直接改生成文件');
    expect(metadata.ruleNote?.evidenceSeqs).toEqual([7]);
    expect(metadata.ruleNote?.traps).toEqual(['手工补丁看似生效']);
    expect(metadata.ruleNote?.testedAt?.toISOString()).toBe(
      '2026-02-28T10:00:00.000Z'
    );

    // 不提供 rule ⇒ 普通记忆，无 ruleNote
    const plain = buildMemoryWriteMetadata({ content: '普通事实' }, now);
    expect(plain.ruleNote).toBeUndefined();
    expect(plain.type).toBe('user_fact');

    // testedAt 不可解析 ⇒ 明确失败（不写坏数据）
    expect(() =>
      buildMemoryWriteMetadata(
        { content: 'x', rule: 'r', testedAt: 'not-a-time' },
        now
      )
    ).toThrow();
  });

  it('闭环：规则笔记（失败→理论）经验证命中 ⇒ 写 testedAt，完整性报告计入', async () => {
    const root = makeRoot();
    setMemoryEvidenceProvider(async (_sessionId, query) =>
      query.includes('逐字规则')
        ? [{ role: 'user', content: `之前踩过坑：${query}` }]
        : []
    );

    const manager = new MemoryManagerImpl(root);
    // 规则笔记：rule + whyTrue，尚未验证（无 testedAt）
    await manager.createMemory({
      content: '逐字规则：先跑门禁再提交',
      metadata: {
        ...createMemoryMetadata({
          name: 'rule-verified',
          type: 'rule',
          sessionId: 's1',
        }),
        ruleNote: {
          rule: '先跑门禁再提交',
          whyTrue: '门禁红态进提交要返工',
          evidenceSeqs: [3],
          traps: ['只跑 typecheck 漏 lint'],
        },
      },
    });
    // 不完整规则笔记：只有 rule（无 sessionId ⇒ 不参与 Validate）
    await manager.createMemory({
      content: '另一条不完整的规则',
      metadata: {
        ...createMemoryMetadata({ name: 'rule-incomplete', type: 'rule' }),
        ruleNote: { rule: '另一条不完整的规则' },
      },
    });

    await manager.runMaintenancePass();

    const memories = await manager.getAllMemories();
    const verified = memories.find((m) => m.metadata.name === 'rule-verified');
    expect(verified?.metadata.ruleNote?.testedAt).toBeInstanceOf(Date);
    expect(verified?.content).toBe('逐字规则：先跑门禁再提交');

    const report = JSON.parse(
      readFileSync(join(root, 'rule-notes-report.json'), 'utf-8')
    ) as {
      total: number;
      complete: number;
      incomplete: number;
      missing: Record<string, number>;
      incompleteSamples: Array<{ name: string; missing: string[] }>;
    };
    expect(report.total).toBe(2);
    expect(report.complete).toBe(1);
    expect(report.incomplete).toBe(1);
    expect(report.missing.whyTrue).toBe(1);
    expect(report.missing.testedAt).toBe(1);
    expect(report.incompleteSamples[0]?.name).toBe('rule-incomplete');
  });

  it('无规则笔记 ⇒ 不写报告（不伪造空态文件）', async () => {
    const root = makeRoot();
    const manager = new MemoryManagerImpl(root);
    await manager.createMemory({
      content: '普通记忆内容',
      metadata: createMemoryMetadata({ name: 'plain' }),
    });

    await manager.runMaintenancePass();

    expect(() =>
      readFileSync(join(root, 'rule-notes-report.json'), 'utf-8')
    ).toThrow();
  });
});
