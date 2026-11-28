// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `repairModelJson` 的**可诊断性 + 日志分级**（2026-11-05，《运行态问题排查与修复方案》其它观察）。
 *
 * 真机实证（15Z）：`[repairModelJson:check] first pass needed`、`[…:escapeFix] second pass needed`、
 * `[…:pathFix] all passes failed` **各 20 条/小时**，且终态只有 `context:{originalType:"object"}`
 * ⇒ 事后无法定位是哪段输出、哪个长度。两处修正：
 *   ① 中间步骤是**修复过程**（后续通常修好），降 debug；只有终态失败才是 error；
 *   ② 终态带 `rawLength` / `rawPreview`（≤200 字符）/ `lastParseError`。
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { repairModelJson } from '@openliri/infra/utils/json';
import {
  describeMissingRequiredParams,
  withArgParseError,
} from '@openliri/infra/utils/toolContract/argParseError';

const SRC = readFileSync(
  new URL('../../../packages/infra/src/utils/json.ts', import.meta.url),
  'utf8'
);

describe('repairModelJson：修复语义不变', () => {
  it('合法 JSON ⇒ 原样返回（不进修复链）', () => {
    const ok = '{"a":1}';
    expect(repairModelJson(ok)).toBe(ok);
  });

  it('Windows 单反斜杠路径 ⇒ 修好且可解析', () => {
    const broken = '{"file_path":"E:\\PY\\CODES\\a.txt"}';
    const fixed = repairModelJson(broken);
    expect(() => JSON.parse(fixed)).not.toThrow();
    const parsed = JSON.parse(fixed) as { file_path: string };
    expect(parsed.file_path).toContain('PY');
  });

  it('修不好 ⇒ 返回原串（调用方按原样处理，不吞错）', () => {
    const hopeless = '{"a": ';
    expect(repairModelJson(hopeless)).toBe(hopeless);
  });

  // 2026-11-20：真机 `repairModelJson:pathFix` 记录指向 `Invalid unicode escape` 类失败
  it('不完整 \\u 转义 ⇒ 双写为字面量，不再永久失败', () => {
    const broken = '{"a":"\\u12"}';
    const fixed = repairModelJson(broken);
    expect(() => JSON.parse(fixed)).not.toThrow();
    expect((JSON.parse(fixed) as { a: string }).a).toBe('\\u12');
  });

  it('合法 \\uXXXX 不被改写', () => {
    const ok = '{"a":"\\u0041"}';
    expect(repairModelJson(ok)).toBe(ok);
  });
});

/**
 * 2026-11-28 真机（`session_mwz477wj251057474e`，10760 字符 SVG 写入）：
 * `repairModelJson:pathFix all passes failed`，`lastParseError = Invalid escape character P`。
 *
 * 根因：旧实现逐字符判断「`\` 后是否合法」，对**已正确双写**的 `\\P`（`"E:\\PY\\…"`）
 * 会把第二个 `\` 判成非法再双写 ⇒ `\\\P` ⇒ 自己把能修的串改坏。
 */
