/**
 * G5（2026-11-14）：用户偏好统一入口回归锁。
 *
 * 口径：人读真源 = `~/.pyapp/USER.md` 的 `## 偏好` 小节（本命令读写）；
 * 机器记忆 = 既有 `USER_PREFERENCE`（只读聚合，删除走 MemoryManager，不新建存储）。
 *
 * 本文件锁：① 小节解析/追加/删除（纯函数）；② 命令 add/remove 真写 USER.md（临时 LIRI_HOME）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  addPreferenceLine,
  parsePreferenceLines,
  removePreferenceLines,
} from '@modules/commands/builtin/preferences/preferencesCore';

const BASE = ['# USER.md — 用户身份', '', '## 基本', '- 名字：小明', ''].join(
  '\n'
);

describe('G5：偏好小节纯函数', () => {
  it('无小节 ⇒ 追加时新建；再追加幂等（不重复写）', () => {
    const first = addPreferenceLine(BASE, '喜欢简洁回答');
    expect(first.added).toBe(true);
    expect(first.markdown).toContain('## 偏好');
    expect(first.markdown).toContain('- 喜欢简洁回答');
    // 原有内容不被破坏
    expect(first.markdown).toContain('- 名字：小明');

    const second = addPreferenceLine(first.markdown, '喜欢简洁回答');
    expect(second.added).toBe(false);
    expect(second.reason).toBe('duplicate');
    expect(second.markdown).toBe(first.markdown);
  });

  it('空文本 ⇒ 不写入（reason=empty）', () => {
    const result = addPreferenceLine(BASE, '   ');
    expect(result.added).toBe(false);
    expect(result.reason).toBe('empty');
  });

  it('解析只取本小节的项目符号；遇到下一个二级标题即止', () => {
    const md = ['## 偏好', '- A', '- B', '', '## 其他', '- 不属于偏好'].join(
      '\n'
    );
    expect(parsePreferenceLines(md)).toEqual(['A', 'B']);
  });

  it('删除按包含匹配（大小写不敏感）；返回被删正文', () => {
    let md = '## 偏好\n- 喜欢简洁回答\n- 喜欢深色主题\n';
    const removed = removePreferenceLines(md, '深色');
    expect(removed.removed).toEqual(['喜欢深色主题']);
    expect(parsePreferenceLines(removed.markdown)).toEqual(['喜欢简洁回答']);

    md = '## 偏好\n- 喜欢 TypeScript\n';
    const caseInsensitive = removePreferenceLines(md, 'typescript');
    expect(caseInsensitive.removed).toEqual(['喜欢 TypeScript']);
  });

  it('无小节 / 空匹配串 ⇒ 不删任何内容', () => {
    expect(removePreferenceLines('# 空文件\n', 'x').removed).toEqual([]);
    const md = '## 偏好\n- A\n';
    expect(removePreferenceLines(md, '  ').markdown).toBe(md);
  });
});

describe('G5：/preferences 命令（临时 LIRI_HOME）', () => {
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'liri-pref-'));
    process.env['LIRI_HOME'] = home;
  });

  afterEach(() => {
    delete process.env['LIRI_HOME'];
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('add 写 USER.md；重复 add 不重复写；remove 删除；未命中如实报错', async () => {
    const { default: cmd } =
      await import('@modules/commands/builtin/preferences/Preferences');
    const ctx = {} as never;
    const file = path.join(home, 'USER.md');

    const added = await cmd.execute('add 喜欢简洁回答', ctx);
    expect(added.success).toBe(true);
    expect(fs.readFileSync(file, 'utf-8')).toContain('- 喜欢简洁回答');

    const dup = await cmd.execute('add 喜欢简洁回答', ctx);
    expect(dup.success).toBe(true);
    expect(dup.message).toContain('已存在');
    expect(fs.readFileSync(file, 'utf-8').split('喜欢简洁回答')).toHaveLength(
      2
    );

    const removed = await cmd.execute('remove 简洁', ctx);
    expect(removed.success).toBe(true);
    expect(parsePreferenceLines(fs.readFileSync(file, 'utf-8'))).toEqual([]);

    const missing = await cmd.execute('remove 不存在的内容', ctx);
    expect(missing.success).toBe(false);
  });

  it('未知子命令 / 缺参数 ⇒ 报错并给出用法', async () => {
    const { default: cmd } =
      await import('@modules/commands/builtin/preferences/Preferences');
    const ctx = {} as never;

    const unknown = await cmd.execute('bogus', ctx);
    expect(unknown.success).toBe(false);
    expect(unknown.error).toContain('未知子命令');

    const noArg = await cmd.execute('add', ctx);
    expect(noArg.success).toBe(false);
    expect(noArg.error).toContain('用法');
  });
});
