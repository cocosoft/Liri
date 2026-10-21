/**
 * 分发前置「写路径不落安装目录」：`.env` 的落点
 *
 * ① 唯一写入目标是用户级 `~/.pyapp/.env`（安装目录可能只读，如 Program Files）；
 * ② 安装目录内的 `app/.env` 只读兼容（开发检出 / 便携包），不再被自举逻辑写入；
 * ③ 安装目录已有 `.env` 时不重复生成用户级模板（开发态行为零变更）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
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
  setUserDataDirOverride,
  resolveUserEnvPath,
  resolveBundledEnvPath,
  resolveEnvExamplePath,
} from '../../src/core/paths.js';
import { ensureEnvFileExists } from '../../src/bootstrap/preflight.js';

let root: string;
let home: string;
let project: string;
const previousProjectDir = process.env.LIRI_PROJECT_DIR;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'liri-env-'));
  home = join(root, 'home');
  project = join(root, 'install');
  mkdirSync(join(project, 'app'), { recursive: true });
  mkdirSync(home, { recursive: true });
  setUserDataDirOverride(home);
  process.env.LIRI_PROJECT_DIR = project;
});

afterEach(() => {
  setUserDataDirOverride(null);
  // `ensureEnvFileExists` 会把模板内容并入 process.env（进程级），测试后清掉
  delete process.env.OTHER_KEY;
  if (previousProjectDir === undefined) {
    delete process.env.LIRI_PROJECT_DIR;
  } else {
    process.env.LIRI_PROJECT_DIR = previousProjectDir;
  }
  rmSync(root, { recursive: true, force: true });
});

describe('.env 路径归属', () => {
  it('写入目标为用户级，安装目录仅作只读兼容', () => {
    expect(resolveUserEnvPath()).toBe(join(home, '.env'));
    expect(resolveBundledEnvPath()).toBe(join(project, 'app', '.env'));
    expect(resolveEnvExamplePath()).toBe(join(project, 'app', '.env.example'));
  });

  it('缺少任何 .env 时，从模板生成到用户级，且不写安装目录', () => {
    writeFileSync(
      join(project, 'app', '.env.example'),
      'DEEPSEEK_API_KEY=sk-placeholder\nOTHER_KEY=keep-me\n',
      'utf-8'
    );

    ensureEnvFileExists();

    const userEnv = resolveUserEnvPath();
    expect(existsSync(userEnv)).toBe(true);
    expect(readFileSync(userEnv, 'utf-8')).toContain('OTHER_KEY=keep-me');
    expect(existsSync(resolveBundledEnvPath())).toBe(false);
  });

  it('安装目录已有 .env 时不重复生成用户级模板（开发态零变更）', () => {
    const bundled = resolveBundledEnvPath();
    writeFileSync(bundled, 'DEEPSEEK_API_KEY=sk-real\n', 'utf-8');

    ensureEnvFileExists();

    expect(readFileSync(bundled, 'utf-8')).toBe('DEEPSEEK_API_KEY=sk-real\n');
    expect(existsSync(resolveUserEnvPath())).toBe(false);
  });
});
