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

  /** 注册用户（密码哈希落盘，默认 user 角色） */
  addUser(
    username: string,
    password: string,
    role: AuthUserRole = 'user'
  ): void {
    const salt = randomBytes(8).toString('hex');
    this.users.set(username, {
      username,
      passwordHash: hashPassword(password, salt),
      salt,
      role,
      createdAt: Date.now(),
    });
    this.save();
  }

  /** 获取用户记录（不存在返回 undefined） */
  getUser(username: string): StoredAuthUser | undefined {
    return this.users.get(username);
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