describe('repairModelJson：成对反斜杠不得被二次破坏', () => {
  it('已双写的 \\\\ 后跟字母 ⇒ 路径语义原样保留', () => {
    // 字面内容：{"p":"E:\\PY\\a.txt","x":"\P"} —— 路径合法、`\P` 非法
    const broken = '{"p":"E:\\\\PY\\\\a.txt","x":"\\P"}';
    const fixed = repairModelJson(broken);
    expect(() => JSON.parse(fixed)).not.toThrow();
    const parsed = JSON.parse(fixed) as { p: string; x: string };
    expect(parsed.p).toBe('E:\\PY\\a.txt');
    expect(parsed.x).toBe('\\P');
    // 合法部分**逐字**保留（两处双写仍在，未被改成三反斜杠）
    expect(fixed).toContain('E:\\\\PY\\\\a.txt');
  });

  it('大参数（与真机同量级）同样可修', () => {
    const path = 'E:\\\\PY\\\\Documents\\\\CODES\\\\PY_APP\\\\output\\\\p.svg';
    const body = 'x'.repeat(9000);
    const broken = `{"file_path":"${path}","content":"${body}","bad":"\\P"}`;
    const fixed = repairModelJson(broken);
    expect(() => JSON.parse(fixed)).not.toThrow();
    const parsed = JSON.parse(fixed) as { file_path: string };
    // 解析后回到**单反斜杠**语义（`\\` 是 JSON 转义，不是三个反斜杠）
    expect(parsed.file_path).toBe(
      'E:\\PY\\Documents\\CODES\\PY_APP\\output\\p.svg'
    );
  });

  /**
   * 2026-11-28 续修：大参数（万级字符）的**第二大失败形态** —— 字符串内裸控制字符。
   * 模型写多行 SVG 时直接把换行写进 `content`，`JSON.parse` 报
   * `Bad control character in string literal`，此前三遍修复都不处理它。
   */
  it('字符串内裸换行 ⇒ 转成 \\n 后可解析（内容语义不变）', () => {
    const broken = [
      '{"file_path":"E:\\\\PY\\\\output\\\\p.svg","content":"<svg>',
      '  <rect x=\\"1\\"/>',
      '</svg>","bad":"\\P"}',
    ].join('\n');
    const fixed = repairModelJson(broken);
    expect(() => JSON.parse(fixed)).not.toThrow();
    const parsed = JSON.parse(fixed) as { content: string };
    expect(parsed.content).toBe('<svg>\n  <rect x="1"/>\n</svg>');
  });

  it('结构区的美化换行不受影响', () => {
    const pretty = '{\n  "a": 1,\n  "b": "x\ty"\n}';
    const fixed = repairModelJson(pretty);
    expect(fixed).toContain('\n  "a": 1'); // 结构区换行保留
    expect(JSON.parse(fixed)).toEqual({ a: 1, b: 'x\ty' }); // 字符串内制表符被转义
  });

  it('输出被截断 ⇒ 不补全（返回原串，由调用方重发）', () => {
    const truncated = '{"file_path":"E:\\\\PY\\\\a.svg","content":"<svg><rect';
    expect(repairModelJson(truncated)).toBe(truncated);
  });
});

/**
 * 2026-11-28：`rawLength` 只能说明"很大"，区分不出「输出没写完」与「转义写坏」。
 * 两者给模型的正确动作不同（分段重发 vs 修正转义后重发），文案必须分档，
 * 否则模型会对已完整的串反复原样重试（真机 10760 字符参数）。
 */
describe('参数解析失败建议：按截断 / 转义损坏分档', () => {
  const build = (info?: { truncated: boolean }) =>
    describeMissingRequiredParams(
      withArgParseError({ rawLength: 10760, ...info }),
      ['file_path'],
      ['file_path', 'content']
    );

  it('truncated=true ⇒ 指引分段写入', () => {
    expect(build({ truncated: true }).systemContent).toContain('分段');
  });

  it('truncated=false ⇒ 指引修正转义，不再误导分段', () => {
    const out = build({ truncated: false }).systemContent;
    expect(out).toContain('串是完整的');
    expect(out).toContain('转义');
    expect(out).not.toContain('达到上限被截断');
  });

  it('缺省 truncated（旧落盘记录）⇒ 保守按可能截断处理', () => {
    expect(build().systemContent).toContain('单次输出');
  });
});

describe('repairModelJson：日志分级与终态诊断字段', () => {
  it('终态失败必须带长度 / 前缀 / 最后一次解析错误', () => {
    expect(SRC).toContain('rawLength: raw.length');
    expect(SRC).toContain(
      'rawPreview: raw.slice(0, JSON_REPAIR_PREVIEW_CHARS)'
    );
    expect(SRC).toContain('lastParseError: messageOf(error)');
    // 预览长度有常量上限，不得整段灌日志
    expect(SRC).toContain('const JSON_REPAIR_PREVIEW_CHARS = 200;');
  });

  it('中间两步不再走 handleError（否则一次失败刷 3 条 error）', () => {
    expect(SRC).not.toContain("'JSON repair: first pass needed'");
    expect(SRC).not.toContain("'JSON repair: second pass needed'");
    // 只有终态保留一条 error
    const handleErrorCalls = SRC.match(/handleError\(/g) ?? [];
    expect(handleErrorCalls.length).toBe(2); // jsonParse 一处 + 终态一处
    expect(SRC).toContain(
      "logger.debug('repairModelJson: 首轮解析失败，进入修复'"
    );
    expect(SRC).toContain(
      "logger.debug('repairModelJson: 转义修复后仍不可解析，进入路径修复'"
    );
  });
});
