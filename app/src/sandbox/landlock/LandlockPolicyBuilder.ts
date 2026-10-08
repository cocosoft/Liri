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
 * Landlock 策略映射（P1，2026-08-25）
 *
 * 将 `SandboxPermissions` 映射为 landlock-run 的 policy.json（对齐方案 §4.2(2) 映射表）。
 * 纯函数，无 IO，可在任意平台单测。
 */
import type { SandboxPermissions } from '../SandboxTypes';
import type {
  LandlockFsAccess,
  LandlockFsRule,
  LandlockNetRule,
  LandlockPolicy,
} from './types';

/** 当前支持的最大 ABI（移植目标；参考实现 MAX_ABI=5，P1 需扩展至 v10） */
export const MAX_SUPPORTED_ABI = 10;
/** partial 探测时的保守 ABI（仅基础 FS 权限） */
export const MIN_FS_ABI = 1;
/** REFER 所需 ABI（v2+） */
export const REFER_ABI = 2;

/**
 * 按 ABI 裁剪权限（best-effort，禁止硬编码超当前内核）
 * - v1：read/write/execute/make_dir/make_reg/remove（基础 FS）
 * - v2+：+ refer（REFER）
 *
 * 注：**net 不参与裁剪**（2026-09-29 台账 D-38）—— 现网络只有"全禁"与"不受限"两态，
 * 而"全禁"由 `handled_access_net`（helper 内按运行 ABI 自行取全位）表达，与 FS 权限表无关。
 */
export function clampAccessByAbi(
  access: LandlockFsAccess[],
  abi: number
): LandlockFsAccess[] {
  return access.filter((a) => {
    if (a === 'refer' && abi < REFER_ABI) return false;
    return true;
  });
}

/** 将 FSAccessRule.permissions 映射为 Landlock 权限（§4.2(2)：按写标志拆分） */
function mapPermissions(
  perms: SandboxPermissions['filesystem'][number]['permissions']
): LandlockFsAccess[] {
  const set = new Set<LandlockFsAccess>();
  for (const p of perms) {
    if (p === 'read') {
      set.add('read');
    } else if (p === 'write') {
      set.add('write');
      set.add('make_dir');
      set.add('make_reg');
      set.add('remove');
    } else if (p === 'execute') {
      set.add('execute');
    }
  }
  return [...set];
}

export class LandlockPolicyBuilder {
  /**
   * 从 SandboxPermissions 构建 Landlock policy.json
   * @param permissions 权限模型（`SandboxPermissions`）
   * @param options cwd（工作目录）、abi（探测到的 ABI，缺省 MAX_SUPPORTED_ABI）
   */
  static build(
    permissions: SandboxPermissions,
    options: { cwd?: string; abi?: number } = {}
  ): LandlockPolicy {
    const abi = options.abi ?? MAX_SUPPORTED_ABI;
    const fs: LandlockFsRule[] = permissions.filesystem.map((rule) => ({
      path: rule.path,
      allow: clampAccessByAbi(mapPermissions(rule.permissions), abi),
    }));

    // `permissions.network === false` ⇒ 该工具**不需要网络** ⇒ 显式**全禁**（真受限）；
    // `true` ⇒ 需要网络 ⇒ **不设 net**（Landlock net 规则只能按具体端口授权，无法表达
    // "任意端口的 CONNECT 放行" ⇒ 只能"不 handle"即不受限）。见 types.ts 的 LandlockNetRule。
    const net: LandlockNetRule | undefined = permissions.network
      ? undefined
      : { denyAll: true };

    return {
      cwd: options.cwd ?? process.cwd(),
      fs,
      net,
      abi,
    };
  }
}
