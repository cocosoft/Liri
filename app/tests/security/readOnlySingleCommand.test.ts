/**
 * FIX-16（2026-10-27）：**单条只读命令**与"多段只读串联"必须同一口径。
 *
 * 真机（会话 `session_mvq91mtme1e76c5808`，10:14–10:26Z）11 次 `security_analyzer_ask`：
 * - `findstr /i /c:"cwd" … app.log` → 基命令不在 `ALLOWED_COMMANDS` ⇒ ask；
 * - `git -C … log --oneline -12` → 同上（`compoundReadOnly` 认 git 只读子命令，单条却不认）；
 * - `tasklist /fi … /fo list` → 同上（`READ_ONLY_BASES` 含 `tasklist`，单条却 ask）；
 * - `dir /b "…\PY_APP\bin"` → `sensitive_directory_access`（`/bin` 的反斜杠变体 `\bin`
 *   命中任何 Windows 路径）⇒ 误判。
 *
 * 口径：单条命令复用 `compoundReadOnly` 的只读族（不再维护第二套）；负向边界保持原样。
 */
import { describe, expect, it } from 'bun:test';
import { BashSecurityAnalyzer } from '../../src/security/BashSecurityAnalyzer.js';

const analyzer = new BashSecurityAnalyzer();

describe('FIX-16 单条只读命令放行', () => {
  it('findstr / git log / tasklist 单独执行 ⇒ allow（与复合只读同口径）', () => {
    for (const cmd of [
      'findstr /i /c:"cwd" "C:\\Users\\csdnc\\.pyapp\\data\\logs\\app.log"',
      'git -C E:\\PY\\Documents\\CODES\\PY_APP log --oneline -12',
      'tasklist /fi "imagename eq bun.exe" /fo list',
      'git --no-pager -C E:\\PY\\Documents\\CODES\\PY_APP log -3',
    ]) {
      expect(analyzer.analyze(cmd).behavior).toBe('allow');
    }
  });

  it('只读串联仍放行（回归）', () => {
    expect(analyzer.analyze('dir /b *.ts | find /c /v ""').behavior).toBe(
      'allow'
    );
  });

  it('负向：非只读基命令仍不因本改动放行', () => {
    for (const cmd of [
      'findstr /c:"x" a.txt > out.txt',
      'del /f important.txt',
      "node -e \"require('fs').rmSync('x')\"",
    ]) {
      expect(analyzer.analyze(cmd).behavior).not.toBe('allow');
    }
  });
});

describe('FIX-16b Windows 路径里的 \\bin 不再误判敏感目录', () => {
  it('dir /b "…\\PY_APP\\bin" 不因 sensitive_directory_access 转审批', () => {
    const r = analyzer.analyze(
      'dir /b "E:\\PY\\Documents\\CODES\\PY_APP\\bin"'
    );
    expect(r.matchedPatterns ?? []).not.toContain('sensitive_directory_access');
    expect(r.behavior).toBe('allow');
  });
});
