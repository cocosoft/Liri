// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * B3（2026-11-17）：demand 硬拒词表 + killswitch 的回归锁定。
 *
 * 背景：P0 的 demand 降级覆盖「非危险但需审批」的命令，而分类器危险词表不含
 * `runas`/`msiexec`/`regsvr32`/`schtasks`/`powershell -enc` 等（实测均为 ALLOW）。
 *
 * 本文件钉住：
 *  ① 硬拒命令头（含路径限定 / 复合命令中的任意段）⇒ true；
 *  ② 解释器 / 发布 / 推送类子命令 ⇒ true；
 *  ③ 常规只读 / 普通 CLI ⇒ false（不得误伤 P0 的收益）；
 *  ④ killswitch：默认开，显式 `false`（大小写不敏感）关闭。
 */
import { describe, expect, it } from 'bun:test';

import {
  DEMAND_HARD_DENY_HEADS,
  isDemandAutoAllowEnabled,
  isDemandHardDenyCommand,
} from '../../../packages/infra/src/permission/demandHardDeny';

describe('isDemandHardDenyCommand：demand 硬拒词表', () => {
  it('① 提权 / 安装 / 计划任务 / 系统配置头 ⇒ true', () => {
    const cases = [
      'runas /user:Administrator cmd',
      'msiexec /i setup.msi',
      'regsvr32 evil.dll',
      'schtasks /create /tn x /tr y',
      'reg add HKLM\\Software\\X /v y',
      'bcdedit /set testsigning on',
      'takeown /f C:\\Windows',
      'icacls C:\\Windows /grant Everyone:F',
      'netsh advfirewall set allprofiles state off',
      'wmic process call create notepad.exe',
      'psexec \\\\host cmd',
    ];
    for (const c of cases) expect(isDemandHardDenyCommand(c)).toBe(true);
  });

  it('① 路径限定与大小写不影响判定', () => {
    expect(
      isDemandHardDenyCommand('C:\\Windows\\System32\\runas.exe /user:a cmd')
    ).toBe(true);
    expect(isDemandHardDenyCommand('RUNAS /user:a cmd')).toBe(true);
  });

  it('① 复合命令中任一段命中 ⇒ true；全段无害 ⇒ false', () => {
    expect(isDemandHardDenyCommand('dir & runas /user:a cmd')).toBe(true);
    expect(isDemandHardDenyCommand('echo hi && dir /b')).toBe(false);
  });

  it('② 解释器 / 发布 / 推送类 ⇒ true', () => {
    const cases = [
      'powershell -Command Get-ChildItem',
      'pwsh -File x.ps1',
      'node -e "require(\'fs\')"',
      'python -c "print(1)"',
      'cmd /c dir',
      'bash -c "echo hi"',
      'Invoke-Expression $x',
      'npm publish',
      'pnpm publish --access public',
      'git push origin main',
      'docker push repo/img:tag',
      'kubectl delete pod x',
      'certutil -urlcache -f http://x y',
      'powershell -EncodedCommand ZQBjAGgAbwA=',
    ];
    for (const c of cases) expect(isDemandHardDenyCommand(c)).toBe(true);
  });

  it('③ 常规只读 / 普通 CLI ⇒ false（不误伤 P0 收益）', () => {
    const cases = [
      'type package.json',
      'cd /d E:\\x && type y.txt',
      'dir /b /ad C:\\x',
      'Get-CimInstance Win32_Process',
      'Get-PSDrive -PSProvider FileSystem',
      'some-unknown-cli --list',
      'git status',
      'npm run build',
      '',
    ];
    for (const c of cases) expect(isDemandHardDenyCommand(c)).toBe(false);
  });

  it('词表非空且全部小写（避免大小写漏判）', () => {
    expect(DEMAND_HARD_DENY_HEADS.size).toBeGreaterThan(10);
    for (const head of DEMAND_HARD_DENY_HEADS) {
      expect(head).toBe(head.toLowerCase());
    }
  });
});

describe('isDemandAutoAllowEnabled：killswitch', () => {
  it('默认开（未设置 / 空值 / 其它值）', () => {
    expect(isDemandAutoAllowEnabled({})).toBe(true);
    expect(isDemandAutoAllowEnabled({ LIRI_DEMAND_AUTO_ALLOW: '' })).toBe(true);
    expect(isDemandAutoAllowEnabled({ LIRI_DEMAND_AUTO_ALLOW: '1' })).toBe(
      true
    );
  });

  it('显式 false（大小写不敏感）⇒ 关闭', () => {
    expect(isDemandAutoAllowEnabled({ LIRI_DEMAND_AUTO_ALLOW: 'false' })).toBe(
      false
    );
    expect(
      isDemandAutoAllowEnabled({ LIRI_DEMAND_AUTO_ALLOW: ' FALSE ' })
    ).toBe(false);
  });
});
