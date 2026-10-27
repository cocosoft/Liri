/**
 * P1-3（2026-10-27）：复合只读命令逐段判定。
 *
 * 真机背景：`cd /d X && dir /b`、`dir /s /b *.ts | find /c /v ""` 这类**纯只读串联**
 * 原先被 `SHELL_OPERATORS` 一律判 deny，连审批机会都没有（会话 `session_mvoqs1ho875ea6b95e`
 * 多次 `安全检查失败: 命令被阻止执行`）。
 *
 * 本用例同时守护**负向边界**：重定向 / 命令替换 / 后台 `&` / 变量 / 非只读段必须仍被拒。
 */
import { describe, expect, it } from 'bun:test';
import { checkCompoundReadOnly } from '../../src/security/compoundReadOnly';
import { BashSecurityAnalyzer } from '../../src/security/BashSecurityAnalyzer';

describe('checkCompoundReadOnly：正向（全段只读）', () => {
  it('cd + dir 串联', () => {
    const v = checkCompoundReadOnly(
      'cd /d "E:\\PY\\Documents\\CODES\\PY_APP" && dir /b'
    );
    expect(v.allowed).toBe(true);
    expect(v.segments).toHaveLength(2);
  });

  it('只读管道（含空引号模式）', () => {
    expect(
      checkCompoundReadOnly('dir /s /b *.ts | find /c /v ""').allowed
    ).toBe(true);
  });

  it('findstr 带引号模式 + 分号串联', () => {
    expect(
      checkCompoundReadOnly('findstr /s /n /c:"TODO" *.ts; where node').allowed
    ).toBe(true);
  });

  it('版本查询可作为段', () => {
    expect(checkCompoundReadOnly('node --version && dir').allowed).toBe(true);
  });

  it('git 只读子命令可作为段', () => {
    expect(checkCompoundReadOnly('git status | head').allowed).toBe(true);
  });
});

describe('checkCompoundReadOnly：负向（必须仍拒绝）', () => {
  const denied = (cmd: string): void => {
    expect(checkCompoundReadOnly(cmd).allowed).toBe(false);
  };

  it('重定向', () => {
    denied('dir > out.txt');
    denied('dir >> out.txt');
    denied('dir 2>nul');
  });

  it('命令替换 / 变量展开', () => {
    denied('echo $(whoami)');
    denied('dir `pwd`');
    denied('dir $HOME');
  });

  it('后台执行', () => {
    // FIX-2：`&` 的语义随 shell 而定 —— POSIX 下仍是后台执行，必须拒绝
    const v = checkCompoundReadOnly('dir & del x', { platform: 'linux' });
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain('后台执行');
  });

  it('FIX-2：cmd.exe 下 `&` 是分隔符 —— 全段只读则放行', () => {
    const v = checkCompoundReadOnly('echo CWD & dir /b', {
      platform: 'win32',
    });
    expect(v.allowed).toBe(true);
    expect(v.segments).toHaveLength(2);
  });

  it('FIX-2：cmd 分隔符不放宽写操作（任一段非只读仍拒）', () => {
    const v = checkCompoundReadOnly('dir & del x', { platform: 'win32' });
    expect(v.allowed).toBe(false);
    expect(v.reason).toContain('非只读命令');
  });

  it('任一段非只读', () => {
    denied('cd X && node script.js');
    denied('dir; rm -rf /');
    denied('find . -name x | xargs rm');
  });

  it('变量赋值 / 非常规命令名 / 空段', () => {
    denied('VAR=1; dir');
    denied('./scan.sh; dir');
    denied('C:\\Windows\\System32\\cmd.exe /c dir');
    denied('dir &&');
  });

  it('引号未闭合', () => {
    denied('dir "unclosed');
  });
});

describe('BashSecurityAnalyzer：复合只读放行', () => {
  const analyzer = new BashSecurityAnalyzer();

  it('全段只读 ⇒ allow（不再硬拒）', () => {
    const r = analyzer.analyze(
      'cd /d "E:\\PY\\Documents\\CODES\\PY_APP" && dir /b'
    );
    expect(r.behavior).toBe('allow');
    expect(r.matchedPatterns).toContain('compound-readonly');
  });

  it('管道只读 ⇒ allow', () => {
    const r = analyzer.analyze('dir /s /b *.ts | find /c /v ""');
    expect(r.behavior).toBe('allow');
  });

  it('含非只读段 ⇒ 仍 deny，且带可读原因（F1）', () => {
    const r = analyzer.analyze('cd X && node script.js');
    expect(r.behavior).toBe('deny');
    expect(r.message ?? '').toContain('复合命令被拒绝');
    expect(r.matchedPatterns.join(' | ')).toContain('compound-readonly denied');
  });

  it('重定向 ⇒ 仍 deny，且带可读原因（F1）', () => {
    const r = analyzer.analyze('dir > out.txt');
    expect(r.behavior).toBe('deny');
    expect((r.message ?? '').length).toBeGreaterThan(0);
    expect(r.message).toContain('重定向');
  });
});
