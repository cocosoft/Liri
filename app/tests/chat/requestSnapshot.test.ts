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
 * RequestSnapshotService 单测（TR-12-B）
 *
 * 覆盖 Spec §5 的"服务单测 + 读端还原"两层：
 *   - 首次 ⇒ 落全量；未变 ⇒ 只引用；变更 ⇒ 重落全量
 *   - 多段独立判定（段 A 变、段 B 未变）
 *   - 索引可重建（新实例 + 同一日志 ⇒ 不重落全量）
 *   - 空输入 ⇒ 不产事件（CS04）
 *   - 按 refSeq **一跳**还原 ⇒ 与原始内容相等
 *
 * 全部使用真实 `EventLogStorage` 写入**临时目录**（不触碰 ~/.pyapp）。
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { EventLogStorage } from '../../src/session/storage/EventLogStorage';
import {
  RequestSnapshotService,
  type ModelInputSnapshot,
} from '../../src/chat/services/RequestSnapshotService';

const SESSION = 'snap-session';
const WORKTREE = 'wt-hash';

/** 读端视角的载荷（避免 any：新代码零 any） */
interface ReadToolUnit {
  hash: string;
  count: number;
  schemas?: unknown[];
}
interface ReadSectionUnit {
  name: string;
  hash: string;
  content?: string;
  refSeq?: number;
}
interface ReadSnapshot {
  tools?: ReadToolUnit;
  toolsRefSeq?: number;
  sections?: ReadSectionUnit[];
  mode?: string;
}

const TOOLS = [
  {
    name: 'read_file',
    description: '读取文件',
    input_schema: { type: 'object', properties: { path: { type: 'string' } } },
  },
];

let roots: string[] = [];
afterEach(() => {
  for (const r of roots) {
    try {
      rmSync(r, { recursive: true, force: true });
    } catch {
      // @ignore-catch — 临时目录清理失败不影响断言
    }
  }
  roots = [];
});

function makeEnv() {
  const root = mkdtempSync(join(tmpdir(), 'snap-'));
  roots.push(root);
  // TB-14/E1-a（2026-09-24）契约变更：事件日志**不再自建会话目录**（防止把已被外部进程
  // 软删除的会话目录凭空建回来）。真实链路由存储层 `createSession` 先建目录 ⇒ 夹具同样预建。
  mkdirSync(join(root, WORKTREE, SESSION), { recursive: true });
  const log = new EventLogStorage(SESSION, WORKTREE, root);
  const svc = new RequestSnapshotService(() => log);
  return { log, svc, root };
}

/** 读取全部 model-input 事件（含 seq），供引用断言 */
async function readSnapshots(log: EventLogStorage) {
  const events = await log.read({
    types: ['context/model-input'],
    limit: 100,
  });
  return events.map((e) => ({ seq: e.seq, data: e.data as ReadSnapshot }));
}

