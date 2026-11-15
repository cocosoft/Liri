// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P3-2（复杂度清理）：`colorize`（颜色值 → chalk 着色）的特征化锁（外移前先测）。
 *
 * 现状：颜色分派此前**没有回归锁**。它按 `ansi:` 命名色（前景/背景各一套）、
 * `#hex`、`ansi256(...)`、`rgb(...)` 四类分派，非法格式一律原样返回 —— 这些正是
 * 把 switch 改成查表时最容易错位的地方。
 *
 * 断言口径：把 `chalk.level` 提到 3 后与 chalk 自身输出逐字对照（同一库、同一 level，
 * 不依赖终端能力；测试结束后恢复原 level）。
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import chalk from 'chalk';
import { colorize } from '../../src/ink/ink/colorize.js';

const prevLevel = chalk.level;

beforeAll(() => {
  chalk.level = 3;
});

afterAll(() => {
  chalk.level = prevLevel;
});

/** `ansi:` 命名色（与实现支持的集合一致；前景/背景各一套） */
const NAMED_COLORS = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'blackBright',
  'redBright',
  'greenBright',
  'yellowBright',
  'blueBright',
  'magentaBright',
  'cyanBright',
  'whiteBright',
] as const;

type ChalkNamed = Record<string, (s: string) => string>;
const chalkNamed = chalk as unknown as ChalkNamed & Record<string, unknown>;

describe('colorize（P3-2 外移前特征化）', () => {
  it('未指定颜色 ⇒ 原样返回（不着色）', () => {
    expect(colorize('x', undefined, 'foreground')).toBe('x');
    expect(colorize('x', '', 'background')).toBe('x');
  });

  it('ansi: 命名色：前景与背景分别对应 chalk 的 fg / bg', () => {
    for (const name of NAMED_COLORS) {
      const fg = chalkNamed[name];
      const bg = chalkNamed[`bg${name[0].toUpperCase()}${name.slice(1)}`];
      expect(colorize('x', `ansi:${name}`, 'foreground')).toBe(fg('x'));
      expect(colorize('x', `ansi:${name}`, 'background')).toBe(bg('x'));
    }
  });

  it('ansi: 未知命名 ⇒ 原样返回（不误着色）', () => {
    expect(colorize('x', 'ansi:chartreuse', 'foreground')).toBe('x');
  });

  it('#hex：前景 hex / 背景 bgHex', () => {
    expect(colorize('x', '#ff0000', 'foreground')).toBe(
      chalk.hex('#ff0000')('x')
    );
    expect(colorize('x', '#00ff00', 'background')).toBe(
      chalk.bgHex('#00ff00')('x')
    );
  });

  it('ansi256(n)：前景 / 背景；非法格式 ⇒ 原样返回', () => {
    expect(colorize('x', 'ansi256(42)', 'foreground')).toBe(
      chalk.ansi256(42)('x')
    );
    expect(colorize('x', 'ansi256( 42 )', 'background')).toBe(
      chalk.bgAnsi256(42)('x')
    );
    expect(colorize('x', 'ansi256(abc)', 'foreground')).toBe('x');
  });

  it('rgb(r, g, b)：前景 / 背景；非法格式 ⇒ 原样返回', () => {
    expect(colorize('x', 'rgb(1, 2, 3)', 'foreground')).toBe(
      chalk.rgb(1, 2, 3)('x')
    );
    expect(colorize('x', 'rgb( 4,5,6 )', 'background')).toBe(
      chalk.bgRgb(4, 5, 6)('x')
    );
    expect(colorize('x', 'rgb(oops)', 'foreground')).toBe('x');
  });

  it('未知颜色格式 ⇒ 原样返回', () => {
    expect(colorize('x', 'hsl(1, 2, 3)', 'foreground')).toBe('x');
    expect(colorize('x', 'red', 'foreground')).toBe('x');
  });
});
