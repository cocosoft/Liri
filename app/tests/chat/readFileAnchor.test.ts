/**
 * 已读文件锚定（Bug 4 第三项，2026-11-01）。
 *
 * 钉住三件事：
 *   ① 首次读取不提示；**跨轮**重读同一路径才提示（含轮次），同轮内并行重复读不提示；
 *   ② 每个路径只提示一次（`markNotified` 后不再打扰）；
 *   ③ 提示有界：最多点名 3 个路径，其余以计数带过（防止纠偏本身撑爆上下文）。
 */
import { describe, expect, it } from 'bun:test';
import {
  buildRereadNotice,
  createReadFileAnchorState,
  markNotified,
  recordReadCalls,
} from '../../src/chat/services/readFileAnchor';

const read = (path: string, extra: Record<string, unknown> = {}) => ({
  name: 'file_read',
  input: { path, ...extra },
});

describe('已读文件锚定', () => {
  it('首次读取不提示，并记入台账', () => {
    const state = createReadFileAnchorState();
    const calls = [read('docs/a.md')];

    expect(buildRereadNotice(state, calls, 1)).toBeNull();
    recordReadCalls(state, calls, 1);

    expect(state.records['docs/a.md']).toMatchObject({
      reads: 1,
      turns: [1],
      notified: false,
    });
  });

  it('跨轮重读同一路径 ⇒ 提示含路径与上次轮次（参数只差 offset 也算）', () => {
    const state = createReadFileAnchorState();
    recordReadCalls(state, [read('docs/a.md')], 1);

    const notice = buildRereadNotice(
      state,
      [read('docs/a.md', { offset: 200 })],
      3
    );
    expect(notice).not.toBeNull();
    expect(String(notice)).toContain('docs/a.md');
    expect(String(notice)).toContain('第 1 轮已读');
    expect(String(notice)).toContain('offset/limit');
  });

  it('同一轮内重复读同一路径 ⇒ 不提示（并行读取属正常）', () => {
    const state = createReadFileAnchorState();
    recordReadCalls(state, [read('docs/a.md')], 2);

    expect(
      buildRereadNotice(state, [read('docs/a.md'), read('docs/a.md')], 2)
    ).toBeNull();
  });

  it('已提示过的路径不再提示（每路径仅一次）', () => {
    const state = createReadFileAnchorState();
    const calls = [read('docs/a.md')];
    recordReadCalls(state, calls, 1);

    expect(buildRereadNotice(state, calls, 2)).not.toBeNull();
    markNotified(state, calls);
    recordReadCalls(state, calls, 2);

    expect(buildRereadNotice(state, calls, 3)).toBeNull();
  });

  it('非 file_read / 参数缺 path ⇒ 不参与', () => {
    const state = createReadFileAnchorState();
    recordReadCalls(state, [read('docs/a.md')], 1);

    expect(
      buildRereadNotice(
        state,
        [
          { name: 'grep', input: { path: 'docs/a.md' } },
          { name: 'file_read', input: { filePath: 'docs/a.md' } },
          { name: 'file_read', input: { path: '   ' } },
        ],
        2
      )
    ).toBeNull();
  });

  it('提示有界：最多点名 3 个路径，其余以计数带过', () => {
    const state = createReadFileAnchorState();
    const paths = ['a.md', 'b.md', 'c.md', 'd.md', 'e.md'];
    recordReadCalls(
      state,
      paths.map((p) => read(p)),
      1
    );

    const notice = String(
      buildRereadNotice(
        state,
        paths.map((p) => read(p)),
        2
      )
    );
    for (const p of ['a.md', 'b.md', 'c.md']) expect(notice).toContain(p);
    expect(notice).not.toContain('d.md');
    expect(notice).toContain('另有 2 个已读文件');
  });

  it('台账有界：每路径最多保留 10 个轮次', () => {
    const state = createReadFileAnchorState();
    for (let turn = 1; turn <= 15; turn++) {
      recordReadCalls(state, [read('docs/a.md')], turn);
    }
    const record = state.records['docs/a.md']!;
    expect(record.turns).toHaveLength(10);
    expect(record.turns[record.turns.length - 1]).toBe(15);
    expect(record.reads).toBe(15);
  });
});
