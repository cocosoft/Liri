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
import { checkCompoundReadOnly } from '@openliri/infra/security/compoundReadOnly';
import { stripHarmlessRedirects } from '@openliri/infra/security/compoundReadOnly';
import {
  BashSecurityAnalyzer,
  isUnconditionallyDeniedBashCommand,
} from '@openliri/infra/security/BashSecurityAnalyzer';

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

  // 2026-11-09（真机：会话「全自动」下仍弹命令审批 —— 实际命令如下）：
  // 切段后 `2>nul` 留在段尾，整串锚定的版本查询正则失配 ⇒ 整串被判「非只读命令（node）」。
  it('版本查询段带良性重定向 ⇒ 仍判只读', () => {
    const v = checkCompoundReadOnly(
      'node -v 2>nul & python --version 2>nul & echo --',
      { platform: 'win32' }
    );
    expect(v.allowed).toBe(true);
    expect(v.segments).toHaveLength(3);
  });

  it('负向：解释器执行脚本（非版本查询）即使带重定向仍拒绝', () => {
    expect(
      checkCompoundReadOnly('node -v2 2>nul', { platform: 'win32' }).allowed
    ).toBe(false);
    expect(
      checkCompoundReadOnly('node script.js 2>nul', { platform: 'win32' })
        .allowed
    ).toBe(false);
  });

  it('git 只读子命令可作为段', () => {
    expect(checkCompoundReadOnly('git status | head').allowed).toBe(true);
  });

  it('FIX-9：丢弃/合并型重定向不算写操作（2>nul / 2>&1 / /dev/null）', () => {
    // 真机：`where /r C:\Users\csdnc openliri 2>nul` 被 analyzer deny
    expect(
      checkCompoundReadOnly('where /r C:\\Users\\csdnc openliri 2>nul', {
        platform: 'win32',
      }).allowed
    ).toBe(true);
    expect(
      checkCompoundReadOnly('dir /b X 2>nul & dir /b Y', {
        platform: 'win32',
      }).allowed
    ).toBe(true);
    expect(
      checkCompoundReadOnly('dir /b X 2>&1 | findstr a', { platform: 'win32' })
        .allowed
    ).toBe(true);
    expect(checkCompoundReadOnly('ls /tmp 2>/dev/null').allowed).toBe(true);
  });

  it('FIX-9 负向：写文件型重定向（> / >>）仍拒绝', () => {
    expect(checkCompoundReadOnly('dir > out.txt').allowed).toBe(false);
    expect(checkCompoundReadOnly('dir >> out.txt').allowed).toBe(false);
    expect(checkCompoundReadOnly('dir >nulx').allowed).toBe(false);
  });

  // B2-2（2026-10-30，issue #36）：引号内的 `>`/`<` 是普通字符
  it('B2-2：引号内的 `>` 不再被当成重定向（findstr 模式）', () => {
    expect(
      checkCompoundReadOnly(
        'git show --stat --oneline abc | findstr /c:"=>" /c:"renamed"'
      ).allowed
    ).toBe(true);
    // 引号外的写文件重定向仍拒绝
    expect(checkCompoundReadOnly('dir "x" > out.txt').allowed).toBe(false);
  });

  // B3（2026-10-30，issue #37）：只读放行必须带结构化标记（供 AST 不确定分支免 ask）
  it('B3：只读族放行结论带 readOnly 标记；危险命令不带', () => {
    const analyzer = new BashSecurityAnalyzer();
    expect(analyzer.analyze('findstr /n /c:"a" x.ts').readOnly).toBe(true);
    expect(
      analyzer.analyze('dir /b x | find /c /v ""', undefined).readOnly
    ).toBe(true);
    expect(analyzer.analyze('rm -rf /').readOnly).toBeUndefined();
  });
});

