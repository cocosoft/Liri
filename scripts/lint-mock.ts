/**
 * lint:mock — CS04（Mock 数据零容忍）自动化检查
 *
 * 扫描前端 views 目录的 useState 假数据模式（硬编码对象数组初值），
 * 把"无 mock"从人工 grep 变成可重复执行的自动化检查（补短板 DoD 第 5 条）。
 *
 * 检查项：
 *  1. useState 初始值为非空对象数组（如 useState<X[]>([{...},{...}])）→ 硬编码假数据
 *  2. 已知 mock 命名常量（mock/fake/sample 前缀或 suffix，排除注释）
 *
 * 运行：bun run lint:mock（app/package.json）
 */

import { readdirSync, readFileSync } from 'fs';
import { join, sep } from 'path';

const PROJECT_ROOT = process.env.PYAPP_PROJECT_DIR
  ? join(process.cwd(), process.env.PYAPP_PROJECT_DIR)
  : process.cwd();

const VIEWS_DIR = join(PROJECT_ROOT, 'client/src/components/views');
const CHECK_EXTENSIONS = new Set(['.tsx', '.ts']);

/** 白名单（路径归一化 / 分隔，相对 client/src/） */
const FILE_WHITELIST = new Set<string>([
  // 示例/演示页（非业务数据）
  'components/views/office/OfficeDocPage.tsx',
]);

/** 白名单行号（精确豁免，key = 相对路径:行号） */
const LINE_WHITELIST = new Set<string>([]);

// ─── 检测 1：useState 初始非空对象数组 ───
// 用括号配对解析（跳过泛型/字符串），避免正则误匹配泛型里的 [] 导致跨行吞噬

/** 从内容中定位所有 useState，返回其初始值数组内容（无数组则 null） */
function extractUseStateArrayBody(
  content: string,
  start: number,
): { body: string; end: number } | null {
  let i = start + 'useState'.length;
  const skipWs = () => {
    while (i < content.length && /\s/.test(content[i]!)) i++;
  };

  skipWs();
  // 跳过泛型 <...>
  if (content[i] === '<') {
    let depth = 0;
    while (i < content.length) {
      if (content[i] === '<') depth++;
      else if (content[i] === '>') {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
      i++;
    }
    skipWs();
  }
  if (content[i] !== '(') return null;
  i++;
  skipWs();
  if (content[i] !== '[') return null;
  i++;
  // 提取数组内容（括号配对 + 字符串跳过）
  let depth = 1;
  let body = '';
  while (i < content.length && depth > 0) {
    const c = content[i]!;
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') depth--;
    else if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      i++;
      while (i < content.length && content[i] !== quote) {
        if (content[i] === '\\') i++;
        i++;
      }
    }
    if (depth > 0) body += c;
    i++;
  }
  return { body, end: i };
}

/** mock 命名常量（独立正则，仅业务层 mock/fake/sample 前缀） */
const MOCK_NAMED_PATTERN =
  /\b(?:mock|fake|sample)[A-Z]+\w*\s*[=:]\s*\[/i;

/** 是否为注释行 */
function isCommentLine(line: string): boolean {
  const t = line.trim();
  return (
    t.startsWith('//') ||
    t.startsWith('*') ||
    t.startsWith('/*') ||
    t.startsWith('<!--')
  );
}

/** 递归收集文件 */
function collectFiles(dir: string): string[] {
  const results: string[] = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (
      entry.name === 'node_modules' ||
      entry.name === '.git' ||
      entry.name === 'dist' ||
      entry.name === '__tests__'
    ) {
      continue;
    }
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath));
    } else {
      const ext = entry.name.slice(entry.name.lastIndexOf('.'));
      if (CHECK_EXTENSIONS.has(ext)) results.push(fullPath);
    }
  }
  return results;
}

interface Violation {
  file: string;
  line: number;
  message: string;
}

function scanFile(file: string, violations: Violation[]): void {
  const rel = file.replace(PROJECT_ROOT + sep, '').replaceAll(sep, '/');
  if (FILE_WHITELIST.has(rel)) return;

  const content = readFileSync(file, 'utf-8');
  const lines = content.split('\n');

  // 检测 1：useState 对象数组（括号配对解析，逐处定位）
  let searchFrom = 0;
  while (true) {
    const idx = content.indexOf('useState', searchFrom);
    if (idx === -1) break;
    const parsed = extractUseStateArrayBody(content, idx);
    if (parsed) {
      const arrayBody = parsed.body;
      // 非空且含对象字面量 → 硬编码数据
      if (arrayBody.trim() && arrayBody.includes('{')) {
        const lineNo = content.slice(0, idx).split('\n').length;
        if (LINE_WHITELIST.has(`${rel}:${lineNo}`)) continue;
        if (isCommentLine(lines[lineNo - 1] ?? '')) continue;
        violations.push({
          file: rel,
          line: lineNo,
          message: `useState 初始非空对象数组（硬编码假数据，CS04）: ${content.slice(idx, Math.min(idx + 50, content.length)).split('\n')[0]}...`,
        });
      }
      searchFrom = parsed.end;
    } else {
      searchFrom = idx + 'useState'.length;
    }
  }

  // 检测 2：mock 命名常量数组
  MOCK_NAMED_PATTERN.lastIndex = 0;
  let n: RegExpExecArray | null;
  while ((n = MOCK_NAMED_PATTERN.exec(content)) !== null) {
    const lineNo = content.slice(0, n.index).split('\n').length;
    if (isCommentLine(lines[lineNo - 1] ?? '')) continue;
    violations.push({
      file: rel,
      line: lineNo,
      message: `mock 命名常量数组（疑似假数据，CS04）: ${n[0].trim().slice(0, 60)}`,
    });
  }
}

// ============ 主流程 ============

const files = collectFiles(VIEWS_DIR);
const violations: Violation[] = [];
for (const f of files) {
  scanFile(f, violations);
}

console.log(`[lint:mock] 扫描 ${files.length} 个文件（views 目录）`);

if (violations.length === 0) {
  console.log('[lint:mock] ✅ 0 违规 — 无 useState 假数据');
  process.exit(0);
}

console.log(`[lint:mock] ❌ ${violations.length} 处疑似假数据：`);
for (const v of violations) {
  console.log(`  ${v.file}:${v.line}  ${v.message}`);
}
console.log('\n[lint:mock] 结果：FAIL');
process.exit(1);
