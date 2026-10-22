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
 * AuthUserStore — auth 用户持久化存储（演进项：真实用户体系基础）
 *
 * 将 auth-handlers 的内存 users Map 落盘到 {data}/auth/users.json，
 * 密码以 sha256(salt:password) 哈希存储（不落明文）。
 * tokens 保持内存（会话令牌重启失效属合理安全语义，需重新登录）。
 */

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { resolveDataSubDir } from '@modules/core/paths';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = getLogger('http:authUserStore');

/** auth 用户角色 */
export type AuthUserRole = 'admin' | 'user';

/** 持久化用户记录（密码为哈希，不存明文） */
export interface StoredAuthUser {
  username: string;
  passwordHash: string;
  salt: string;
  role: AuthUserRole;
  createdAt: number;
  /**
   * 所属租户（多租户 P3：**账号属性**，非请求声明）。
   *
   * 缺省（= 老用户的 users.json 无此字段）⇒ 空，登录后按 `'local'` 解析 —— 桌面端
   * 与改造前逐字等价；请求头/登录 body 都**不能**切换租户。
   */
  tenantId?: string;
}

function hashPassword(password: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${password}`).digest('hex');
}

/** auth 用户存储：加载/保存 users.json */
export class AuthUserStore {
  private readonly filePath: string;
  private users = new Map<string, StoredAuthUser>();

  constructor(filePath?: string) {
    this.filePath = filePath ?? join(resolveDataSubDir('auth'), 'users.json');
    this.load();
    this.seedAdminFromEnv();
  }

  /** 从磁盘加载用户（文件不存在视为无用户） */
  load(): void {
    try {
      if (!existsSync(this.filePath)) return;
      const data = JSON.parse(readFileSync(this.filePath, 'utf8')) as
        | StoredAuthUser[]
        | null;
      if (!Array.isArray(data)) return;
      this.users = new Map(data.map((u) => [u.username, u]));
      logger.info('auth:usersLoaded', { count: this.users.size });
    } catch (error) {
      void handleError(error, {
        module: 'http:auth',
        action: 'load_users',
      });
    }
  }

  /**
   * 首次启动播种 admin（仅当 LIRI_ADMIN_PASSWORD 环境变量设置且尚无任何用户时）。
   * 不设置环境变量则不播种——不引入默认口令安全风险。
   */
  private seedAdminFromEnv(): void {
    const password = process.env['LIRI_ADMIN_PASSWORD'];
    if (!password || this.users.size > 0) return;
    this.addUser('admin', password, 'admin');
    logger.info('auth:adminSeeded', { username: 'admin' });
  }

  /** 保存用户到磁盘 */
  save(): void {
    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(
        this.filePath,
        JSON.stringify([...this.users.values()], null, 2)
      );
    } catch (error) {
      void handleError(error, {
        module: 'http:auth',
        action: 'save_users',
      });
    }
  }

  hasUser(username: string): boolean {
    return this.users.has(username);
  }

  /** 注册用户（密码哈希落盘，默认 user 角色；`tenantId` 缺省 ⇒ 本地租户） */
  addUser(
    username: string,
    password: string,
    role: AuthUserRole = 'user',
    tenantId?: string
  ): void {
    const salt = randomBytes(8).toString('hex');
    this.users.set(username, {
      username,
      passwordHash: hashPassword(password, salt),
      salt,
      role,
      createdAt: Date.now(),
      ...(tenantId ? { tenantId } : {}),
    });
    this.save();
  }

  /** 获取用户记录（不存在返回 undefined） */
  getUser(username: string): StoredAuthUser | undefined {
    return this.users.get(username);
  }

  /**
   * 绑定 / 迁移用户的租户（`tenantId` 省略 ⇒ **解绑**，回到本地租户）
   *
   * @returns 用户不存在 ⇒ `false`（不写盘、不改任何数据）
   */
  setUserTenant(username: string, tenantId?: string): boolean {
    const user = this.users.get(username);
    if (!user) return false;
    if (tenantId) {
      user.tenantId = tenantId;
    } else {
      delete user.tenantId;
    }
    this.save();
    return true;
  }

  /** 该租户下的所有用户名（只读） */
  listUsersByTenant(tenantId: string): string[] {
    const names: string[] = [];
    for (const user of this.users.values()) {
      if (user.tenantId === tenantId) names.push(user.username);
    }
    return names;
  }

  /**
   * 全部**已绑定租户**的身份（只读，按 `tenantId` → `userId` 排序）。
   *
   * 用途：启动期按身份扫描待恢复检查点。存储是 `<data>/tenants/<t>/users/<u>/`（L3
   * DB-per-tenant）分区 ⇒ 只按租户扫**扫不到任何人的库**，必须到"人"这一级。
   * 未绑定租户的用户（本地身份）不在此列 —— 由宿主的本地扫描覆盖。
   */
  listTenantUsers(): Array<{ tenantId: string; userId: string }> {
    const identities: Array<{ tenantId: string; userId: string }> = [];
    for (const user of this.users.values()) {
      if (!user.tenantId) continue;
      identities.push({ tenantId: user.tenantId, userId: user.username });
    }
    return identities.sort(
      (a, b) =>
        a.tenantId.localeCompare(b.tenantId) || a.userId.localeCompare(b.userId)
    );
  }

  /**
   * 把该租户下的**所有账号**解绑回本地租户（只改归属，不删账号、不改密码）
   *
   * 用途：删除租户后清理"指向已删租户"的悬空绑定。写盘**一次**（不逐个 `save`）。
   *
   * @returns 被解绑的用户名（空数组 ⇒ 未写盘）
   */
  unbindAllFromTenant(tenantId: string): string[] {
    const unbound: string[] = [];
    for (const user of this.users.values()) {
      if (user.tenantId !== tenantId) continue;
      delete user.tenantId;
      unbound.push(user.username);
    }
    if (unbound.length > 0) this.save();
    return unbound;
  }

  /** 校验用户密码（不存在返回 false） */
  verify(username: string, password: string): boolean {
    const user = this.users.get(username);
    if (!user) return false;
    return hashPassword(password, user.salt) === user.passwordHash;
  }

  get size(): number {
    return this.users.size;
  }
}
