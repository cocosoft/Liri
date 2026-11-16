// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `/grep` 参数解析特征化（P3-2，2026-11-16）
 *
 * `parseGrepArgs` 是「短标志 / 长选项 / 位置参数」三段交织的手写解析器，边界行为多
 * （缺值回落、非法数字置 undefined、未知开关降级为位置参数…）。外移分支前先把这些
 * 现状逐条钉住，避免"看起来等价"的重写改变命令语义。
 */
import { describe, expect, it } from 'bun:test';
import { parseGrepArgs } from '../../src/commands/tools/system/grep';

const opts = (args: string) => parseGrepArgs(args).options;

describe('parseGrepArgs 位置参数', () => {
  it('首个位置参数为 pattern，其余拼成 searchPath', () => {
    expect(opts('function')).toEqual({ pattern: 'function' });
    expect(opts('pattern src/lib')).toEqual({
      pattern: 'pattern',
      searchPath: 'src/lib',
    });
  });

  it('显式 --pattern 会吞掉后续位置参数（现状：不再补 searchPath）', () => {
    expect(opts('--pattern foo bar')).toEqual({ pattern: 'foo' });
  });

  it('-h / --help 置 showHelp 且不污染 options', () => {
    expect(parseGrepArgs('-h')).toEqual({ options: {}, showHelp: true });
    expect(parseGrepArgs('--help foo')).toEqual({
      options: { pattern: 'foo' },
      showHelp: true,
    });
  });
});

describe('parseGrepArgs 短标志', () => {
  it('-i / -n 布尔开关', () => {
    expect(opts('-i foo')).toEqual({
      caseInsensitive: true,
      pattern: 'foo',
    });
    expect(opts('-n foo')).toEqual({ showLineNumbers: true, pattern: 'foo' });
  });

  it('-C 带值取数；缺值/非数字时把下一个 token 当值吞掉（现状）', () => {
    expect(opts('-C 2 foo')).toEqual({ contextAround: 2, pattern: 'foo' });
    // 非数字：不写选项，但该 token 已被消费 ⇒ 无位置参数
    expect(opts('-C foo')).toEqual({});
  });

  it('-B / -A 带值取数；缺值同样吞 token 且不设置（与 -C 的回落不同）', () => {
    expect(opts('-B 1 -A 4 foo')).toEqual({
      contextBefore: 1,
      contextAfter: 4,
      pattern: 'foo',
    });
    expect(opts('-B foo')).toEqual({});
    expect(opts('-A foo')).toEqual({});
    expect(opts('-B x foo')).toEqual({ pattern: 'foo' });
  });

  it('负数视为开关而非值：-C -1 foo ⇒ 默认 3 且 -1 落位置参数', () => {
    expect(opts('-C -1 foo')).toEqual({
      contextAround: 3,
      pattern: '-1',
      searchPath: 'foo',
    });
  });

  it('未知短标志降级为位置参数', () => {
    expect(opts('-z foo')).toEqual({ pattern: '-z', searchPath: 'foo' });
    expect(opts('-abc foo')).toEqual({ pattern: '-abc', searchPath: 'foo' });
  });
});

describe('parseGrepArgs 长选项', () => {
  it('字符串类：searchPath / include / type', () => {
    expect(opts('--searchPath src foo')).toEqual({
      searchPath: 'src',
      pattern: 'foo',
    });
    expect(opts('--include *.ts foo')).toEqual({
      include: '*.ts',
      pattern: 'foo',
    });
    expect(opts('--type ts foo')).toEqual({ type: 'ts', pattern: 'foo' });
  });

  it('outputMode 仅接受三种合法值', () => {
    expect(opts('--outputMode count foo')).toEqual({
      outputMode: 'count',
      pattern: 'foo',
    });
    // 非法值：不写入，且该值被当作下一个 token 消费掉
    expect(opts('--outputMode bogus')).toEqual({});
  });

  it('数字类：headLimit / offset / contextBefore/After/Around', () => {
    expect(opts('--headLimit 50 --offset 100 foo')).toEqual({
      headLimit: 50,
      offset: 100,
      pattern: 'foo',
    });
    expect(
      opts('--contextBefore 1 --contextAfter 2 --contextAround 3 foo')
    ).toEqual({
      contextBefore: 1,
      contextAfter: 2,
      contextAround: 3,
      pattern: 'foo',
    });
    // 非法数字：写入 undefined（键存在），值 token 已被消费
    const bad = opts('--headLimit abc foo');
    expect('headLimit' in bad).toBe(true);
    expect(bad.headLimit).toBeUndefined();
    expect(bad.pattern).toBe('foo');
  });

  it('--context：带值取数；非数字则吞 token 且不设置', () => {
    expect(opts('--context 5 foo')).toEqual({
      contextAround: 5,
      pattern: 'foo',
    });
    expect(opts('--context foo')).toEqual({});
  });

  it('布尔类：显式 false/no 才关闭，其余为 true（无值形态会吞下一个 token）', () => {
    expect(opts('--multiline foo')).toEqual({ multiline: true });
    expect(opts('--caseInsensitive false foo')).toEqual({
      caseInsensitive: false,
      pattern: 'foo',
    });
    expect(opts('--showLineNumbers no foo')).toEqual({
      showLineNumbers: false,
      pattern: 'foo',
    });
    expect(opts('--caseInsensitive true foo')).toEqual({
      caseInsensitive: true,
      pattern: 'foo',
    });
  });

  it('未知长选项降级为位置参数', () => {
    expect(opts('--bogus foo')).toEqual({
      pattern: '--bogus',
      searchPath: 'foo',
    });
  });
});
