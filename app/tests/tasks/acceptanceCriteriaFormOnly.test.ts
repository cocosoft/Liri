// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * PR-5（2026-10-23）：验收标准「仅形式命中」检测回归锁。
 *
 * 背景（方案 §3.10.5 R5）：真机 step_8 只写「grep 命中 ≥1 行」—— 全篇【待补充】的骨架稿
 * 也能满足（score 72 仍 escalate，靠目标级评估兜底）。
 *
 * 口径：**保守** —— 只有整条都只是形式条件、且不含任何具体内容判据时才命中；
 * 一旦写了引号文本 / "包含/等于/字段"等，就视为内容判据（不误杀）。
 */

import { describe, it, expect } from 'bun:test';
import { findFormOnlyCriteria } from '@openliri/kernel/successCriteria.js';

describe('PR-5：findFormOnlyCriteria', () => {
  it('只要求"检索命中条数" ⇒ 命中', () => {
    expect(
      findFormOnlyCriteria(['使用 grep 在 docs/ 下命中 ≥1 行'])
    ).toHaveLength(1);
    expect(findFormOnlyCriteria(['grep 匹配 2 条'])).toHaveLength(1);
  });

  it('只要求"非空 / 退出码 0 / 文件存在" ⇒ 命中', () => {
    expect(findFormOnlyCriteria(['命令输出非空'])).toHaveLength(1);
    expect(findFormOnlyCriteria(['退出码为 0'])).toHaveLength(1);
    expect(findFormOnlyCriteria(['产物文件存在'])).toHaveLength(1);
  });

  it('含具体内容判据（引号文本 / 包含 / 等于）⇒ 不命中', () => {
    expect(
      findFormOnlyCriteria(['grep 在 docs/prd.md 中命中 "## 概述"'])
    ).toHaveLength(0);
    expect(
      findFormOnlyCriteria(['file_read 返回内容包含 "## 验收"'])
    ).toHaveLength(0);
    expect(findFormOnlyCriteria(['文件存在且内容等于 "hello"'])).toHaveLength(
      0
    );
  });

  it('与形式条件无关的正常条目 ⇒ 不命中', () => {
    expect(
      findFormOnlyCriteria([
        'file_read 读取 prd.md 的字段列表包含 概述、目标、验收',
      ])
    ).toHaveLength(0);
    expect(findFormOnlyCriteria([''])).toHaveLength(0);
  });

  it('混合列表 ⇒ 只返回形式化的那些', () => {
    const offending = findFormOnlyCriteria([
      'grep 命中 ≥1 行',
      'file_read 返回内容包含 "## 概述"',
      '输出非空',
    ]);
    expect(offending).toHaveLength(2);
    expect(offending[0]).toContain('grep');
    expect(offending[1]).toContain('非空');
  });
});