describe('RequestSnapshotService（模型输入快照 · 引用式去重）', () => {
  test('首次记录 ⇒ 落全量（tools.schemas + sections[].content）', async () => {
    const { log, svc } = makeEnv();
    await svc.record(SESSION, {
      tools: TOOLS,
      sections: [{ name: 'identity', content: '我是 Liri' }],
      mode: 'conversation',
    });

    const snaps = await readSnapshots(log);
    expect(snaps.length).toBe(1);
    expect(snaps[0].data.tools?.schemas).toEqual(TOOLS);
    expect(snaps[0].data.tools?.count).toBe(1);
    expect(snaps[0].data.sections?.[0].content).toBe('我是 Liri');
    expect(snaps[0].data.toolsRefSeq).toBeUndefined();
    expect(snaps[0].data.sections?.[0].refSeq).toBeUndefined();
    expect(snaps[0].data.mode).toBe('conversation');
  });

  test('内容未变 ⇒ 只写 refSeq/toolsRefSeq（不重复落全量）', async () => {
    const { log, svc } = makeEnv();
    const input: ModelInputSnapshot = {
      tools: TOOLS,
      sections: [{ name: 'identity', content: '我是 Liri' }],
    };
    await svc.record(SESSION, input);
    await svc.record(SESSION, input);

    const snaps = await readSnapshots(log);
    expect(snaps.length).toBe(2); // 每轮仍有事件（轨迹不断链）
    const first = snaps[0];
    const second = snaps[1];
    expect(second.data.tools?.schemas).toBeUndefined();
    expect(second.data.toolsRefSeq).toBe(first.seq);
    expect(second.data.tools?.hash).toBe(first.data.tools?.hash);
    expect(second.data.sections?.[0].content).toBeUndefined();
    expect(second.data.sections?.[0].refSeq).toBe(first.seq);
  });

  test('内容变更 ⇒ 重新落全量（引用链不指向过期内容）', async () => {
    const { log, svc } = makeEnv();
    await svc.record(SESSION, {
      sections: [{ name: 'identity', content: 'v1' }],
    });
    await svc.record(SESSION, {
      sections: [{ name: 'identity', content: 'v2' }],
    });

    const snaps = await readSnapshots(log);
    const second = snaps[1];
    expect(second.data.sections?.[0].content).toBe('v2');
    expect(second.data.sections?.[0].refSeq).toBeUndefined();
  });

  test('多段独立判定：段 A 变更、段 B 未变', async () => {
    const { log, svc } = makeEnv();
    await svc.record(SESSION, {
      sections: [
        { name: 'identity', content: 'A1' },
        { name: 'gitContext', content: 'B1' },
      ],
    });
    await svc.record(SESSION, {
      sections: [
        { name: 'identity', content: 'A1' }, // 未变
        { name: 'gitContext', content: 'B2' }, // 变更
      ],
    });

    const snaps = await readSnapshots(log);
    const second = snaps[1];
    const identity = second.data.sections?.find((s) => s.name === 'identity');
    const git = second.data.sections?.find((s) => s.name === 'gitContext');
    expect(identity?.content).toBeUndefined();
    expect(identity?.refSeq).toBe(snaps[0].seq);
    expect(git?.content).toBe('B2');
    expect(git?.refSeq).toBeUndefined();
  });

  test('索引可重建：新服务实例 + 同一日志 ⇒ 仍只写引用', async () => {
    const { log, svc } = makeEnv();
    const input: ModelInputSnapshot = {
      tools: TOOLS,
      sections: [{ name: 'identity', content: '我是 Liri' }],
    };
    await svc.record(SESSION, input);

    // 模拟进程重启：同一份事件日志，全新的服务实例（内存索引为空）
    const restarted = new RequestSnapshotService(() => log);
    await restarted.record(SESSION, input);

    const snaps = await readSnapshots(log);
    expect(snaps.length).toBe(2);
    expect(snaps[1].data.tools?.schemas).toBeUndefined();
    expect(snaps[1].data.toolsRefSeq).toBe(snaps[0].seq);
    expect(snaps[1].data.sections?.[0].refSeq).toBe(snaps[0].seq);
  });

  test('空输入 ⇒ 不产事件（CS04：空即空）', async () => {
    const { log, svc } = makeEnv();
    await svc.record(SESSION, {});
    await svc.record(SESSION, { tools: [], sections: [] });
    await svc.record(SESSION, {
      sections: [{ name: 'identity', content: null }],
    });

    const snaps = await readSnapshots(log);
    expect(snaps.length).toBe(0);
  });

  test('读端还原：按 refSeq/toolsRefSeq **一跳**取回全量，与原始内容相等', async () => {
    const { log, svc } = makeEnv();
    const input: ModelInputSnapshot = {
      tools: TOOLS,
      sections: [{ name: 'identity', content: '我是 Liri' }],
    };
    await svc.record(SESSION, input);
    await svc.record(SESSION, input);

    const snaps = await readSnapshots(log);
    const bySeq = new Map(snaps.map((s) => [s.seq, s.data]));
    const last = snaps[snaps.length - 1].data;

    // tools：按 toolsRefSeq 一跳取回
    const toolsFull = last.tools?.schemas
      ? last.tools.schemas
      : bySeq.get(last.toolsRefSeq as number)?.tools?.schemas;
    expect(toolsFull).toEqual(TOOLS);

    // sections：按 refSeq 一跳取回
    const section = last.sections?.[0];
    const sectionFull = section?.content
      ? section.content
      : bySeq.get(section?.refSeq as number)?.sections?.[0].content;
    expect(sectionFull).toBe('我是 Liri');
  });

  test('dispose 清理索引后 ⇒ 下次记录重新落全量', async () => {
    const { log, svc } = makeEnv();
    const input: ModelInputSnapshot = { tools: TOOLS };
    await svc.record(SESSION, input);
    svc.dispose(SESSION);
    // dispose 后索引可重建（事件仍在）⇒ 仍为引用，而非重落全量
    await svc.record(SESSION, input);

    const snaps = await readSnapshots(log);
    expect(snaps[1].data.tools?.schemas).toBeUndefined();
    expect(snaps[1].data.toolsRefSeq).toBe(snaps[0].seq);
  });
});
