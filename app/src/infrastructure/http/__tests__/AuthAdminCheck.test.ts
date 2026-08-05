/**
 * M0 管理 API 鉴权 + admin 播种链路单测（§4.2d / §六b 验收① + 验收②前置）
 *
 * 覆盖：
 * - checkAdminRequest 四路径：无 token（基线放行）/ 无效 token（401）/
 *   非 admin 登录（403）/ admin（放行）
 * - AuthUserStore admin 播种（LIRI_ADMIN_PASSWORD）：首次播种 / 已有用户不覆盖 /
 *   未设置不播种（fail-safe）/ 角色持久化与密码哈希
 *
 * 注：AuthUserStore 用例并入本文件（而非独立文件），因独立文件加载会触发
 * @modules/core/paths 的 TDZ（模块加载顺序预存问题），本文件上下文顺序正常。
 */

import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import http from 'node:http';
import net from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkAdminRequest, authTokens } from '../handlers/auth-handlers';
import { AuthUserStore } from '../auth/AuthUserStore';

const tmpDirs: string[] = [];

afterAll(() => {
  for (const dir of tmpDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // 忽略清理失败
    }
  }
});

function makeReq(authHeader?: string): http.IncomingMessage {
  const req = new http.IncomingMessage(new net.Socket());
  req.headers = {};
  if (authHeader) req.headers['authorization'] = authHeader;
  return req;
}

beforeAll(() => {
  authTokens.set('admin-token', {
    username: 'admin',
    permissions: ['admin', 'read', 'write'],
  });
  authTokens.set('user-token', {
    username: 'alice',
    permissions: ['read', 'write'],
  });
});

afterAll(() => {
  authTokens.clear();
});

describe('checkAdminRequest（管理写 API 鉴权）', () => {
  it('无 Authorization 头 → 基线放行（本地回环信任）', () => {
    expect(checkAdminRequest(makeReq())).toBe('ok');
  });

  it('空 Bearer token → unauthorized（401）', () => {
    expect(checkAdminRequest(makeReq('Bearer '))).toBe('unauthorized');
  });

  it('无效 token → unauthorized（401）', () => {
    expect(checkAdminRequest(makeReq('Bearer bogus-token'))).toBe(
      'unauthorized'
    );
  });

  it('有效 token 但非 admin → forbidden（403）', () => {
    expect(checkAdminRequest(makeReq('Bearer user-token'))).toBe('forbidden');
  });

  it('admin token → 放行', () => {
    expect(checkAdminRequest(makeReq('Bearer admin-token'))).toBe('ok');
  });

  it('非 Bearer 前缀视为无 token（基线放行）', () => {
    expect(checkAdminRequest(makeReq('Token abc'))).toBe('ok');
  });
});

describe('AuthUserStore（admin 播种，M0d 验收②前置）', () => {
  it('LIRI_ADMIN_PASSWORD 设置且无用户时首次播种 admin', () => {
    const prev = process.env.LIRI_ADMIN_PASSWORD;
    process.env.LIRI_ADMIN_PASSWORD = 'TestAdmin123!';
    try {
      const tmpDir = mkdtempSync(join(tmpdir(), 'auth-test-'));
      tmpDirs.push(tmpDir);
      const store = new AuthUserStore(join(tmpDir, 'users.json'));
      const admin = store.getUser('admin');
      expect(admin).toBeDefined();
      expect(admin!.role).toBe('admin');
      expect(store.verify('admin', 'TestAdmin123!')).toBe(true);
      expect(store.verify('admin', 'wrong')).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.LIRI_ADMIN_PASSWORD;
      else process.env.LIRI_ADMIN_PASSWORD = prev;
    }
  });

  it('已有用户时不覆盖播种（无默认口令回退）', () => {
    const prev = process.env.LIRI_ADMIN_PASSWORD;
    delete process.env.LIRI_ADMIN_PASSWORD; // 第一阶段不播种
    try {
      const tmpDir = mkdtempSync(join(tmpdir(), 'auth-test-'));
      tmpDirs.push(tmpDir);
      const filePath = join(tmpDir, 'users.json');
      const store = new AuthUserStore(filePath);
      store.addUser('alice', 'pass1'); // 已存在用户（落盘）
      // 模拟重启：设置 env 后重新实例化 → 已有用户 → 不播种
      process.env.LIRI_ADMIN_PASSWORD = 'ShouldNotSeed';
      const reloaded = new AuthUserStore(filePath);
      expect(reloaded.getUser('admin')).toBeUndefined();
      expect(reloaded.getUser('alice')).toBeDefined();
    } finally {
      if (prev === undefined) delete process.env.LIRI_ADMIN_PASSWORD;
      else process.env.LIRI_ADMIN_PASSWORD = prev;
    }
  });

  it('未设置 LIRI_ADMIN_PASSWORD 时不播种（无默认口令，fail-safe）', () => {
    const prev = process.env.LIRI_ADMIN_PASSWORD;
    delete process.env.LIRI_ADMIN_PASSWORD;
    try {
      const tmpDir = mkdtempSync(join(tmpdir(), 'auth-test-'));
      tmpDirs.push(tmpDir);
      const store = new AuthUserStore(join(tmpDir, 'users.json'));
      expect(store.getUser('admin')).toBeUndefined();
      expect(store.size).toBe(0);
    } finally {
      if (prev !== undefined) process.env.LIRI_ADMIN_PASSWORD = prev;
    }
  });

  it('addUser 默认 user 角色，密码哈希落盘不存明文', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'auth-test-'));
    tmpDirs.push(tmpDir);
    const filePath = join(tmpDir, 'users.json');
    const store = new AuthUserStore(filePath);
    store.addUser('carol', 'secret-pass');
    const carol = store.getUser('carol');
    expect(carol).toBeDefined();
    expect(carol!.role).toBe('user');
    expect(carol!.passwordHash).not.toContain('secret-pass');
  });
});
