// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `repair-project-names`（#22，2026-10-30）
 *
 * 验收（issue 正文）：
 *  - 现有乱码项目名被修正，**项目 id 与关联会话不变**（只改 `name`）；
 *  - 默认 dry-run **零副作用**（文件字节不变）；
 *  - 落盘前备份，**不删除**任何内容；重复 `--apply` ⇒ 0 变更（幂等）。
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  applyProjectNameRepair,
  formatProjectNameRepair,
  planProjectNameRepair,
} from '../../scripts/repair-project-names';

const NOW = new Date(2026, 9, 30, 14, 5);
const GARBLED_PATH = '【E:\\PY\\Documents\\CODES\\PY_APP\\';
const GARBLED_INLINE = '我与gemini进行了一轮沟通，见【E:\\PY\\Docume';

let tmpRoot = '';
let projectsRoot = '';

function writeProject(
  id: string,
  name: string,
  extra: Record<string, unknown> = {}
): void {
  const dir = join(projectsRoot, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'project.json'),
    JSON.stringify(
      { id, name, description: 'desc', sandboxPath: `/tmp/${id}`, ...extra },
      null,
      2
    ),
    'utf8'
  );
}

function readProject(id: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(projectsRoot, id, 'project.json'), 'utf8')
  ) as Record<string, unknown>;
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'liri-repair-proj-'));
  projectsRoot = join(tmpRoot, 'projects');
  writeProject('proj_garbled_path', GARBLED_PATH);
  writeProject('proj_garbled_inline', GARBLED_INLINE);
  writeProject('proj_ok', '俄罗斯方块小游戏');
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('planProjectNameRepair', () => {
  test('只挑出需要修复的项目名，正常名不参与', () => {
    const plan = planProjectNameRepair(projectsRoot, NOW);
    expect(plan.map((p) => p.id).sort()).toEqual([
      'proj_garbled_inline',
      'proj_garbled_path',
    ]);
    // 路径形态 ⇒ 取目录名（与 create_project 的 FIX-11 口径一致）
    expect(plan.find((p) => p.id === 'proj_garbled_path')?.after).toBe(
      'PY_APP'
    );
    // 未闭合引用块 ⇒ 丢掉块内残余，不留悬空 `【`
    expect(plan.find((p) => p.id === 'proj_garbled_inline')?.after).toBe(
      '我与gemini进行了一轮沟通，见'
    );
  });

  test('dry-run：计划生成零副作用（文件字节不变）', () => {
    const before = readFileSync(
      join(projectsRoot, 'proj_garbled_path', 'project.json'),
      'utf8'
    );
    planProjectNameRepair(projectsRoot, NOW);
    const after = readFileSync(
      join(projectsRoot, 'proj_garbled_path', 'project.json'),
      'utf8'
    );
    expect(after).toBe(before);
  });

  test('坏 JSON 不参与修复（不写坏文件）', () => {
    mkdirSync(join(projectsRoot, 'proj_broken'), { recursive: true });
    const brokenFile = join(projectsRoot, 'proj_broken', 'project.json');
    writeFileSync(brokenFile, '{ not json', 'utf8');

    const plan = planProjectNameRepair(projectsRoot, NOW);

    expect(plan.some((p) => p.id === 'proj_broken')).toBe(false);
    expect(readFileSync(brokenFile, 'utf8')).toBe('{ not json');
  });

  test('目录不存在 ⇒ 空计划', () => {
    expect(planProjectNameRepair(join(tmpRoot, 'nope'), NOW)).toEqual([]);
  });
});

describe('applyProjectNameRepair', () => {
  test('只改 name，id/描述/沙箱路径不变，并留下备份', () => {
    const plan = planProjectNameRepair(projectsRoot, NOW);
    const result = applyProjectNameRepair(plan, '20261030T123000');

    expect(result.repaired).toBe(2);
    expect(result.backups).toHaveLength(2);

    const fixed = readProject('proj_garbled_path');
    expect(fixed.name).toBe('PY_APP');
    expect(fixed.id).toBe('proj_garbled_path');
    expect(fixed.description).toBe('desc');
    expect(fixed.sandboxPath).toBe('/tmp/proj_garbled_path');

    const backup = JSON.parse(
      readFileSync(
        join(
          projectsRoot,
          'proj_garbled_path',
          'project.json.bak-20261030T123000'
        ),
        'utf8'
      )
    ) as Record<string, unknown>;
    expect(backup.name).toBe(GARBLED_PATH);
    expect(
      existsSync(
        join(projectsRoot, 'proj_ok', 'project.json.bak-20261030T123000')
      )
    ).toBe(false);
  });

  test('幂等：再跑一次计划为空（0 变更）', () => {
    applyProjectNameRepair(planProjectNameRepair(projectsRoot, NOW), 'stamp-1');
    expect(planProjectNameRepair(projectsRoot, NOW)).toEqual([]);
    expect(formatProjectNameRepair([])).toEqual([
      '待修复项目名：0（已是目标状态）',
    ]);
  });
});
