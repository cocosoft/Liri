/**
 * lint:session — 会话链路回归防护
 *
 * 把 2026-08-14 修复的会话链路问题变成 CI 门禁，防止回归：
 *   BUG-A：LocalHTTPServiceSSE.handleEvents 必须在 writeHead 后调用 res.flushHeaders()
 *          （缺失时浏览器 EventSource onopen 延迟 15s，心跳保活/重连失真）
 *   BUG-B：CoreAPIImpl.autoGenerateTitle 必须用 ?? 生成兜底标题
 *          （generateSessionTitle 内部 catch 返回 null，catch 兜底分支不可达，需 ?? 降级）
 *   BUG-C：StreamPipeline._truncateApiMessages 必须跳过 role === 'system' 的消息
 *          （splice(1,1) 逐个删会误删系统提示，需 findIndex 过滤 system）
 *   LOG-1/LOG-2（第四十七次）：日志刷屏修复——"清除旧轮次 assistant tool_calls" 必须为
 *          logger.debug 汇总（禁止 logger.info 逐条，历史 100+ 条时每轮刷屏 100+ 行）
 *   USAGE-1/2/3（第四十七次）：成本 0/0 重复记录修复——三处 usage 上报必须含空守卫
 *          （prompt_tokens ?? 0，usage 缺失时跳过，避免 0/0 tokens 污染成本/LLMTracker）
 *
 * 运行：bun run lint:session（app/package.json）或 CI arch-check job 直接执行
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const PROJECT_ROOT = process.env.PYAPP_PROJECT_DIR
  ? join(process.cwd(), process.env.PYAPP_PROJECT_DIR)
  : process.cwd();

interface Check {
  /** 相对项目根的文件路径 */
  file: string;
  /** 目标函数名（用于定位函数体）；不提供时检查整个文件内容 */
  funcName?: string;
  /** 函数体/文件内容必须出现的模式 */
  requiredPattern: string;
  /** 禁止出现的模式（可选，如日志级别残留） */
  forbiddenPattern?: string;
  /** 检查说明 */
  description: string;
}

const CHECKS: Check[] = [
  {
    file: 'app/src/infrastructure/http/LocalHTTPServiceSSE.ts',
    funcName: 'handleEvents',
    requiredPattern: 'flushHeaders',
    description:
      'BUG-A：SSE handleEvents 必须在 writeHead 后调用 res.flushHeaders()（防止 onopen 延迟 15s）',
  },
  {
    file: 'app/src/runtime/api/CoreAPIImpl.ts',
    funcName: 'autoGenerateTitle',
    requiredPattern: '??',
    description:
      'BUG-B：autoGenerateTitle 必须用 ?? 生成兜底标题（LLM 失败时降级，catch 兜底不可达）',
  },
  {
    file: 'app/src/chat/pipeline/StreamPipeline.ts',
    funcName: '_truncateApiMessages',
    requiredPattern: "role !== 'system'",
    description:
      'BUG-C：_truncateApiMessages 必须跳过 system 消息（防止截断误删系统提示）',
  },
  {
    file: 'app/src/chat/orchestrator/sendMessageFlow.ts',
    requiredPattern: "logger.debug('清除旧轮次 assistant tool_calls",
    forbiddenPattern: "logger.info('清除旧轮次 assistant tool_calls",
    description:
      'LOG-1：日志刷屏修复 — 清除旧轮次 tool_calls 必须为 debug 汇总（禁止 info 逐条刷屏）',
  },
  {
    file: 'app/src/chat/ChatManager.ts',
    requiredPattern: "logger.debug('清除旧轮次 assistant tool_calls",
    forbiddenPattern: "logger.info('清除旧轮次 assistant tool_calls",
    description:
      'LOG-2：日志刷屏修复 — ChatManager 同款（buildApiMessages 路径）',
  },
  {
    file: 'app/src/chat/ReActToolLoop.ts',
    funcName: '_reportUsage',
    requiredPattern: 'prompt_tokens ?? 0',
    description:
      'USAGE-1：成本 0/0 修复 — _reportUsage 必须含空 usage 守卫（usage 缺失时跳过记录）',
  },
  {
    file: 'app/src/chat/pipeline/StreamPipeline.ts',
    funcName: 'recordUsage',
    requiredPattern: 'prompt_tokens ?? 0',
    description:
      'USAGE-2：成本 0/0 修复 — recordUsage 必须含空 usage 守卫（finalResponse 缺失时跳过）',
  },
  {
    file: 'app/src/chat/orchestrator/sendMessageFlow.ts',
    requiredPattern: 'prompt_tokens ?? 0',
    description:
      'USAGE-3：成本 0/0 修复 — sendMessageFlow 非流式路径必须含空 usage 守卫（invokeLlm 内）',
  },
];

