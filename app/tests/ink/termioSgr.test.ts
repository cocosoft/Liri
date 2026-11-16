// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// SGR 参数表特征化（P3-2，2026-11-16）
//
// `applySGR` 是一张「参数码 → TextStyle 字段」的映射表，漏项只会静默跳过（不回退、不报错）
// ⇒ 外移扩展色段前先用本表把每条码、分号/冒号两种写法与未知码兜底钉住。
import { describe, expect, it } from 'bun:test';
import { applySGR } from '../../src/ink/ink/termio/sgr';
import { defaultStyle, type TextStyle } from '../../src/ink/ink/termio/types';

const sgr = (paramStr: string, base: TextStyle = defaultStyle()) =>
  applySGR(paramStr, base);

describe('applySGR 属性码', () => {
  it('0 重置为默认样式（清掉既有属性）', () => {
    const bold = sgr('1');
    expect(bold.bold).toBe(true);
    expect(sgr('0', bold).bold).toBe(false);
    expect(sgr('', bold).bold).toBe(false);
  });

  it('开关成对：粗/暗/斜/闪烁/反显/隐藏/删除线/上划线', () => {
    expect(sgr('2').dim).toBe(true);
    expect(sgr('3').italic).toBe(true);
    expect(sgr('5').blink).toBe(true);
    expect(sgr('6').blink).toBe(true);
    expect(sgr('7').inverse).toBe(true);
    expect(sgr('8').hidden).toBe(true);
    expect(sgr('9').strikethrough).toBe(true);
    expect(sgr('53').overline).toBe(true);

    expect(sgr('22').dim).toBe(false);
    expect(sgr('23').italic).toBe(false);
    expect(sgr('25').blink).toBe(false);
    expect(sgr('27').inverse).toBe(false);
    expect(sgr('28').hidden).toBe(false);
    expect(sgr('29').strikethrough).toBe(false);
    expect(sgr('55').overline).toBe(false);
  });

  it('22 同时清粗体与变暗', () => {
    const both = sgr('1;2');
    expect(both.bold).toBe(true);
    expect(both.dim).toBe(true);
    const cleared = sgr('22', both);
    expect(cleared.bold).toBe(false);
    expect(cleared.dim).toBe(false);
  });

  it('下划线：4 单线、4:3 曲线（冒号子参数）、21 双线、24 取消', () => {
    expect(sgr('4').underline).toBe('single');
    expect(sgr('4:3').underline).toBe('curly');
    expect(sgr('4:9').underline).toBe('single');
    expect(sgr('21').underline).toBe('double');
    expect(sgr('24').underline).toBe('none');
  });
});

describe('applySGR 颜色码', () => {
  it('命名色：前景 30–37 / 背景 40–47 / 亮色 90–97 与 100–107', () => {
    expect(sgr('31').fg).toEqual({ type: 'named', name: 'red' });
    expect(sgr('44').bg).toEqual({ type: 'named', name: 'blue' });
    expect(sgr('91').fg).toEqual({ type: 'named', name: 'brightRed' });
    expect(sgr('104').bg).toEqual({ type: 'named', name: 'brightBlue' });
  });

  it('默认色：39 前景、49 背景、59 下划线色', () => {
    expect(sgr('39').fg).toEqual({ type: 'default' });
    expect(sgr('49').bg).toEqual({ type: 'default' });
    expect(sgr('59').underlineColor).toEqual({ type: 'default' });
  });

  it('256 色（分号写法）：38/48/58 各归其位，各前进 3 个参数', () => {
    expect(sgr('38;5;196').fg).toEqual({ type: 'indexed', index: 196 });
    expect(sgr('48;5;21').bg).toEqual({ type: 'indexed', index: 21 });
    expect(sgr('58;5;9').underlineColor).toEqual({
      type: 'indexed',
      index: 9,
    });
    // 后续参数继续生效（证明前进量正确）
    expect(sgr('38;5;196;1').bold).toBe(true);
  });

  it('真彩色（分号写法）：38;2;r;g;b 前进 5 个参数', () => {
    expect(sgr('38;2;1;2;3').fg).toEqual({ type: 'rgb', r: 1, g: 2, b: 3 });
    expect(sgr('48;2;4;5;6').bg).toEqual({ type: 'rgb', r: 4, g: 5, b: 6 });
    expect(sgr('38;2;1;2;3;4').underline).toBe('single');
  });

  it('冒号写法：子参数内联，仅前进 1 个参数', () => {
    expect(sgr('38:5:196').fg).toEqual({ type: 'indexed', index: 196 });
    expect(sgr('38:2:1:2:3').fg).toEqual({ type: 'rgb', r: 1, g: 2, b: 3 });
    // 尾随参数仍被处理
    expect(sgr('38:5:196;4').underline).toBe('single');
  });

  it('残缺扩展色不生效（无参数/缺分量）且不越界', () => {
    expect(sgr('38').fg).toEqual(defaultStyle().fg);
    expect(sgr('48;5').bg).toEqual(defaultStyle().bg);
    expect(sgr('38;2;1;2').fg).toEqual(defaultStyle().fg);
  });

  it('未知码静默跳过，不影响其它码', () => {
    const style = sgr('1000;1');
    expect(style.bold).toBe(true);
    expect(sgr('1000')).toEqual(defaultStyle());
  });
});
