/**
 * 围栏 M1：JSONL 增读（按字节偏移）。
 *
 * 三条契约：① 只消费完整行（半行留到下一轮）；② 偏移按**字节**（中文不乱切）；
 * ③ 文件变短（截断/轮转）⇒ `truncated=true` 并从 0 重读。
 */

import { describe, expect, it } from 'bun:test';

import { readAppendedJsonlLines } from '../../src/entrypoints/fence/jsonlTail.js';

function fromText(text: string) {
  return async () => Buffer.from(text, 'utf8');
}

describe('M1：readAppendedJsonlLines', () => {
  it('文件不存在 ⇒ exists=false（不抛错）', async () => {
    const result = await readAppendedJsonlLines('/nope.log', 0, {
      readFile: async () => {
        const error = new Error('ENOENT') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      },
    });
    expect(result).toEqual({
      exists: false,
      lines: [],
      nextOffset: 0,
      truncated: false,
      consumedHash: '',
    });
  });

  it('首读整文件：只返回完整行，偏移指向末尾换行之后', async () => {
    const result = await readAppendedJsonlLines('/a.log', 0, {
      readFile: fromText('{"a":1}\n{"b":2}\n'),
    });
    expect(result.lines).toEqual(['{"a":1}', '{"b":2}']);
    expect(result.nextOffset).toBe(Buffer.byteLength('{"a":1}\n{"b":2}\n'));
    expect(result.truncated).toBe(false);
  });

  it('半行不消费（偏移停在该半行之前）', async () => {
    const full = '{"a":1}\n{"b":2}';
    const result = await readAppendedJsonlLines('/a.log', 0, {
      readFile: fromText(full),
    });
    expect(result.lines).toEqual(['{"a":1}']);
    expect(result.nextOffset).toBe(Buffer.byteLength('{"a":1}\n'));
  });

  it('下一轮从断点续读（半行补全后才消费）', async () => {
    const text = '{"a":1}\n{"b":2}\n';
    const offset = Buffer.byteLength('{"a":1}\n');
    const result = await readAppendedJsonlLines('/a.log', offset, {
      readFile: fromText(text),
    });
    expect(result.lines).toEqual(['{"b":2}']);
    expect(result.nextOffset).toBe(Buffer.byteLength(text));
  });

  it('偏移按字节计算（中文命令不会错位）', async () => {
    const text = '{"command":"删除文件"}\n';
    const first = await readAppendedJsonlLines('/a.log', 0, {
      readFile: fromText(text),
    });
    expect(first.lines).toEqual(['{"command":"删除文件"}']);
    expect(first.nextOffset).toBe(Buffer.byteLength(text));

    const appended = await readAppendedJsonlLines('/a.log', first.nextOffset, {
      readFile: fromText(text + '{"command":"echo hi"}\n'),
    });
    expect(appended.lines).toEqual(['{"command":"echo hi"}']);
  });

  it('文件变短（截断/轮转）⇒ truncated=true 且从 0 重读', async () => {
    const result = await readAppendedJsonlLines('/a.log', 4096, {
      readFile: fromText('{"new":1}\n'),
    });
    expect(result.truncated).toBe(true);
    expect(result.lines).toEqual(['{"new":1}']);
    expect(result.nextOffset).toBe(Buffer.byteLength('{"new":1}\n'));
  });

  it('同长度替换（轮转后等长）⇒ 用末端指纹识别，不当作"无新增"', async () => {
    const oldText = '{"t":"2026-11-12T09:59:40.000Z"}\n';
    const newText = '{"t":"2026-11-12T09:59:59.000Z"}\n';
    expect(Buffer.byteLength(oldText)).toBe(Buffer.byteLength(newText));

    const first = await readAppendedJsonlLines('/a.log', 0, {
      readFile: fromText(oldText),
    });
    const afterReplace = await readAppendedJsonlLines(
      '/a.log',
      first.nextOffset,
      { readFile: fromText(newText) },
      first.consumedHash
    );
    expect(afterReplace.truncated).toBe(true);
    expect(afterReplace.lines).toEqual(['{"t":"2026-11-12T09:59:59.000Z"}']);
  });

  it('空文件 / 纯空白行 ⇒ 零行且偏移不变', async () => {
    const empty = await readAppendedJsonlLines('/a.log', 0, {
      readFile: fromText(''),
    });
    expect(empty.lines).toEqual([]);
    expect(empty.nextOffset).toBe(0);

    const blank = await readAppendedJsonlLines('/a.log', 0, {
      readFile: fromText('\n\n'),
    });
    expect(blank.lines).toEqual([]);
    expect(blank.nextOffset).toBe(2);
  });
});
