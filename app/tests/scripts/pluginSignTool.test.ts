// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// T25-08 P2 · 插件签名工具链（`app/scripts/plugin-sign.ts`）端到端
//
// 为什么值得单独测：签名闸要求「对 plugin.json **原始字节** 的 Ed25519 签名」，
// 手搓 openssl 很容易把规范化后的 JSON 签进去（运行时验签失败、原因难查）。
// 这里用真实子进程跑 keygen → sign → verify，锁住"工具产物与运行时门禁同源"。
import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createPublicKey } from 'node:crypto';
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
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(
  new URL('../../scripts/plugin-sign.ts', import.meta.url)
);
const APP_ROOT = fileURLToPath(new URL('../..', import.meta.url));

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function run(args: readonly string[]): RunResult {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: APP_ROOT,
    encoding: 'utf8',
  });
  return {
    status: result.status,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
  };
}

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function makePlugin(dir: string): string {
  const manifestPath = join(dir, 'plugin.json');
  writeFileSync(
    manifestPath,
    JSON.stringify({
      id: 'tool-probe',
      name: 'tool-probe',
      version: '1.0.0',
      description: 'probe',
      entryPoint: 'index.js',
      capabilities: ['tools'],
    }),
    'utf8'
  );
  return manifestPath;
}

describe('plugin-sign 工具链', () => {
  it('keygen 生成 Ed25519 公私钥；重复 keygen 需 --force', () => {
    const dir = tempDir('liri-sign-keygen-');
    try {
      const first = run(['keygen', '--out', dir]);
      expect(first.status).toBe(0);
      const keyPath = join(dir, 'plugin-signing.key');
      const pubPath = join(dir, 'plugin-signing.pub.pem');
      expect(existsSync(keyPath)).toBe(true);
      expect(existsSync(pubPath)).toBe(true);
      expect(createPublicKey(readFileSync(pubPath)).asymmetricKeyType).toBe(
        'ed25519'
      );

      const again = run(['keygen', '--out', dir]);
      expect(again.status).toBe(1);
      expect(again.stderr).toContain('--force');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sign → verify 通过（与运行时门禁同一判定）', () => {
    const workDir = tempDir('liri-sign-e2e-');
    try {
      const keysDir = join(workDir, 'keys');
      const pluginDir = join(workDir, 'plugin');
      expect(run(['keygen', '--out', keysDir]).status).toBe(0);

      // 目录里没有清单 ⇒ sign 必须失败（不猜、不产出空签名）
      expect(
        run([
          'sign',
          '--plugin',
          pluginDir,
          '--key',
          join(keysDir, 'plugin-signing.key'),
        ]).status
      ).toBe(1);

      mkdirSync(pluginDir, { recursive: true });
      makePlugin(pluginDir);
      const signed = run([
        'sign',
        '--plugin',
        pluginDir,
        '--key',
        join(keysDir, 'plugin-signing.key'),
      ]);
      expect(signed.status).toBe(0);
      expect(existsSync(join(pluginDir, 'plugin.sig'))).toBe(true);

      const verified = run([
        'verify',
        '--plugin',
        pluginDir,
        '--keys',
        keysDir,
      ]);
      expect(verified.status).toBe(0);
      expect(verified.stdout).toContain('验签通过');
      expect(verified.stdout).toContain('plugin-signing.pub.pem');
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('签完再改清单 ⇒ verify 失败（证明签的是原始字节）', () => {
    const workDir = tempDir('liri-sign-tamper-');
    try {
      const keysDir = join(workDir, 'keys');
      const pluginDir = join(workDir, 'plugin');
      run(['keygen', '--out', keysDir]);
      mkdirSync(pluginDir, { recursive: true });
      const manifestPath = makePlugin(pluginDir);
      run([
        'sign',
        '--plugin',
        pluginDir,
        '--key',
        join(keysDir, 'plugin-signing.key'),
      ]);

      // 只改一个字节（多一个换行）也必须失败
      writeFileSync(
        manifestPath,
        `${readFileSync(manifestPath, 'utf8')}\n`,
        'utf8'
      );
      const verified = run([
        'verify',
        '--plugin',
        pluginDir,
        '--keys',
        keysDir,
      ]);
      expect(verified.status).toBe(1);
      expect(verified.stderr).toContain('验签未通过');
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('未知子命令 / 缺参数 ⇒ 非 0 且给出用法', () => {
    const unknown = run(['nope']);
    expect(unknown.status).toBe(2);
    expect(unknown.stderr).toContain('用法');

    const missing = run(['sign']);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('--plugin');
  });
});
