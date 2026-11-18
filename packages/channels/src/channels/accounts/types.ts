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
 * 多账号系统类型定义
 * 对齐 OpenClaw accounts.ts + account-resolution.ts 设计
 */

/** 命名账号标识 */
export interface NamedAccount {
  /** 账号唯一标识 */
  id: string;
  /** 显示名称 */
  displayName: string;
  /** 账号级配置 */
  config: Record<string, unknown>;
  /** 是否默认回退 */
  isDefault: boolean;
}

/** 账号解析结果 */
export interface ResolvedAccount {
  /** 解析到的账号 */
  account: NamedAccount;
  /** 是否为回退账号（非精确匹配） */
  fallback: boolean;
}

/** 账号注册选项 */
export interface AccountRegistrationOptions {
  /** 账号唯一标识 */
  id: string;
  /** 显示名称 */
  displayName?: string;
  /** 账号级配置 */
  config?: Record<string, unknown>;
  /** 是否默认账号 */
  isDefault?: boolean;
}
