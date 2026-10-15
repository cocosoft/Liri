/**
 * 口径守则：「**命令输出是纯文本**」—— 输出构造式里不得再写 markdown 强调星号。
 *
 * 为什么（2026-10-16 取证）：命令输出在**四个面**呈现，其中 3 个面不渲染 markdown ——
 *   ① 桌面聊天（markdown 渲染 ⇒ `**X**` 变粗体）
 *   ② 客户端 Terminal 页（纯文本，逐行输出）
 *   ③ ink TUI（命令输出刻意以 `role:'system'` 呈现，不过 MarkdownRenderer）
 *   ④ legacy REPL / `executeOnce` / pipe（`console.log` 直出）
 * ⇒ 3/4 面会显**字面星号**（`**分支**: main`），故统一口径为「输出即纯文本」：
 * 标签直接写 `分支: `、需要强调时用中文引号「」。
 *
 * 本用例即该口径的**守则 + 自证**：扫描 `src/commands/**` 的输出构造式，
 * 命中 `**` 即红。白名单只有两类**非强调**用途：
 *   - `****`：密钥掩码（`env` / `onboard` / `provider`）；
 *   - glob 模式：其 `**` 是路径语义（多不落在输出构造式前缀上，兜底一并放行）。
 *
 * 历史案例：`Brief` / `Commit` / `Git` / `ContextWallet` / `agent` / `agents` 六处共
 * 约 50 个 `**标签**` 已按此口径改为纯文本（台账 COMMAND-OUTPUT-PLAIN-TEXT-STARS）。
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const APP_DIR = resolve(import.meta.dir, '../..');
const COMMANDS_DIR = join(APP_DIR, 'src/commands');

/** 输出构造式（本仓命令输出均经这几类入口拼成字符串）后跟 `**` */
const OUTPUT_LINE_WITH_STARS =
  /\b(summary|output|lines?\.push|value:|message:)[^\n]*\*\*/;

/** 非强调用途的白名单：掩码 `****`、glob `**` */
const ALLOWED = [/[*]{4}/, /\*\*\//, /\*\*\.[a-z]/];

function listTsFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules') continue;
      listTsFiles(full, out);
    } else if (name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** 注释行（JSDoc/行注释）里的 `**` 是排版，不是输出 */
const isComment = (line: string): boolean => /^\s*(\*|\/\/|\/\*)/.test(line);

describe('命令输出纯文本口径（守则 + 自证）', () => {
  it('`src/commands/**` 的输出构造式不得含 markdown 强调星号', () => {
    const offenders: string[] = [];

    for (const file of listTsFiles(COMMANDS_DIR)) {
      const lines = readFileSync(file, 'utf-8').split('\n');
      lines.forEach((line, i) => {
        if (isComment(line)) return;
        if (!OUTPUT_LINE_WITH_STARS.test(line)) return;
        if (ALLOWED.some((re) => re.test(line))) return;
        offenders.push(
          `${relative(APP_DIR, file)}:${i + 1}  ${line.trim().slice(0, 120)}`
        );
      });
    }

    expect(offenders).toEqual([]);
  });
});
