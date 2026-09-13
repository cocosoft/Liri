/**
 * SkillHotReloader 技能热重载（T3.2）测试
 *
 * 对齐方案 T3.2 验收标准：
 * 1. 内容未变（touch）不触发重载（哈希比较 + debounce）
 * 2. schema 校验失败回滚旧定义并上报（保留旧定义）
 * 3. 正常变更热生效
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { SkillHotReloader } from '../hotreload/SkillHotReloader.js';

describe('SkillHotReloader（T3.2）', () => {
  let dir: string;
  let skillFile: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'skill-hotreload-' + randomUUID()));
    skillFile = join(dir, 'SKILL.md');
    writeFileSync(skillFile, '# demo\n内容', 'utf-8');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('内容未变（touch 同内容）不触发重载', async () => {
    const reloader = new SkillHotReloader();
    let reloads = 0;
    reloader.setHandler(() => {
      reloads++;
      return { valid: true, errors: [] };
    });
    // 记录基线
    reloader.seedBaseline([skillFile]);

    // 同内容重写（touch）→ 哈希未变 → 跳过
    writeFileSync(skillFile, '# demo\n内容', 'utf-8');
    const result = await reloader.reloadFile(skillFile);
    expect(result).toBeNull();
    expect(reloads).toBe(0);
  });

  test('正常变更热生效', async () => {
    const reloader = new SkillHotReloader();
    let reloads = 0;
    let loadedContent = '';
    reloader.setHandler(({ content }) => {
      reloads++;
      loadedContent = content;
      return { valid: true, errors: [] };
    });
    reloader.seedBaseline([skillFile]);

    writeFileSync(skillFile, '# demo v2\n新内容', 'utf-8');
    const result = await reloader.reloadFile(skillFile);
    expect(result).toEqual({ valid: true, errors: [] });
    expect(reloads).toBe(1);
    expect(loadedContent).toContain('v2');
  });

  test('schema 校验失败 → 保留旧定义（回滚）并上报', async () => {
    const reloader = new SkillHotReloader();
    let reloads = 0;
    reloader.setHandler(() => {
      reloads++;
      return { valid: false, errors: ['name is required'] };
    });
    reloader.seedBaseline([skillFile]);

    writeFileSync(skillFile, '# broken\n', 'utf-8');
    const result = await reloader.reloadFile(skillFile);
    expect(result).toEqual({ valid: false, errors: ['name is required'] });
    expect(reloads).toBe(1);
  });

  test('handler 抛错 → 保守拒绝（保留旧定义）', async () => {
    const reloader = new SkillHotReloader();
    reloader.setHandler(() => {
      throw new Error('解析崩溃');
    });
    reloader.seedBaseline([skillFile]);

    writeFileSync(skillFile, '# v2\n', 'utf-8');
    const result = await reloader.reloadFile(skillFile);
    expect(result?.valid).toBe(false);
    expect(result?.errors[0]).toContain('解析崩溃');
  });

  test('文件不可读 → 返回失败且不触发 handler', async () => {
    const reloader = new SkillHotReloader();
    let reloads = 0;
    reloader.setHandler(() => {
      reloads++;
      return { valid: true, errors: [] };
    });

    const result = await reloader.reloadFile(join(dir, 'missing.md'));
    expect(result?.valid).toBe(false);
    expect(reloads).toBe(0);
  });
});
