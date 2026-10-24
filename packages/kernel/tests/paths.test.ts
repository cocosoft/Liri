// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 租户级路径契约（基础设施专项 §6.1 期 1，2026-10-24 拍板方向 B）。
 *
 * 锁定三件事：
 * 1. 本地身份**逐字不变**（仍是共享 `app.db`）—— 桌面/CLI 零行为变更；
 * 2. 租户身份的库路径**不含 `users/<u>`**（租户内靠 `owner_key` 行级隔离）；
 * 3. 非法租户标识被哈希成安全路径段（路径注入防护不因新函数而旁路）。
 */
import { describe, expect, it } from 'bun:test';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { LOCAL_PRINCIPAL, type Principal } from '../src/core/identity/principal';
import {
  resolveDataDir,
  resolveScopedDbPath,
  resolveTenantDataRoot,
  resolveTenantDbPath,
} from '../src/core/paths';

const dataDir = join(tmpdir(), 'pyapp-kernel-tenant-paths');
const env = { LIRI_DATA_DIR: dataDir } as NodeJS.ProcessEnv;
const base = resolve(dataDir);

const tenant = (tenantId: string, userId: string): Principal => ({
  tenantId,
  userId,
  roles: [userId],
});

describe('租户级数据根', () => {
  it('本地身份 ⇒ 与共享数据根逐字相同', () => {
    expect(resolveTenantDataRoot(LOCAL_PRINCIPAL, env)).toBe(resolveDataDir(env));
    expect(resolveTenantDbPath(LOCAL_PRINCIPAL, env)).toBe(
      join(resolveDataDir(env), 'app.db')
    );
  });

  it('租户身份 ⇒ tenants/<t>，**不含** users/<u>', () => {
    const root = resolveTenantDataRoot(tenant('acme', 'alice'), env);
    expect(root).toBe(join(base, 'tenants', 'acme'));
    expect(root).not.toContain('users');
    expect(resolveTenantDbPath(tenant('acme', 'alice'), env)).toBe(
      join(base, 'tenants', 'acme', 'app.db')
    );
  });

  it('同租户不同用户 ⇒ 同一个租户库（用户隔离交给 owner_key）', () => {
    expect(resolveTenantDbPath(tenant('acme', 'alice'), env)).toBe(
      resolveTenantDbPath(tenant('acme', 'bob'), env)
    );
  });

  it('对照：per-user 的 scoped 路径**仍然**含 users/<u>（未被本轮改动）', () => {
    const scoped = resolveScopedDbPath(tenant('acme', 'alice'), env);
    expect(scoped).toBe(join(base, 'tenants', 'acme', 'users', 'alice', 'app.db'));
  });

  it('非法租户标识 ⇒ 哈希安全段（路径注入不因新函数旁路）', () => {
    const root = resolveTenantDataRoot(tenant('../evil', 'alice'), env);
    expect(root).toMatch(/[\\/]tenants[\\/]h_[0-9a-f]{16}$/);
    expect(root).not.toContain('..');
  });
});
