/**
 * 不可见 Unicode **单一事实源** 回归守卫（2026-10-07，spec `guardrails-dual-side.md` D9=a）
 *
 * 背景：归并前存在**三处独立实现** —— `UnicodeSanitizer` 与 `PromptInjectionDetector` 的同名表
 * （逐字相同的 17 项），以及 `chronos/CronInjectionScanner` 的 `INVISIBLE_CHARS` 正则
 * （覆盖 `200B–200F` / `202A–202E` / `2060–2069` / `FEFF`，**不覆盖** `00AD/3164/2800/FFFC`）。
 * 本批归并为**并集**单一事实源（`security/injection/UnicodeSanitizer`）。
 *
 * 本守卫锁三件事：
 *   ① 共享助手（`isInvisibleCodePoint`/`containsInvisibleChars`/`countInvisibleChars`）对**并集**码点判定为真；
 *   ② **原三份实现各自的正例仍成立**（`200B` 等，行为不回退）；
 *   ③ **并集新增面**（`00AD`/`3164`/`2800`/`FFFC` 与 `2065–2069`）在两侧消费者（`CronInjectionScanner` /
 *      `UnicodeSanitizer` / `PromptInjectionDetector`）上**均已生效** —— 如实锁定本次行为变化。
 */
import { describe, expect, it } from 'bun:test';

import {
  INVISIBLE_UNICODE_RANGES,
  PromptInjectionDetector,
  UnicodeSanitizer,
  containsInvisibleChars,
  countInvisibleChars,
  isInvisibleCodePoint,
} from '../../src/security';
import { CronInjectionScanner } from '../../src/chronos/CronInjectionScanner';

/** 并集码点（原表 / 原正则各取代表 + 并集新增侧） */
const UNION_CODE_POINTS: number[] = [
  0x200b,
  0x200f,
  0x202e,
  0x2060,
  0xfeff, // 原表 ∩ 原正则
  0x00ad,
  0x3164,
  0x2800,
  0xfffc, // 原表独有（原 Cron 正则不覆盖）
  0x2066,
  0x2069, // 原正则独有（原表原为 2061–2064）
];

describe('不可见 Unicode 单一事实源（guardrails-dual-side D9=a）', () => {
  it('表为并集：17 项，且 Invisible Separator 由 2061–2064 扩为 2061–2069', () => {
    expect(INVISIBLE_UNICODE_RANGES.length).toBe(17);
    const sep = INVISIBLE_UNICODE_RANGES.find(
      (r) => r.name === 'Invisible Separator'
    );
    expect(sep?.start).toBe(0x2061);
    expect(sep?.end).toBe(0x2069);
  });

  it('isInvisibleCodePoint / containsInvisibleChars 覆盖并集全部码点', () => {
    for (const cp of UNION_CODE_POINTS) {
      expect(isInvisibleCodePoint(cp)).toBe(true);
      expect(containsInvisibleChars(`x${String.fromCharCode(cp)}y`)).toBe(true);
    }
  });

  it('负例：普通字符与非表内 Unicode 不误判', () => {
    expect(isInvisibleCodePoint(0x61 /* a */)).toBe(false);
    expect(isInvisibleCodePoint(0x2000 /* EN QUAD，非表内 */)).toBe(false);
    expect(containsInvisibleChars('plain text')).toBe(false);
    expect(containsInvisibleChars('')).toBe(false);
    expect(countInvisibleChars('')).toBe(0);
  });

  it('countInvisibleChars 逐字符计数', () => {
    expect(countInvisibleChars('\u200B\u200B\uFEFF')).toBe(3);
    expect(countInvisibleChars('a\u2066b')).toBe(1);
  });

  it('UnicodeSanitizer 移除「既有正例」(200B) 与「并集新增面」(2066 LRI)', () => {
    const sanitizer = new UnicodeSanitizer();
    expect(sanitizer.sanitize('A\u200BB').output).toBe('AB');
    expect(sanitizer.sanitize('A\u2066B').output).toBe('AB');
  });

  it('PromptInjectionDetector.scanInvisibleChars 检出「既有」与「并集新增面」', () => {
    const detector = new PromptInjectionDetector();
    expect(detector.scanInvisibleChars('A\u200BB')).toHaveLength(1);
    const lri = detector.scanInvisibleChars('A\u2066B');
    expect(lri).toHaveLength(1);
    expect(lri[0].codePoint).toBe(0x2066);
  });

  it('CronInjectionScanner：既有正例(200B) 与并集新增面(00AD/FFFC) 均判不安全，威胁文案逐字不变', () => {
    const scanner = new CronInjectionScanner();

    const zwsp = scanner.scan('safe text with \u200Bzero-width space\u200B');
    expect(zwsp.safe).toBe(false);
    expect(zwsp.threats.some((t) => t.name === 'invisible_unicode')).toBe(true);

    // 并集新增面：原 Cron 正则不覆盖 00AD / FFFC ⇒ 归并后应被检出（行为更严，如实锁定）
    for (const cp of [0x00ad, 0xfffc]) {
      const r = scanner.scan(`x${String.fromCharCode(cp)}y`);
      expect(r.safe).toBe(false);
      const threat = r.threats.find((t) => t.name === 'invisible_unicode');
      expect(threat).toBeDefined();
      expect(threat?.match).toBe('1 chars');
      expect(threat?.description).toContain('potential contrast attack');
    }
  });
});
