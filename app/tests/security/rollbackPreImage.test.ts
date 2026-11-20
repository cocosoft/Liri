// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 回滚 pre-image 备份（2026-11-21，P1：`/rewind` 报成功但内容不恢复）
 *
 * 背景（本机实证）：快照 `totalSize:0` + `backups/` 空目录 —— `changedFiles[].backupPath`
 * 全仓无人填（唯一写入口只传 `{path,type,toolName}`），而 `UndoManager` 恢复
 * `modified/deleted` 的判据正是 `change.backupPath && existsSync(...)` ⇒ 静默跳过，
 * 且 `success = failures.length === 0` ⇒ **报成功但文件内容不恢复**。
 *
 * 本组钉住修复后的端到端语义（真 fs、真快照、真 undo，不用 mock）：
 *  ① `modified`：写入前备份 ⇒ 快照 `totalSize > 0`、undo 真正恢复轮初内容；
 *  ② 同轮同路径多次写 ⇒ 只保留**第一次**的 pre-image（undo 回到轮初，不是中间态）；
 *  ③ 源文件不存在（`file_write` 新建）⇒ 记为 `created`，undo 删除该文件（而不是静默不动作）。
 *
 * 隔离：`LIRI_HOME` 指向临时目录（快照根 = `<home>/data/snapshots`），跑完还原。
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RollbackIntegration } from '@openliri/infra/security';

let home = '';
let savedHome: string | undefined;
let ws = '';

beforeAll(() => {
  savedHome = process.env['LIRI_HOME'];
  home = mkdtempSync(join(tmpdir(), 'liri-rollback-pre-'));
  process.env['LIRI_HOME'] = home;
  ws = join(home, 'ws');
  mkdirSync(ws, { recursive: true });
});

afterAll(() => {
  if (savedHome === undefined) delete process.env['LIRI_HOME'];
  else process.env['LIRI_HOME'] = savedHome;
  rmSync(home, { recursive: true, force: true });
});

describe('回滚 pre-image 备份（工具写入前）', () => {
  it('① modified ⇒ 快照 totalSize > 0 且 undo 恢复轮初内容', async () => {
    const sid = `s-preimg-mod-${Date.now()}`;
    const file = join(ws, 'a.txt');
    writeFileSync(file, 'v1', 'utf8');

    const integ = new RollbackIntegration(sid);
    await integ.onRoundStart(sid, 1, [ws]);
    await integ.onToolBeforeExecute({
      path: file,
      type: 'modified',
      toolName: 'file_edit',
    });
    // 工具"执行"：写入新内容
    writeFileSync(file, 'v2', 'utf8');

    const snap = await integ.onRoundEnd('改文件');
    expect(snap).not.toBeNull();
    const change = snap!.changedFiles.find((c) => c.path === file);
    expect(change?.backupPath).toBeTruthy();
    // 备份内容必须是**轮初**（改前）内容
    expect(readFileSync(change!.backupPath!, 'utf8')).toBe('v1');
    expect(snap!.totalSize).toBeGreaterThan(0);

    const res = await integ.undoRound(1);
    expect(res.success).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe('v1');
  });

  it('② 同轮同路径两次写 ⇒ pre-image 仍是轮初内容（不覆盖）', async () => {
    const sid = `s-preimg-dedupe-${Date.now()}`;
    const file = join(ws, 'b.txt');
    writeFileSync(file, 'round-start', 'utf8');

    const integ = new RollbackIntegration(sid);
    await integ.onRoundStart(sid, 1, [ws]);
    await integ.onToolBeforeExecute({
      path: file,
      type: 'modified',
      toolName: 'file_write',
    });
    writeFileSync(file, 'v2', 'utf8');
    await integ.onToolBeforeExecute({
      path: file,
      type: 'modified',
      toolName: 'file_edit',
    });
    writeFileSync(file, 'v3', 'utf8');

    const snap = await integ.onRoundEnd('两次改');
    const change = snap!.changedFiles.find((c) => c.path === file);
    expect(readFileSync(change!.backupPath!, 'utf8')).toBe('round-start');

    const res = await integ.undoRound(1);
    expect(res.success).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe('round-start');
  });

  it('③ 源文件不存在（新建）⇒ 记 created，undo 删除该文件', async () => {
    const sid = `s-preimg-created-${Date.now()}`;
    const file = join(ws, 'c.txt');

    const integ = new RollbackIntegration(sid);
    await integ.onRoundStart(sid, 1, [ws]);
    await integ.onToolBeforeExecute({
      path: file,
      type: 'modified',
      toolName: 'file_write',
    });
    writeFileSync(file, 'new', 'utf8');

    const snap = await integ.onRoundEnd('建文件');
    const change = snap!.changedFiles.find((c) => c.path === file);
    expect(change?.type).toBe('created');
    expect(change?.backupPath).toBeUndefined();

    const res = await integ.undoRound(1);
    expect(res.success).toBe(true);
    expect(existsSync(file)).toBe(false);
  });
});
