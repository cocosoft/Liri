// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * G2 剩余三期：单文件二进制签名脚本的**纯函数**部分。
 *
 * 锁定的语义：
 * - 未配置凭据 ⇒ `skip` + 明确的"缺什么"（不伪造已签名）；
 * - 已配置 ⇒ 命令序列可预测（先签名后校验；macOS 提供 p12 时先建 keychain 导入）；
 * - Linux 无通用标准 ⇒ 如实跳过。
 *
 * 真正的 `signtool` / `codesign` 执行需发版侧证书，本机（Windows、无证书、无 cargo）
 * **未实测**，故用例只覆盖计划推导。
 */

import { describe, expect, it } from 'bun:test';
import { defaultOutfile } from '../../../scripts/build-cli-binary';
import {
  DEFAULT_TIMESTAMP_URL,
  normalizePlatform,
  parseSignArgs,
  readSigningEnv,
  resolveSigningPlan,
} from '../../../scripts/sign-cli-binary';

const FILE = '/tmp/liri-linux-x64';

describe('sign-cli-binary 纯函数', () => {
  it('平台归一化：合法三平台通过，其他值给 null（不静默回落）', () => {
    expect(normalizePlatform('win32')).toBe('win32');
    expect(normalizePlatform('darwin')).toBe('darwin');
    expect(normalizePlatform('linux')).toBe('linux');
    expect(normalizePlatform('freebsd')).toBeNull();
  });

  it('Windows 未配置证书 ⇒ skip 并说明缺什么', () => {
    const plan = resolveSigningPlan('win32', FILE, {});
    expect(plan.status).toBe('skip');
    expect(plan.reason).toContain('证书');
    expect(plan.commands).toEqual([]);
  });

  it('Windows 证书缺口令 ⇒ skip（不拿空口令去签名）', () => {
    const plan = resolveSigningPlan('win32', FILE, {
      winCertPath: '/tmp/cert.pfx',
    });
    expect(plan.status).toBe('skip');
    expect(plan.reason).toContain('口令');
  });

  it('Windows 凭据齐全 ⇒ signtool 签名 + verify，时间戳用默认值', () => {
    const plan = resolveSigningPlan('win32', FILE, {
      winCertPath: '/tmp/cert.pfx',
      winCertPassword: 'pwd',
    });
    expect(plan.status).toBe('sign');
    expect(plan.commands.map((c) => c.cmd)).toEqual(['signtool', 'signtool']);
    expect(plan.commands[0].args).toEqual([
      'sign',
      '/fd',
      'sha256',
      '/f',
      '/tmp/cert.pfx',
      '/p',
      'pwd',
      '/tr',
      DEFAULT_TIMESTAMP_URL,
      '/td',
      'sha256',
      FILE,
    ]);
    expect(plan.commands[1].args).toEqual(['verify', '/pa', FILE]);
  });

  it('Windows 自定义时间戳服务 ⇒ 透传', () => {
    const plan = resolveSigningPlan('win32', FILE, {
      winCertPath: '/tmp/cert.pfx',
      winCertPassword: 'pwd',
      winTimestampUrl: 'https://ts.example.com',
    });
    expect(plan.commands[0].args).toContain('https://ts.example.com');
  });

  it('macOS 仅有身份 ⇒ codesign 签名 + 校验（不建 keychain）', () => {
    const plan = resolveSigningPlan('darwin', FILE, {
      macIdentity: 'Developer ID Application: X (TEAM)',
    });
    expect(plan.status).toBe('sign');
    expect(plan.commands.map((c) => c.cmd)).toEqual(['codesign', 'codesign']);
    expect(plan.commands[0].args).toContain(
      'Developer ID Application: X (TEAM)'
    );
    expect(plan.commands[1].args).toEqual([
      '--verify',
      '--strict',
      '--verbose=2',
      FILE,
    ]);
  });

  it('macOS 提供 p12 ⇒ 先建 keychain 导入，再签名与校验', () => {
    const plan = resolveSigningPlan('darwin', FILE, {
      macIdentity: 'Developer ID Application: X (TEAM)',
      macCertPath: '/tmp/cert.p12',
      macCertPassword: 'pwd',
      macKeychainPath: '/tmp/liri.keychain-db',
    });
    expect(plan.status).toBe('sign');
    expect(plan.commands.map((c) => `${c.cmd}:${c.args[0]}`)).toEqual([
      'security:create-keychain',
      'security:import',
      'security:set-key-partition-list',
      'codesign:--force',
      'codesign:--verify',
    ]);
    expect(plan.commands[3].args).toContain('/tmp/liri.keychain-db');
  });

  it('macOS p12 缺口令 ⇒ skip（不拿空口令去导入）', () => {
    const plan = resolveSigningPlan('darwin', FILE, {
      macIdentity: 'Developer ID Application: X (TEAM)',
      macCertPath: '/tmp/cert.p12',
    });
    expect(plan.status).toBe('skip');
    expect(plan.reason).toContain('口令');
  });

  it('Linux 无通用签名标准 ⇒ 如实跳过', () => {
    const plan = resolveSigningPlan('linux', FILE, {});
    expect(plan.status).toBe('skip');
    expect(plan.reason).toContain('Linux');
    expect(plan.commands).toEqual([]);
  });

  it('参数解析：缺省按当前平台产物；非法平台 ⇒ null', () => {
    const parsed = parseSignArgs([], 'win32');
    expect(parsed?.platform).toBe('win32');
    // 产物名跟**运行平台**走（此前硬编码 win32 产物名 ⇒ Linux/macOS CI 必红）
    expect(parsed?.file).toBe(defaultOutfile());
    expect(parseSignArgs(['--platform', 'plan9'])).toBeNull();
    expect(parseSignArgs(['--file', ' '])).toBeNull();
  });

  it('env 读取：空串/未设置一律视为未配置', () => {
    const env = readSigningEnv({
      LIRI_SIGN_WIN_CERT_PFX_BASE64: '   ',
      LIRI_SIGN_MAC_IDENTITY: 'Developer ID Application: X',
    });
    expect(env.winCertPfxBase64).toBeUndefined();
    expect(env.winCertPassword).toBeUndefined();
    expect(env.macIdentity).toBe('Developer ID Application: X');
  });
});
