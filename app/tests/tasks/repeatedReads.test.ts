// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 单步内「同参只读调用」短路（2026-11-10）。
 *
 * 覆盖：只读重复命中、短路上限后强制真实执行、写调用清空缓存、命令类工具不短路、
 * 失败结果不入缓存（避免把失败固化成结论）。
 */

import { describe, expect, it } from 'bun:test';
import {
  MAX_REPEATED_READ_REPLAYS,
  rememberRepeatedRead,
  takeRepeatedRead,
  takeRepeatedReadForTool,
} from '../../src/tasks/lro/repeatedReads';

const call = (
  id: string,
  name: string,
  args: Record<string, unknown> = { file_path: 'a.txt' }
) => ({ id, name, arguments: args });

describe('repeatedReads：同参只读调用短路', () => {
  it('首次执行后，同参调用返回短路结果（不再执行）', () => {
    const cache = new Map();
    const first = call('t1', 'file_read');
    rememberRepeatedRead(first, true, 'hello', undefined, cache);

    const hit = takeRepeatedRead(call('t2', 'file_read'), true, cache);
    expect(hit?.toolCallId).toBe('t2');
    expect(hit?.toolName).toBe('file_read');
    expect(String(hit?.result)).toContain('[未重复执行]');
    expect(String(hit?.result)).toContain('hello');
  });

  it('参数不同不命中（offset/limit 等分段读取不受影响）', () => {
    const cache = new Map();
    rememberRepeatedRead(
      call('t1', 'file_read'),
      true,
      'hello',
      undefined,
      cache
    );
    expect(
      takeRepeatedRead(
        call('t2', 'file_read', { file_path: 'a.txt', offset: 10 }),
        true,
        cache
      )
    ).toBeUndefined();
  });

  it(`连续短路 ${MAX_REPEATED_READ_REPLAYS} 次后强制真实执行（防"拿不到内容"死循环）`, () => {
    const cache = new Map();
    rememberRepeatedRead(call('t1', 'glob'), true, 'a.txt', undefined, cache);
    for (let i = 0; i < MAX_REPEATED_READ_REPLAYS; i++) {
      expect(
        takeRepeatedRead(call(`hit${i}`, 'glob'), true, cache)
      ).toBeDefined();
    }
    expect(
      takeRepeatedRead(call('exceed', 'glob'), true, cache)
    ).toBeUndefined();
  });

  it('写调用清空本步缓存（写后读必须重新执行）', () => {
    const cache = new Map();
    rememberRepeatedRead(
      call('t1', 'file_read'),
      true,
      'old',
      undefined,
      cache
    );
    rememberRepeatedRead(
      call('t2', 'file_write', { file_path: 'a.txt', content: 'new' }),
      false,
      { success: true },
      undefined,
      cache
    );
    expect(
      takeRepeatedRead(call('t3', 'file_read'), true, cache)
    ).toBeUndefined();
  });

  it('命令类工具即使只读也不短路（同命令重复调用必须真实执行）', () => {
    const cache = new Map();
    rememberRepeatedRead(
      call('t1', 'bash', { command: 'dir' }),
      true,
      'a.txt',
      undefined,
      cache
    );
    expect(
      takeRepeatedRead(call('t2', 'bash', { command: 'dir' }), true, cache)
    ).toBeUndefined();
  });

  it('未声明只读（fail-closed）不短路', () => {
    const cache = new Map();
    rememberRepeatedRead(call('t1', 'file_read'), false, 'x', undefined, cache);
    expect(
      takeRepeatedRead(call('t2', 'file_read'), false, cache)
    ).toBeUndefined();
  });

  it('失败结果不入缓存', () => {
    const cache = new Map();
    rememberRepeatedRead(
      call('t1', 'file_read'),
      true,
      { success: false },
      '文件不存在',
      cache
    );
    expect(
      takeRepeatedRead(call('t2', 'file_read'), true, cache)
    ).toBeUndefined();
  });

  it('工具级入口：未实现 isReadOnly / 判定抛错 ⇒ 按写处理（不短路）', () => {
    const cache = new Map();
    rememberRepeatedRead(call('t1', 'file_read'), true, 'x', undefined, cache);

    expect(
      takeRepeatedReadForTool(call('t2', 'file_read'), undefined, cache)
        .readOnly
    ).toBe(false);
    expect(
      takeRepeatedReadForTool(
        call('t3', 'file_read'),
        () => {
          throw new Error('boom');
        },
        cache
      ).shortCircuit
    ).toBeUndefined();
  });
});
