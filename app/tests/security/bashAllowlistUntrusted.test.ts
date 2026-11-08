// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * LRO-D3（2026-10-26 复核发现）：命令 allowlist 的两处口径。
 *
 * 失败窗口实测（04:15:54）：单条 `node -v` 也被判 `security_analyzer_deny`。
 * 代码侧机制有两条：
 * 1. 37 条只读前缀不含任何解释器/构建器 ⇒ 连版本查询都算"未知命令"；
 * 2. 未受信工作区下"未知命令"直接 **deny**（不是 ask）⇒ 用户连批准的机会都没有。
 *
 * 本用例钉住：版本查询放行、解释器本身仍属未知、shell 操作符仍硬拒、
 * 未受信由 deny 改 ask、危险命令仍 deny。
 */

import { describe, expect, it } from 'bun:test';
import { checkBashAllowlist } from '@openliri/infra/security/BashAllowlistMatcher';
import { BashSecurityAnalyzer } from '@openliri/infra/security/BashSecurityAnalyzer';

describe('LRO-D3：只读版本查询进入 allowlist', () => {
  it('解释器/构建器的版本查询 ⇒ 已知安全', () => {
    for (const cmd of [
      'node -v',
      'node --version',
      'npm -v',
      'bun --version',
      'git --version',
      'python3 --version',
    ]) {
      expect(checkBashAllowlist(cmd).safe).toBe(true);
    }
  });

  it('解释器本身仍属未知命令（不把 node 当只读）', () => {
    expect(checkBashAllowlist('node script.js').safe).toBe(false);
    expect(checkBashAllowlist('node -e "x"').safe).toBe(false);
    expect(checkBashAllowlist('git add -A').safe).toBe(false);
  });

  // 2026-11-09（真机：会话「全自动」下仍弹命令审批 —— 实际命令形如 `node -v 2>nul`）：
  // 良性重定向不改变语义，先剥离再判版本查询（与 compoundReadOnly 同口径）。
  it('版本查询 + 良性重定向 ⇒ 仍已知安全', () => {
    expect(checkBashAllowlist('node -v 2>nul').safe).toBe(true);
    expect(checkBashAllowlist('python --version 2>&1').safe).toBe(true);
    expect(checkBashAllowlist('node script.js 2>nul').safe).toBe(false);
  });

  it('版本查询 + 串联/重定向 ⇒ 仍按 shell 操作符拒绝', () => {
    expect(checkBashAllowlist('node -v && rm -rf /').safe).toBe(false);
    expect(checkBashAllowlist('node -v > out.txt').safe).toBe(false);
  });
});

describe('2026-11-08：工作区内良性写命令（mkdir/touch）不再弹审批', () => {
  it('工作区相对路径的建目录/建空文件 ⇒ 已知安全', () => {
    for (const cmd of [
      'mkdir output',
      'mkdir -p output/nested',
      'mkdir --parents a/b/c',
      'mkdir output docs',
      'touch output/a.md',
      'touch a.md b.md',
    ]) {
      expect(checkBashAllowlist(cmd).safe).toBe(true);
    }
  });

  it('越界/绝对路径/变量展开/未知开关 ⇒ 仍不放行（转审批）', () => {
    for (const cmd of [
      'mkdir /tmp/x',
      'mkdir C:\\temp\\x',
      'mkdir ../outside',
      'mkdir %TEMP%\\x',
      'mkdir -m 777 output',
      'touch ~/x.md',
      'mkdir',
    ]) {
      expect(checkBashAllowlist(cmd).safe).toBe(false);
    }
  });

  it('危险命令族不受影响（rm/del 仍为未知 ⇒ 不因新规则放行）', () => {
    expect(checkBashAllowlist('rm -rf output').safe).toBe(false);
    expect(checkBashAllowlist('del a.md').safe).toBe(false);
  });

  it('分析器端到端：mkdir output ⇒ 不 ask（真机卡点）', () => {
    const analyzer = new BashSecurityAnalyzer();
    expect(analyzer.analyze('mkdir output').behavior).not.toBe('ask');
    expect(analyzer.analyze('mkdir ../x').behavior).toBe('ask');
  });
});

describe('LRO-D3：未受信工作区不再静默硬拒', () => {
  const analyzer = new BashSecurityAnalyzer();

  it('未知命令（无信任级别）⇒ ask（转人工审批），不再 deny', () => {
    const result = analyzer.analyze('git add -A');
    expect(result.behavior).toBe('ask');
    expect(result.matchedPatterns?.join(' ')).toContain('Bash allowlist');
  });

  it('版本查询（无信任级别）⇒ 不拦', () => {
    const result = analyzer.analyze('node -v');
    expect(result.behavior).not.toBe('deny');
    expect(result.behavior).not.toBe('ask');
  });

  it('负向对照：危险命令在未受信下仍是 deny（不被 ask 放宽）', () => {
    const result = analyzer.analyze('rm -rf /');
    expect(result.behavior).toBe('deny');
  });

  it('受信工作区（development）行为不变：未知命令放行', () => {
    const result = analyzer.analyze('git add -A', 'development');
    expect(result.behavior).toBe('allow');
  });
});
