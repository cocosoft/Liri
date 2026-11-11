// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 命令治理语料（P0，2026-11-12）
 *
 * 立论：命令判定此前靠"人工探针 + 事故"发现缺口（本轮 152 条探针一次补出 50+ 条漏判）。
 * 本文件把**已确认的口径**固化为可回归语料，三档语义显式标注：
 *   - `deny`：不可逆 / 任意执行 / 提权 / 持久化；
 *   - `ask` ：常见但可能不可逆（写盘 / 搬移 / 远端写 / 未知命令）；
 *   - `allow`：结构只读。
 *
 * 每条都要求**理由可解释**：deny/ask 必须命中具体令牌或规则，不允许"靠注入类误报"凑结果。
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { AutoModeClassifier } from '@openliri/infra/permission/classifiers/AutoModeClassifier';

type Expect = 'deny' | 'ask' | 'allow';
const classifier = new AutoModeClassifier();

const b64u16 = (text: string): string =>
  Buffer.from(text, 'utf16le').toString('base64');
const b64u8 = (text: string): string =>
  Buffer.from(text, 'utf8').toString('base64');

async function verdict(command: string): Promise<{
  tier: Expect;
  reason: string;
}> {
  const decision = await classifier.classify('bash', { command }, []);
  const tier: Expect = decision.shouldBlock
    ? 'deny'
    : decision.requiresApproval
      ? 'ask'
      : 'allow';
  return { tier, reason: decision.reason ?? '' };
}

afterEach(() => {
  delete process.env['PERMISSION_UNKNOWN_COMMAND_TIER'];
});

describe('P0 语料：编码执行（-EncodedCommand / -enc）', () => {
  it('解码后是危险命令 ⇒ deny', async () => {
    for (const payload of [
      `powershell -EncodedCommand ${b64u16('rm -rf /')}`,
      `pwsh -enc ${b64u16('Remove-Item -Recurse -Force .')}`,
      `powershell -EncodedCommand ${b64u8('sudo rm -rf /')}`,
    ]) {
      const { tier } = await verdict(payload);
      expect(tier).toBe('deny');
    }
  });

  it('解码后是只读命令 ⇒ allow（不误伤）', async () => {
    for (const payload of [
      `powershell -EncodedCommand ${b64u16('Get-Content a.txt')}`,
      `powershell -EncodedCommand ${b64u8('ls -la')}`,
    ]) {
      const { tier } = await verdict(payload);
      expect(tier).toBe('allow');
    }
  });

  it('出现了编码开关却解不出载荷 ⇒ fail-closed deny', async () => {
    const { tier, reason } = await verdict('powershell -EncodedCommand !!!!');
    expect(tier).toBe('deny');
    expect(reason).toContain('undecodable');
  });
});

describe('P0 语料：转义不改变语义', () => {
  it('bash 反斜杠 / cmd 脱字符 / PowerShell 反引号 ↩ 同判 deny', async () => {
    for (const command of ['r\\m -rf /', 'r^m -rf /', 'r`m -rf /']) {
      const { tier } = await verdict(command);
      expect(tier).toBe('deny');
    }
  });
});

describe('P0 语料：执行 / 提权 / 注册类', () => {
  it('一律 deny', async () => {
    for (const command of [
      'cmd /c start calc.exe',
      'runas /user:Administrator cmd',
      'regsvr32 /s evil.dll',
      'msiexec /i evil.msi /qn',
      "Add-Type -TypeDefinition 'public class X {}'",
      '[Reflection.Assembly]::Load($bytes)',
      'Import-Module .\\evil.psm1',
      'deno run -A x.ts',
      'Invoke-Expression $cmd',
      'iex $cmd',
      'Start-Process cmd.exe',
    ]) {
      const { tier } = await verdict(command);
      expect(tier).toBe('deny');
    }
  });
});

describe('P0 语料：写盘 / 远端 / 未知命令 ⇒ ask', () => {
  it('下载落盘与远端映射', async () => {
    for (const command of [
      'iwr -Uri .\\local -OutFile out.txt',
      'New-PSDrive -Name X -PSProvider FileSystem -Root \\\\host\\share',
    ]) {
      const { tier } = await verdict(command);
      expect(tier).toBe('ask');
    }
  });

  it('未收录但会改状态的命令（未知命令策略 B）', async () => {
    for (const command of [
      'cargo publish',
      'gcloud compute instances delete x',
      'gh api -X DELETE /repos/o/r',
      'sqlite3 app.db "delete from sessions"',
    ]) {
      const { tier } = await verdict(command);
      expect(tier).toBe('ask');
    }
  });
});

describe('P0 语料：只读命令零新增审批（负向对照）', () => {
  it('结构只读 ⇒ allow', async () => {
    for (const command of [
      'ls -la',
      'cat README.md',
      'Get-Content a.txt',
      'git status',
      'git log --oneline -3',
      'kubectl get pods',
      'kubectl describe pod x',
      'docker ps',
      'gh pr view 1',
    ]) {
      const { tier } = await verdict(command);
      expect(tier).toBe('allow');
    }
  });

  it('同名但写侧子命令不得借只读入口放行', async () => {
    for (const command of [
      'kubectl delete pod x',
      'docker run alpine',
      'gh pr merge 1',
      'gh api -X DELETE /repos/o/r',
    ]) {
      const { tier } = await verdict(command);
      expect(tier).toBe('ask');
    }
  });
});

describe('P0 语料：灰度开关（PERMISSION_UNKNOWN_COMMAND_TIER）', () => {
  it('默认 ask；显式 allow 时回到旧行为', async () => {
    const probe = 'cargo publish';
    expect((await verdict(probe)).tier).toBe('ask');

    process.env['PERMISSION_UNKNOWN_COMMAND_TIER'] = 'allow';
    expect((await verdict(probe)).tier).toBe('allow');

    // 拼错 / 非法值不得静默放宽
    process.env['PERMISSION_UNKNOWN_COMMAND_TIER'] = 'yes';
    expect((await verdict(probe)).tier).toBe('ask');
  });
});
