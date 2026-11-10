// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 编码攻击判定的误报回归（2026-11-10）。
 *
 * 真机 `session_mwafnqnjdbfc550f7b`：demand 任务把产物写进**会话工作区**（`C:\Users\…\demand-ws`），
 * 但 `file_write` 连续 2 轮被判 `Permission denied: Input contains Unicode encoding attack`
 * ⇒ `environment_blocked`，整轮失败。
 *
 * 根因：`detectEncodingAttack` 收到的是 `JSON.stringify(input).toLowerCase()`，Windows 绝对路径
 * 转义后为 `c:\\users\\…`，`includes('\\u')` 直接命中。现要求**完整转义序列**：
 * 真转义攻击仍拦，路径里的"反斜杠 + u/x"不再误报。
 */

import { describe, expect, it } from 'bun:test';
import { detectEncodingAttack } from '@openliri/infra/permission/classifiers/injection-rules';
import { AutoModeClassifier } from '@openliri/infra/permission/classifiers/AutoModeClassifier';

const viaJson = (input: Record<string, unknown>): string =>
  JSON.stringify(input).toLowerCase();

describe('detectEncodingAttack：Windows 路径不再误报', () => {
  it('C:\\Users\\… 的 file_write 输入不判 Unicode 编码攻击', () => {
    const input = viaJson({
      file_path:
        'C:\\Users\\csdnc\\AppData\\Local\\Temp\\liri-acc\\demand-ws\\index.html',
      content: '<canvas id="gameCanvas"></canvas>',
    });
    expect(detectEncodingAttack(input)).toBeNull();
  });

  it('C:\\x… 这类路径不判十六进制编码攻击', () => {
    const input = viaJson({ file_path: 'C:\\xampp\\htdocs\\index.html' });
    expect(detectEncodingAttack(input)).toBeNull();
  });
});

describe('detectEncodingAttack：真实转义仍被拦截', () => {
  it('完整 Unicode 转义（\\u4f60）仍拦', () => {
    const decision = detectEncodingAttack(
      viaJson({ content: '\\u4f60\\u597d' })
    );
    expect(decision?.shouldBlock).toBe(true);
    expect(decision?.reason).toContain('Unicode');
  });

  it('完整十六进制转义（\\x41）仍拦', () => {
    const decision = detectEncodingAttack(viaJson({ command: 'echo \\x41' }));
    expect(decision?.shouldBlock).toBe(true);
    expect(decision?.reason).toContain('hexadecimal');
  });

  it('%u 形式的 Unicode 编码仍拦；Base64 解码与路径穿越不变', () => {
    expect(detectEncodingAttack('echo %u4f60')?.shouldBlock).toBe(true);
    expect(detectEncodingAttack('base64 -d payload.txt')?.shouldBlock).toBe(
      true
    );
    expect(detectEncodingAttack('open %2e%2e/etc/passwd')?.shouldBlock).toBe(
      true
    );
  });
});

describe('AutoModeClassifier：文件载荷的正文不当作命令扫描', () => {
  const classifier = new AutoModeClassifier();

  it('file_write 正文含 ` at ` / `</script>` / `|` / `0x` 不再被拒', async () => {
    const decision = await classifier.classify(
      'file_write',
      {
        file_path: 'ws/index.html',
        content:
          '<script>const c = 0xff00ff; const a = 1 | 2;</script>\nMeet me at 10.',
      },
      []
    );
    expect(decision.shouldBlock).toBe(false);
  });

  it('file_write 正文里的真实转义序列也不再误判（正文不执行）', async () => {
    const decision = await classifier.classify(
      'file_write',
      { file_path: 'ws/a.js', content: 'const s = "\\u4f60";' },
      []
    );
    expect(decision.shouldBlock).toBe(false);
  });

  it('bash 的 command 仍按原规则拦截（执行面不变）', async () => {
    const decision = await classifier.classify(
      'bash',
      { command: 'echo a && echo b' },
      []
    );
    expect(decision.shouldBlock).toBe(true);
    expect(decision.reason).toContain('dangerous command pattern');
  });

  it('执行面工具（bash / code）仍整体扫描', async () => {
    const bash = await classifier.classify(
      'bash',
      { command: 'echo a && echo b' },
      []
    );
    expect(bash.shouldBlock).toBe(true);

    const code = await classifier.classify(
      'code',
      { code: 'exec("\\x41")' },
      []
    );
    expect(code.shouldBlock).toBe(true);
  });

  it('非执行工具（todo_write）的正文不再被命令令牌误杀', async () => {
    const decision = await classifier.classify(
      'todo_write',
      {
        action: 'write',
        title: '交付贪吃蛇',
        todos: [
          { id: '1', content: '检查工作区 at 10:00', status: 'in_progress' },
        ],
      },
      []
    );
    expect(decision.shouldBlock).toBe(false);
  });

  it('方案①：解释器名作为**参数**的只读探测不再命中（真机 `Get-Command node`）', async () => {
    const probe = await classifier.classify(
      'powershell',
      { command: 'Get-Command node -ErrorAction SilentlyContinue' },
      []
    );
    expect(probe.shouldBlock).toBe(false);

    const argsOnly = await classifier.classify(
      'bash',
      { command: 'echo repeat node python' },
      []
    );
    expect(argsOnly.shouldBlock).toBe(false);
  });

  it('方案①：命令位命中仍拦（含分隔符之后 / 外壳命令之后）', async () => {
    const cases = [
      'node -e "console.log(1)"',
      'echo hi; node -e "x"',
      'sudo rm -rf /',
      'echo hi | sh',
      'at 10:00 cmd.exe',
    ];
    for (const command of cases) {
      const decision = await classifier.classify('bash', { command }, []);
      expect(decision.shouldBlock).toBe(true);
    }
  });
});

describe('SENSITIVE_PATH_PATTERNS：收窄为真正敏感路径（2026-11-10 用户裁定）', () => {
  const classifier = new AutoModeClassifier();

  it('会话工作区这类 C:\\Users\\<me> 绝对路径不再判敏感', async () => {
    const decision = await classifier.classify(
      'file_write',
      { file_path: 'C:\\Users\\me\\ws\\index.html', content: 'ok' },
      []
    );
    expect(decision.shouldBlock).toBe(false);
  });

  it('System32 / 账号级 / UNC 管理共享仍判敏感（安全面不削弱）', async () => {
    for (const path of [
      'C:\\Windows\\System32\\config\\SAM',
      'C:\\Users\\Administrator\\Desktop\\a.txt',
      '\\\\localhost\\c$\\secret.txt',
    ]) {
      const decision = await classifier.classify(
        'file_write',
        { file_path: path, content: 'ok' },
        []
      );
      expect(decision.shouldBlock).toBe(true);
      expect(decision.reason).toContain('sensitive path');
    }
  });
});
