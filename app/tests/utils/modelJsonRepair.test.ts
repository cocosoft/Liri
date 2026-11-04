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
