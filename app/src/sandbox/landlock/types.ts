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
 * Landlock 沙箱类型定义（P1，2026-08-25）
 *
 * 对齐参考仓库 `REF/BA_REF/deepseek-harness/native/landlock-run` 的
 * policy.json 契约与 CLI 协议（见 dev_docs/20260824/沙箱隔离机制与Landlock集成方案-20260824.md §4.2）。
 */

/** Landlock 不可用原因 */
export type LandlockUnavailableReason =
  | 'no-linux'
  | 'not-in-lsm'
  | 'kernel-too-old'
  | 'enforce-denied'
  | 'helper-missing'
  | 'probe-failed';

/** Landlock 能力探测结果 */
export interface LandlockCapability {
  available: boolean;
  /** ABI 版本（0 = 不可用） */
  abi: number;
  /** 不可用原因（available=false 时） */
  reason?: LandlockUnavailableReason;
}

/** Landlock 文件系统权限词汇表（映射自 landlock-run policy.json 契约） */
export type LandlockFsAccess =
  | 'read'
  | 'write'
  | 'execute'
  | 'make_dir'
  | 'make_reg'
  | 'remove'
  | 'refer';

/** Landlock 文件系统规则（path_beneath） */
export interface LandlockFsRule {
  path: string;
  allow: LandlockFsAccess[];
}

/**
 * Landlock 网络策略。
 *
 * ⚠️ **为什么没有 `allow`**（2026-09-29 台账 **D-36-① / D-38**）：Landlock 的 net 规则
 * （`LANDLOCK_RULE_NET_PORT`）**只能按具体端口授权** —— 规则里的 `port` 是**字面端口号**
 * （`port 0` 表示"ephemeral 端口"，**不是**"任意端口"；见内核 `landlock.h` 的
 * `struct landlock_net_port_attr` 注释）。因此"放行任意端口的 CONNECT"**在内核层面无法表达**。
 * 于是本策略只保留**两态**：
 *  - **不设 `net`** = 完全不 handle 网络 ⇒ 内核视为**不受限**（等价普通 shell）；
 *  - **`{ denyAll: true }`** = handle 该 ABI 已知的**全部** net 权限且**不加任何规则**
 *    ⇒ 内核语义（handled 即默认拒绝）⇒ **网络全禁**。
 *
 * 历史（缺陷沿革）：原类型是 `{ allow: string[]; denyBind?: boolean }`，对应 CLI 的
 * `--net-connect tcp|udp`。但该 flag 的实现是把 CONNECT 位放进 `handled_access_net`
 * **且不加任何授权规则** ⇒ 实际效果是**拒绝** CONNECT、而 **bind 因未 handle 而放行** ——
 * 与"授予 CONNECT / deny-bind"的注释**两个方向都相反**；且 `denyBind` 从未被
 * `buildLandlockArgv` 输出（静默丢弃）。
 */
export interface LandlockNetRule {
  /** true = handle 全部 net 权限且不授予任何规则 ⇒ **网络全禁**（bind/connect，TCP/UDP 按 ABI 覆盖） */
  denyAll: true;
}

/** Landlock policy.json（landlock-run 输入） */
export interface LandlockPolicy {
  cwd: string;
  fs: LandlockFsRule[];
  net?: LandlockNetRule;
  abi: number;
}
