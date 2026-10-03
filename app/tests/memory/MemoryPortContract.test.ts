// MIT License
// Copyright (c) 2026 190615273@qq.com
// 记忆窄端口契约用例（T-①07 T1-7，对标 spec §7-2）
//
// 目的：把 `MemoryManagerImpl` 绑定到四端口的**公共方法面**（Read/Write/Search/Forget），
// 断言"端口契约的最小公共语义"——写→读往返 / 更新 / 删除 / 遗忘 / 检索；
// 测试只经端口类型访问，不触碰端口外的实现细节。
//
// 注：当前仅一个实现者（`MemoryManagerImpl`），故 spec 原文的"同一组输入走各实现"
// 退化为"同一组输入走四端口公共面"（另立实现者时本文件可直接复用为共同语义基线）。

import { describe, expect, it, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MemoryManagerImpl } from '../../src/memory/MemoryManager';
import type {
  MemoryReadPort,
  MemoryWritePort,
  MemorySearchPort,
  MemoryForgetPort,
} from '../../src/memory/ports/MemoryPort';
import {
  createMemoryMetadata,
  type MemoryMetadata,
} from '../../src/memory/types/MemoryMetadata';

/** 四端口公共面 —— 契约用例只依赖它，不依赖 `MemoryManagerImpl` 的具体类类型 */
type MemoryPorts = MemoryReadPort &
  MemoryWritePort &
  MemorySearchPort &
  MemoryForgetPort;

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

/** 在独立临时目录装配一个端口实现（隔离磁盘状态，避免用例互相污染） */
function portOf(prefix = 'memport-'): MemoryPorts {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  createdDirs.push(dir);
  return new MemoryManagerImpl(dir);
}

function inputOf(content: string, name = 'contract-item'): {
  content: string;
  metadata: MemoryMetadata;
} {
  return {
    content,
    metadata: createMemoryMetadata({
      type: 'user_fact',
      name,
      tags: ['contract'],
    }),
  };
}

describe('记忆窄端口契约（MemoryManagerImpl 经四端口公共面）', () => {
  it('Write→Read 往返：createMemory 后可经 getMemory/getAllMemories 读回，stats 计数一致', async () => {
    const port = portOf();
    const created = await port.createMemory(
      inputOf('端口契约：一条用户事实')
    );
    expect(created.id).toBeTruthy();

    const fetched = await port.getMemory(created.id);
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.content).toBe('端口契约：一条用户事实');

    const all = await port.getAllMemories();
    expect(all.map((m) => m.id)).toContain(created.id);

    const stats = await port.getMemoryStats();
    expect(stats.total).toBe(1);
  });

  it('updateMemory 语义：内容变更后读回一致，id 不变', async () => {
    const port = portOf();
    const created = await port.createMemory(inputOf('契约：更新前'));
    const updated = await port.updateMemory(created.id, {
      content: '契约：更新后',
    });
    expect(updated.id).toBe(created.id);
    expect((await port.getMemory(created.id))?.content).toBe('契约：更新后');
  });

  it('deleteMemory/deleteAllMemories 语义：删除后读回为 null，全删返回剩余数', async () => {
    const port = portOf();
    const a = await port.createMemory(inputOf('契约：待删 A', 'a'));
    await port.createMemory(inputOf('契约：待删 B', 'b'));

    await port.deleteMemory(a.id);
    expect(await port.getMemory(a.id)).toBeNull();

    expect(await port.deleteAllMemories()).toBe(1);
    expect((await port.getAllMemories()).length).toBe(0);
  });

  it('setMemoryExpiry + cleanupExpiredMemories 交叉：未过期不清理，过期后清理', async () => {
    const port = portOf();
    const created = await port.createMemory(inputOf('契约：过期项'));

    await port.setMemoryExpiry(created.id, new Date(Date.now() + 3_600_000));
    expect(await port.cleanupExpiredMemories()).toBe(0); // 未过期 ⇒ 不清理

    await port.setMemoryExpiry(created.id, new Date(Date.now() - 1_000));
    expect(await port.cleanupExpiredMemories()).toBe(1); // 已过期 ⇒ 清理 1 条
    expect(await port.getMemory(created.id)).toBeNull();
  });

  it('getRelevantMemories 语义：返回数组且不超过 limit', async () => {
    const port = portOf();
    await port.createMemory(inputOf('契约：AI-AGENT 前沿动态调研', 's1'));
    await port.createMemory(inputOf('契约：HTML 日报生成', 's2'));

    const hits = await port.getRelevantMemories('AI-AGENT', 1);
    expect(Array.isArray(hits)).toBe(true);
    expect(hits.length).toBeLessThanOrEqual(1);
  });
});