describe('checkCompoundReadOnly：负向（必须仍拒绝）', () => {
  const denied = (cmd: string): void => {
    expect(checkCompoundReadOnly(cmd).allowed).toBe(false);
  };

  it('重定向（写文件）', () => {
    denied('dir > out.txt');
    denied('dir >> out.txt');
    // FIX-9（2026-10-27）：`dir 2>nul` 属"丢弃 stderr"，已移入正向（见上方 FIX-9 用例）；
    // 写文件型重定向仍必须拒绝。
  });

  it('命令替换 / 变量展开', () => {
    denied('echo $(whoami)');
    denied('dir `pwd`');
    // D-2（2026-11-27）：**白名单只读变量 + 参数位置** 例外（见下方 D-2 用例）；
    // 非白名单变量 / 段首变量 / 命令替换仍拒。
    expect(checkCompoundReadOnly('dir $HOME').allowed).toBe(true);
    denied('dir $FILE');
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

// D-2（2026-11-27）：`$` 不再一律硬拒 —— 只放行「参数位置 + 只读环境变量白名单」；
// 命令替换 / 段首变量 / 非白名单变量 / 重定向 / 后台 仍按原样拒绝（fail-closed）。
describe('D-2：白名单变量展开', () => {
  const analyzer = new BashSecurityAnalyzer();

  it('参数位置的白名单变量 ⇒ allow（此前 `echo $HOME` 连审批机会都没有）', () => {
    expect(analyzer.analyze('echo $HOME').behavior).toBe('allow');
    expect(analyzer.analyze('ls "$TEMP"').behavior).toBe('allow');
    expect(analyzer.analyze('echo ${USERPROFILE}').behavior).toBe('allow');
  });

  it('复合命令里的白名单变量 ⇒ 仍逐段过只读白名单', () => {
    expect(analyzer.analyze('cd $HOME && dir /b').behavior).toBe('allow');
  });

  it('非白名单变量 ⇒ 仍 deny', () => {
    expect(analyzer.analyze('cat $FILE').behavior).toBe('deny');
  });

  it('段首变量（当命令名）⇒ 仍 deny', () => {
    expect(analyzer.analyze('$CMD arg').behavior).toBe('deny');
  });

  it('命令替换 ⇒ 仍 deny（`$(…)` 与反引号）', () => {
    expect(analyzer.analyze('echo $(whoami)').behavior).toBe('deny');
    expect(analyzer.analyze('echo `whoami`').behavior).toBe('deny');
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

  it('含非只读段 ⇒ 转人工审批（N-7：与单条未知命令同口径）', () => {
    const r = analyzer.analyze('cd X && node script.js');
    expect(r.behavior).toBe('ask');
    // 归因必须指向"整串复合命令"，而不是"node 不能跑"
    expect(r.message ?? '').toContain('复合命令含非只读段');
    expect(r.message ?? '').toContain('需人工确认');
    expect(r.matchedPatterns.join(' | ')).toContain('Bash allowlist');
  });

  it('含危险段（sudo 等）⇒ 仍 deny（fail-closed）', () => {
    const r = analyzer.analyze('cd X && sudo ls');
    expect(r.behavior).toBe('deny');
    expect(r.message ?? '').toContain('危险命令');
    expect(r.matchedPatterns).toContain('compound-dangerous-segment');
  });

  it('真机形态：cd + node --check + echo ⇒ ask（此前被硬拒）', () => {
    const r = analyzer.analyze(
      'cd output\\mario-verify3 && node --check game.js && echo "CHECK_OK"'
    );
    expect(r.behavior).toBe('ask');
    expect(r.message ?? '').toContain('复合命令含非只读段');
    // 仍给出可照抄的单条写法（G5 不回归）
    expect(r.message ?? '').toContain('等价单条写法');
  });

  // 2026-11-22（真机会话 session_mwr473pd502e995dd1）：`set` 只查看环境变量仍需审批。
  // `set` 无法整体进白名单（可能是 `set VAR=value` 赋值），故按参数区分。
  it('set 查看（无赋值）属只读 ⇒ allow', () => {
    expect(
      analyzer.analyze('set | findstr /i "PYAPP USERPROFILE"').behavior
    ).toBe('allow');
    expect(analyzer.analyze('set PATH | findstr PATH').behavior).toBe('allow');
  });

  it('set 赋值 ⇒ 仍转审批（不整体放宽）', () => {
    const r = analyzer.analyze('set FOO=1 && dir');
    expect(r.behavior).toBe('ask');
  });

  // 2026-11-22：`set /a` 是**算术求值**（结果只打印），只有含赋值运算符才是写。
  it('set /a 纯算术（无赋值）⇒ allow', () => {
    for (const cmd of [
      'set /a 1+1',
      'set /a (1+1)*2',
      'set /a 1==1',
      'set /a "3>>1"',
      'set /a 2*(3+4)',
    ]) {
      expect({ cmd, behavior: analyzer.analyze(cmd).behavior }).toEqual({
        cmd,
        behavior: 'allow',
      });
    }
  });

  it('set /a 含赋值（含复合赋值）⇒ 仍转审批', () => {
    for (const cmd of [
      'set /a X=1',
      'set /a "X=1"',
      'set /a X+=1',
      'set /a "X<<=1"',
      'set /a X=1==1',
    ]) {
      expect({ cmd, behavior: analyzer.analyze(cmd).behavior }).toEqual({
        cmd,
        behavior: 'ask',
      });
    }
  });

  it('set /a 未加引号的移位号由 cmd 当重定向解析 ⇒ deny（fail-closed）', () => {
    expect(analyzer.analyze('set /a X<<=1').behavior).toBe('deny');
    expect(analyzer.analyze('set /a 3>>1').behavior).toBe('deny');
  });

  it('`/a` 不是首个开关时按普通 set 判定（`set X=1 /a` 是赋值）', () => {
    expect(analyzer.analyze('set X=1 /a').behavior).toBe('ask');
    expect(analyzer.analyze('set FOO /a').behavior).toBe('allow');
  });

  it('set 参数含 cmd 展开符（%VAR% / !VAR!）⇒ 不放行', () => {
    expect(analyzer.analyze('set /a %X%').behavior).toBe('ask');
    expect(analyzer.analyze('set %X%').behavior).toBe('ask');
    expect(analyzer.analyze('set /a !X!').behavior).toBe('ask');
  });

  it('重定向 ⇒ 仍 deny，且带可读原因（F1）', () => {
    const r = analyzer.analyze('dir > out.txt');
    expect(r.behavior).toBe('deny');
    expect((r.message ?? '').length).toBeGreaterThan(0);
    expect(r.message).toContain('重定向');
  });
});

describe('G5（2026-11-03）：Bash 侧拒绝必须自带「等价单条写法」', () => {
  const analyzer = new BashSecurityAnalyzer();

  it('非只读段 ⇒ 点名该命令并给出拆分写法（真机 seq 1279 / 3221）', () => {
    const r = analyzer.analyze('cd X && if exist x dir /b');
    // N-7：改为转人工审批（不再硬拒），但可照抄的等价写法必须保留
    expect(r.behavior).toBe('ask');
    expect(r.message ?? '').toContain('等价单条写法');
    expect(r.message ?? '').toContain('「if」');
  });

  it('重定向 ⇒ 指向 file_write 而不是让模型反复重试', () => {
    const r = analyzer.analyze('dir > out.txt');
    expect(r.message ?? '').toContain('等价单条写法');
    expect(r.message ?? '').toContain('file_write');
  });

  it('变量/命令替换 ⇒ 给出展开写法', () => {
    const r = analyzer.analyze('echo $(whoami) | findstr a');
    expect(r.message ?? '').toContain('等价单条写法');
    expect(r.message ?? '').toContain('字面值');
  });

  it('非常规命令名（路径前缀）⇒ 给出裸命令名写法', () => {
    const r = analyzer.analyze('C:\\Windows\\System32\\cmd.exe /c dir; dir');
    expect(r.message ?? '').toContain('裸命令名');
  });
});

// ─── P1-3（2026-11-06，审批/熔断根因簇）：丢弃型重定向不得让单条命令落入"复合"硬拒 ───
describe('P1-3：`2>&1` / `2>nul` 不再触发复合命令硬拒', () => {
  const analyzer = new BashSecurityAnalyzer();

  it('单条非只读命令 + 静音重定向 ⇒ ask（保留审批），不再 deny', () => {
    // 真机：`bun test 2>&1` 连续 4 次被 deny，报文误写成"非只读命令（bun）"
    const r = analyzer.analyze('bun test 2>&1');
    expect(r.behavior).toBe('ask');
    expect(r.message ?? '').not.toContain('复合命令被拒绝');
  });

  it('只读命令 + 静音重定向 ⇒ 仍按只读放行', () => {
    expect(analyzer.analyze('dir /b 2>nul').behavior).toBe('allow');
    expect(analyzer.analyze('where /r C:\\Users csdnc 2>nul').behavior).toBe(
      'allow'
    );
  });

  it('负向：写文件型重定向仍 deny（不得被顺带放行）', () => {
    const r = analyzer.analyze('bun test > out.txt');
    expect(r.behavior).toBe('deny');
    expect(r.message ?? '').toContain('重定向');
  });

  it('stripHarmlessRedirects：只剥离丢弃/合并型，写文件型原样保留', () => {
    expect(stripHarmlessRedirects('bun test 2>&1')).toBe('bun test');
    expect(stripHarmlessRedirects('dir /b 2>nul')).toBe('dir /b');
    expect(stripHarmlessRedirects('ls /tmp 2>/dev/null')).toBe('ls /tmp');
    expect(stripHarmlessRedirects('bun test > out.txt')).toBe(
      'bun test > out.txt'
    );
    expect(stripHarmlessRedirects('dir 2>nulx')).toBe('dir 2>nulx');
  });
});

// ─── P0（2026-11-22）：只读命令的「写 / 执行型开关」一律 deny（不可经审批放行） ───
describe('P0：只读族的参数级禁区（analyzer 端到端）', () => {
  const analyzer = new BashSecurityAnalyzer();

  const denied = [
    'find . -exec node evil.js +',
    'find . -execdir rm -rf {} +',
    'find . -ok node evil.js +',
    'find . -delete',
    'find . -fprint out.txt',
    'find . -fls out.txt',
    'rg --pre sh TODO',
    'sort -o out.txt in.txt',
    'sort --output=out.txt in.txt',
    'sort --compress-program=sh in.txt',
    'sort /O out.txt in.txt',
    'uniq in.txt out.txt',
    'tree -o out.txt .',
    'date -s 2020-01-01',
    'date 01/01/2020',
    'file -C',
  ];

  for (const command of denied) {
    it(`deny：${command}`, () => {
      const r = analyzer.analyze(command);
      expect(r.behavior).toBe('deny');
      expect(r.matchedPatterns.join(' | ')).toContain('readonly-arg-guard');
      // 报文必须可照抄（等价只读写法）
      expect(r.message ?? '').toContain('等价');
      // 恒定 deny ⇒ 不可经审批放行
      expect(isUnconditionallyDeniedBashCommand(command)).toBe(true);
    });
  }

  const allowed = [
    'find . -name "*.ts"',
    'rg TODO src',
    'sort in.txt',
    'sort -n in.txt',
    'uniq in.txt',
    'tree .',
    'date',
    'date +%Y-%m-%d',
    'file package.json',
  ];

  for (const command of allowed) {
    it(`仍 allow：${command}`, () => {
      expect(analyzer.analyze(command).behavior).toBe('allow');
      expect(isUnconditionallyDeniedBashCommand(command)).toBe(false);
    });
  }

  it('复合命令逐段判定：任一段带执行开关 ⇒ deny（不是 ask）', () => {
    for (const command of [
      'cd X && find . -exec node evil.js +',
      'dir && sort -o out.txt in.txt',
      'echo a; uniq in.txt out.txt',
    ]) {
      const r = analyzer.analyze(command, undefined, {});
      expect({ command, behavior: r.behavior }).toEqual({
        command,
        behavior: 'deny',
      });
      expect(r.message ?? '').toContain('等价');
    }
  });

  it('未加守卫的命令仍维持原口径（只读放行 / 未知转审批）', () => {
    expect(analyzer.analyze('dir /b').behavior).toBe('allow');
    expect(analyzer.analyze('node script.js').behavior).toBe('ask');
  });
});