/**
 * 定位函数体：找到 funcName 的"定义形态"（后跟 '('），括号配对到对应的 ')'，
 * 跳过返回类型（如 : Promise<void>），找到 '{' 后括号配对返回函数体内容。
 */
function findFunctionBody(content: string, funcName: string): string | null {
  let searchFrom = 0;
  for (;;) {
    const idx = content.indexOf(funcName, searchFrom);
    if (idx === -1) return null;
    searchFrom = idx + funcName.length;

    // 排除调用形态（this.xxx(），只匹配定义形态（前一个字符不是 '.'）
    if (idx > 0 && content[idx - 1] === '.') continue;

    // 仅接受"后跟 '(' "的出现（排除注释/字符串中的同名文本）
    let p = idx + funcName.length;
    while (p < content.length && /\s/.test(content[p]!)) p++;
    if (content[p] !== '(') continue;

    // 配对 '(' 到 ')'
    let depth = 0;
    let inString: string | null = null;
    let i = p;
    for (; i < content.length; i++) {
      const c = content[i]!;
      if (inString) {
        if (c === '\\') i++;
        else if (c === inString) inString = null;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') {
        inString = c;
        continue;
      }
      if (c === '(') depth++;
      else if (c === ')') {
        depth--;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) return null;
    i++;

    // 跳过返回类型（: Promise<void> 等）直到 '{'（限制 200 字符，防止跳入其他函数）
    let braceScan = 0;
    while (i < content.length && content[i] !== '{' && braceScan < 200) {
      i++;
      braceScan++;
    }
    if (content[i] !== '{') continue;

    // 配对 '{' 到 '}'
    depth = 0;
    inString = null;
    const start = i;
    for (; i < content.length; i++) {
      const c = content[i]!;
      if (inString) {
        if (c === '\\') i++;
        else if (c === inString) inString = null;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') {
        inString = c;
        continue;
      }
      if (c === '/' && content[i + 1] === '/') {
        while (i < content.length && content[i] !== '\n') i++;
        continue;
      }
      if (c === '/' && content[i + 1] === '*') {
        i += 2;
        while (i < content.length && !(content[i] === '*' && content[i + 1] === '/')) i++;
        i++;
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) return content.slice(start, i + 1);
      }
    }
    return null;
  }
}

// ============ 主流程 ============

const failures: string[] = [];

for (const check of CHECKS) {
  const absPath = join(PROJECT_ROOT, check.file);
  let content: string;
  try {
    content = readFileSync(absPath, 'utf-8');
  } catch {
    failures.push(`[FAIL] 文件不存在: ${check.file}`);
    continue;
  }

  // 提供 funcName 时定位函数体检查，否则检查整个文件（文件级模式，如日志级别）
  const body = check.funcName
    ? findFunctionBody(content, check.funcName)
    : content;
  if (!body) {
    failures.push(`[FAIL] 未找到函数 ${check.funcName}: ${check.file}`);
    continue;
  }

  const where = check.funcName ?? '(文件级)';
  if (!body.includes(check.requiredPattern)) {
    failures.push(
      `[FAIL] ${check.file} ${where} 缺少模式 "${check.requiredPattern}": ${check.description}`,
    );
    continue;
  }
  if (check.forbiddenPattern && body.includes(check.forbiddenPattern)) {
    failures.push(
      `[FAIL] ${check.file} ${where} 禁止出现 "${check.forbiddenPattern}": ${check.description}`,
    );
    continue;
  }
  console.log(`[PASS] ${check.file} ${where}: ${check.description}`);
}

console.log('');

if (failures.length === 0) {
  console.log('[lint:session] ✅ 0 违规 — BUG-A/B/C 回归防护全部通过');
  process.exit(0);
}

console.log(`[lint:session] ❌ ${failures.length} 处违规：`);
for (const f of failures) {
  console.log(`  ${f}`);
}
console.log('\n[lint:session] 结果：FAIL');
process.exit(1);
