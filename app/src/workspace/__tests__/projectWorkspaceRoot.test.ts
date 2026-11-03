/**
 * P2（2026-11-03）：项目工作区根的**设置感知**解析入口
 *
 * 层级说明：优先级（`LIRI_PROJECTS_DIR` > 用户设置 `projectsDirectory` > 默认）的
 * 纯计算在 `@openliri/infra/environment`；本层只负责"把设置读出来传进去"，
 * 以避免 `environment` 反向依赖 `config`（`userSettings` 已依赖 `resolvePyappHome`）。
 *
 * 覆盖：
 * ① 无设置 ⇒ `~/Documents/LiriProjects`；
 * ② 有设置 ⇒ 用设置值；
 * ③ 环境变量优先于设置；
 * ④ 设置文件损坏 ⇒ 回落默认（不抛）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { setUserDataDirOverride } from '@openliri/infra/environment';
import {
  resolveProjectWorkspaceRoot,
  PROJECTS_DIRECTORY_SETTING_KEY,
} from '../projectWorkspaceRoot';

let home: string;
const originalProjectsDir = process.env.LIRI_PROJECTS_DIR;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'projects-root-'));
  setUserDataDirOverride(home);
  delete process.env.LIRI_PROJECTS_DIR;
});

afterEach(() => {
  setUserDataDirOverride(null);
  if (originalProjectsDir === undefined) delete process.env.LIRI_PROJECTS_DIR;
  else process.env.LIRI_PROJECTS_DIR = originalProjectsDir;
  rmSync(home, { recursive: true, force: true });
});

function writeSettings(value: unknown): void {
  writeFileSync(join(home, 'settings.json'), JSON.stringify(value), 'utf-8');
}

describe('resolveProjectWorkspaceRoot（P2）', () => {
  it('无设置 ⇒ ~/Documents/LiriProjects', () => {
    expect(resolveProjectWorkspaceRoot()).toBe(
      join(homedir(), 'Documents', 'LiriProjects')
    );
  });

  it('设置 projectsDirectory ⇒ 用设置值', () => {
    writeSettings({ [PROJECTS_DIRECTORY_SETTING_KEY]: '/custom/projects' });
    expect(resolveProjectWorkspaceRoot()).toBe(resolve('/custom/projects'));
  });

  it('LIRI_PROJECTS_DIR 优先于设置', () => {
    writeSettings({ [PROJECTS_DIRECTORY_SETTING_KEY]: '/custom/projects' });
    process.env.LIRI_PROJECTS_DIR = '/env/projects';
    expect(resolveProjectWorkspaceRoot()).toBe(resolve('/env/projects'));
  });

  it('设置值非字符串 ⇒ 视为未设置（不因脏数据抛错）', () => {
    writeSettings({ [PROJECTS_DIRECTORY_SETTING_KEY]: 123 });
    expect(resolveProjectWorkspaceRoot()).toBe(
      join(homedir(), 'Documents', 'LiriProjects')
    );
  });

  it('settings.json 损坏 ⇒ 回落默认（不抛）', () => {
    writeFileSync(join(home, 'settings.json'), '{ not json', 'utf-8');
    expect(resolveProjectWorkspaceRoot()).toBe(
      join(homedir(), 'Documents', 'LiriProjects')
    );
  });
});
