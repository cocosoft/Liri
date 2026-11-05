// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P1-3（2026-11-05）：已读/已检索目标锚定 —— 扩展到检索类工具。
 *
 * 盯盘实证：183 次 `repeated-call` / 120 个不同目标，其中 `glob pattern=**\/*` 同路径重复最突出；
 * 原实现只覆盖 `file_read`，检索类重复无人纠正。
 */

import { describe, it, expect } from 'bun:test';
import {
  buildRereadNotice,
  createReadFileAnchorState,
  markNotified,
  recordReadCalls,
} from '../../src/chat/services/readFileAnchor';

const ws = 'C:\\ws';

describe('P1-3：读取类工具（原有行为不回退）', () => {
  it('第 2 轮读同一文件 ⇒ 提示「已读取」', () => {
    const state = createReadFileAnchorState();
    const call = { name: 'file_read', input: { path: `${ws}\\a.ts` } };
    recordReadCalls(state, [call], 1);

    const notice = buildRereadNotice(state, [call], 2);
    expect(notice).not.toBeNull();
    expect(notice).toContain(`${ws}\\a.ts`);
    expect(notice).toContain('第 1 轮已读取');
  });

  it('同一轮内重复读 ⇒ 不提示（并行读取属正常）', () => {
    const state = createReadFileAnchorState();
    const call = { name: 'file_read', input: { path: `${ws}\\b.ts` } };
    recordReadCalls(state, [call], 1);
    expect(buildRereadNotice(state, [call], 1)).toBeNull();
  });

  it('已提示过（markNotified）⇒ 不再重复打扰', () => {
    const state = createReadFileAnchorState();
    const call = { name: 'file_read', input: { path: `${ws}\\c.ts` } };
    recordReadCalls(state, [call], 1);
    markNotified(state, [call]);
    expect(buildRereadNotice(state, [call], 2)).toBeNull();
  });
});

describe('P1-3：检索类工具（本轮新增覆盖）', () => {
  it('glob 同路径 + 同模式第 2 轮 ⇒ 提示「已检索」并展示模式', () => {
    const state = createReadFileAnchorState();
    const call = {
      name: 'glob',
      input: { path: ws, pattern: '**/*' },
    };
    recordReadCalls(state, [call], 1);

    const notice = buildRereadNotice(state, [call], 2);
    expect(notice).not.toBeNull();
    expect(notice).toContain('glob(**/*)');
    expect(notice).toContain('已检索');
  });

  it('glob 同路径不同模式 ⇒ 不算重复（正常探查）', () => {
    const state = createReadFileAnchorState();
    recordReadCalls(
      state,
      [{ name: 'glob', input: { path: ws, pattern: '**/*' } }],
      1
    );
    const notice = buildRereadNotice(
      state,
      [{ name: 'glob', input: { path: ws, pattern: 'src/**/*.ts' } }],
      2
    );
    expect(notice).toBeNull();
  });

  it('grep 同路径 + 同模式第 2 轮 ⇒ 提示', () => {
    const state = createReadFileAnchorState();
    const call = {
      name: 'grep',
      input: { path: `${ws}\\src`, pattern: 'TODO' },
    };
    recordReadCalls(state, [call], 1);
    const notice = buildRereadNotice(state, [call], 3);
    expect(notice).toContain('grep(TODO)');
    expect(notice).toContain('第 1 轮已检索');
  });

  it('检索类参数不完整（缺 pattern / path 为空）⇒ 不记录也不提示', () => {
    const state = createReadFileAnchorState();
    recordReadCalls(
      state,
      [
        { name: 'glob', input: { path: ws } },
        { name: 'grep', input: { path: '   ', pattern: 'TODO' } },
      ],
      1
    );
    expect(Object.keys(state.records)).toEqual([]);
  });
});

describe('P1-3：边界', () => {
  it('非读取/检索类工具（bash）⇒ 不进入台账', () => {
    const state = createReadFileAnchorState();
    recordReadCalls(
      state,
      [{ name: 'bash', input: { path: `${ws}\\a.ts` } }],
      1
    );
    expect(Object.keys(state.records)).toEqual([]);
  });
});
