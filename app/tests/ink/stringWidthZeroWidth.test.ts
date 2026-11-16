// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// 零宽码点判定特征化（P3-2，2026-11-16）
//
// `isZeroWidth` 决定终端宽度累加时是否跳过该码点，判错只表现为「布局偏移一格」
// （不报错、不回退）⇒ 外移各码点族前先用本表把每个族的**两端边界**与族外邻居钉住。
import { describe, expect, it } from 'bun:test';
import { isZeroWidth } from '../../src/ink/ink/stringWidth';

const zero = (cp: number) => expect(isZeroWidth(cp)).toBe(true);
const wide = (cp: number) => expect(isZeroWidth(cp)).toBe(false);

describe('isZeroWidth 快速通道', () => {
  it('ASCII 可打印区间 [0x20, 0x7f) 一律非零宽', () => {
    wide(0x20);
    wide(0x41);
    wide(0x7e);
  });

  it('[0xa0, 0x300) 仅软连字符 U+00AD 视为零宽', () => {
    wide(0xa0);
    zero(0x00ad);
    wide(0x2ff);
  });
});

describe('isZeroWidth 控制字符', () => {
  it('C0 与 DEL/C1 区间为零宽', () => {
    zero(0x00);
    zero(0x0a);
    zero(0x1f);
    zero(0x7f);
    zero(0x80);
    zero(0x9f);
  });
});

describe('isZeroWidth 零宽与不可见格式字符', () => {
  it('ZWSP/ZWNJ/ZWJ、BOM、word joiner 族', () => {
    zero(0x200b);
    zero(0x200c);
    zero(0x200d);
    zero(0xfeff);
    zero(0x2060);
    zero(0x2064);
  });

  it('族外邻居不误判', () => {
    wide(0x200e);
    wide(0x2065);
  });
});

describe('isZeroWidth 变体选择符', () => {
  it('VS1–VS16 与 VS17–VS256 区间为零宽', () => {
    zero(0xfe00);
    zero(0xfe0f);
    zero(0xe0100);
    zero(0xe01ef);
  });

  it('区间外不误判', () => {
    wide(0xfdfd);
    wide(0xe01f0);
  });
});

describe('isZeroWidth 组合附加符', () => {
  it('五段组合符区间各自两端为零宽', () => {
    zero(0x0300);
    zero(0x036f);
    zero(0x1ab0);
    zero(0x1aff);
    zero(0x1dc0);
    zero(0x1dff);
    zero(0x20d0);
    zero(0x20ff);
    zero(0xfe20);
    zero(0xfe2f);
  });

  it('组合符区间之间与之外不误判', () => {
    wide(0x0370);
    wide(0x1b00);
    wide(0x2100);
    wide(0xfe30);
  });
});

describe('isZeroWidth 印度系文字组合符号', () => {
  it('按块内偏移判定：块首符号、元音符、重音符、元音符号', () => {
    zero(0x0900); // 偏移 0x00：块首符号
    zero(0x0903); // 偏移 0x03：块首符号上界
    zero(0x093a); // 偏移 0x3a：元音符下界
    zero(0x094f); // 偏移 0x4f：virama 上界
    zero(0x0951); // 偏移 0x51：重音符下界
    zero(0x0957); // 偏移 0x57：重音符上界
    zero(0x0962); // 偏移 0x62：元音符号下界
    zero(0x0963); // 偏移 0x63：元音符号上界
    zero(0x0980); // 孟加拉块首，偏移同样是 0x00
  });

  it('偏移空档与区间外一律非零宽', () => {
    wide(0x0904);
    wide(0x0939);
    wide(0x0950);
    wide(0x0958);
    wide(0x0964);
    wide(0x0d50);
  });
});

describe('isZeroWidth 泰文/老挝文组合符', () => {
  it('泰文 MAI HAN-AKAT、元音符号、声调符号', () => {
    zero(0x0e31);
    zero(0x0e34);
    zero(0x0e3a);
    zero(0x0e47);
    zero(0x0e4e);
  });

  it('间距元音 SARA AA / SARA AM 宽度为 1，不算零宽', () => {
    wide(0x0e32);
    wide(0x0e33);
  });

  it('老挝文同构区间与族外邻居', () => {
    zero(0x0eb1);
    zero(0x0eb4);
    zero(0x0ebc);
    zero(0x0ec8);
    zero(0x0ecd);
    wide(0x0eb2);
    wide(0x0ebd);
    wide(0x0ece);
  });
});

describe('isZeroWidth 阿拉伯文格式符', () => {
  it('阿拉伯数字符号族与独点格式符', () => {
    zero(0x0600);
    zero(0x0605);
    zero(0x06dd);
    zero(0x070f);
    zero(0x08e2);
  });

  it('族外邻居不误判', () => {
    wide(0x0606);
    wide(0x06de);
  });
});

describe('isZeroWidth 代理项与标签字符', () => {
  it('代理项区间与标签字符区间为零宽', () => {
    zero(0xd800);
    zero(0xdfff);
    zero(0xe0000);
    zero(0xe007f);
  });

  it('相邻区间外不误判', () => {
    wide(0xd7ff);
    wide(0xe0080);
  });
});

describe('isZeroWidth 默认路径', () => {
  it('常规表意文字与 emoji 非零宽（宽度由 eastAsianWidth 决定）', () => {
    wide(0x4e00);
    wide(0x1f600);
  });
});
