/**
 * Landlock **网络策略两态契约** 离线守卫（2026-09-29 台账 **D-36-① / D-38**）。
 *
 * **为什么只有两态**（权威依据 = 内核 `landlock.h` + 官方文档，均已核对）：
 *  ① `landlock_ruleset_attr` 的注释原文：handled access rights "**should be denied by default** …
 *     rights that are not specifically listed here are **not going to be denied**"
 *     ⇒ **handle = 默认拒绝**；未 handle = 不受限。
 *  ② net 规则（`LANDLOCK_RULE_NET_PORT`）的 `struct landlock_net_port_attr.port` 是**字面端口号**
 *     （`port 0` = "ephemeral 端口"，**不是**"任意端口"）⇒ "放行**任意端口**的 CONNECT"
 *     **在内核层面无法表达**。
 * ⇒ 于是策略只承认：
 *  - **不设 `net`** ⇒ 不 handle ⇒ **网络不受限**（等价普通 shell）；
 *  - **`{ denyAll: true }`** ⇒ handle 全部 net 位 + **不加任何规则** ⇒ **网络全禁**。
 *
 * 历史缺陷（本文件守卫的回归点）：原 CLI 是 `--net-connect tcp|udp`，实现把 CONNECT 位放进
 * `handled_access_net` 且不加授权规则 ⇒ 实际是**拒绝** CONNECT、**放行** bind —— 与注释
 * "授予 CONNECT / deny-bind"**两个方向都相反**；且调用方**无条件**传 `connect_udp`，
 * 在 ABI < 10 的内核上还会让 helper 直接 **exit 125**。
 *
 * ⚠️ 本文件**不需要 Linux**：断言的全是**纯函数**产物（policy 形状 / argv 组装）；
 * C 侧（`native/main.c`）的行为**待 Linux 实测**（见台账 D-38）。
 */
import { describe, expect, it } from 'bun:test';
import { buildLandlockArgv } from '@modules/sandbox';
import { LandlockPolicyBuilder } from '../../src/sandbox/landlock/LandlockPolicyBuilder';
import type {
  LandlockFsRule,
  LandlockPolicy,
} from '../../src/sandbox/landlock/types';
import type { SandboxPermissions } from '../../src/sandbox/SandboxTypes';
import { buildBashLandlockPolicy } from '../../src/tools/bash/bashLandlockExec';
import { buildBunLandlockPolicy } from '../../src/tools/CodeRunner/LinuxSandboxRunner';

function policy(over: Partial<LandlockPolicy> = {}): LandlockPolicy {
  const fs: LandlockFsRule[] = [{ path: '/work', allow: ['read'] }];
  return { cwd: '/work', fs, abi: 5, ...over };
}

function permissions(
  over: Partial<SandboxPermissions> = {}
): SandboxPermissions {
  return {
    filesystem: [{ path: '/work', permissions: ['read'], recursive: true }],
    network: false,
    networkWhitelist: [],
    process: false,
    bwrap: true,
    ...over,
  };
}

describe('网络策略两态：argv 组装', () => {
  it('`denyAll` ⇒ 恰好一个 `--net-deny`', () => {
    expect(buildLandlockArgv(policy({ net: { denyAll: true } }))).toEqual([
      '--ro',
      '/work',
      '--net-deny',
    ]);
  });

  it('不设 `net` ⇒ **不传任何网络参数**', () => {
    const argv = buildLandlockArgv(policy());
    expect(argv).toEqual(['--ro', '/work']);
    expect(argv.some((a) => a.includes('net'))).toBe(false);
  });

  it('`--rw` 规则与 `--net-deny` 可组合', () => {
    const fs: LandlockFsRule[] = [{ path: '/work', allow: ['read', 'write'] }];
    expect(buildLandlockArgv(policy({ fs, net: { denyAll: true } }))).toEqual([
      '--rw',
      '/work',
      '--net-deny',
    ]);
  });

  it('**防回退**：不再出现旧 flag `--net-connect`（含 tcp/udp 两种形态）', () => {
    for (const p of [
      policy(),
      policy({ net: { denyAll: true } }),
      policy({ fs: [{ path: '/x', allow: ['read', 'write'] }] }),
    ]) {
      const argv = buildLandlockArgv(p);
      expect(argv).not.toContain('--net-connect');
      expect(argv).not.toContain('tcp');
      expect(argv).not.toContain('udp');
    }
  });
});

describe('网络策略两态：三个 policy 生产者的意图', () => {
  it('bash（`bashLandlockExec`）：**不设 net** ⇒ 网络不受限（bash 从不是网络受限通道）', () => {
    const p = buildBashLandlockPolicy({ cwd: '/work', abi: 5 });
    expect(p.net).toBeUndefined();
    // 反向断言：绝不能变成"全禁"（那会误伤 curl/git/npm）
    expect(p.net?.denyAll).not.toBe(true);
  });

  it('code_run（`LinuxSandboxRunner`）：`denyAll` ⇒ 网络全禁（对齐该模块"全禁"意图）', () => {
    const p = buildBunLandlockPolicy('/work', 5);
    expect(p.net).toEqual({ denyAll: true });
    expect(buildLandlockArgv(p)).toContain('--net-deny');
  });

  it('`LandlockPolicyBuilder`：按 `permissions.network` 映射（false ⇒ 全禁；true ⇒ 不设 net）', () => {
    const denied = LandlockPolicyBuilder.build(
      permissions({ network: false }),
      {
        cwd: '/work',
        abi: 5,
      }
    );
    expect(denied.net).toEqual({ denyAll: true });

    const allowed = LandlockPolicyBuilder.build(
      permissions({ network: true }),
      {
        cwd: '/work',
        abi: 5,
      }
    );
    expect(allowed.net).toBeUndefined();
  });

  it('网络两态与 ABI 无关（旧实现只在 abi>=4 才产出 net ⇒ 已是历史）', () => {
    for (const abi of [1, 4, 5, 10]) {
      expect(
        LandlockPolicyBuilder.build(permissions({ network: false }), {
          cwd: '/work',
          abi,
        }).net
      ).toEqual({ denyAll: true });
    }
  });
});
