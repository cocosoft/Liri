/**
 * mermaidLint —— mermaid 代码块的**零依赖结构预检**（P1-1②，2026-09-28）
 *
 * **为什么不用真解析器**：`app` 侧没有 mermaid 依赖，引入它需带上 d3/dompurify 等数 MB 体积，
 * 并影响 T0-T3 分层启动；而"结构预检"已能拦下模型最常见的坏语法：
 *   ① 图类型名拼错/臆造（首行首 token 不在白名单）
 *   ② 块为空 / 只有注释或指令
 *   ③ 括号、引号不配平（箭头/标签写坏的典型表征）
 *
 * **边界（如实）**：这是**启发式**，与 mermaid 真解析器的判定**不保证一致** —— 例如未来新增的
 * 图类型会被判为"无法识别"。因此回喂策略必须"**保守 + 有上限 + 可观测**"：
 * 见 `dev_docs/20260926/liri-optimization-plan-20260926.md` P0-1 ②。
 *
 * 纯函数、不碰 I/O 与 DOM ⇒ 前后端都可复用（前端解析器仍是最终真相，本预检只做前置拦截）。
 */

// 2026-10-01 B11 前置 P1（D-223）：`MermaidLintIssue` 接口已下沉**类型中心**
// `@modules/types/mermaid`（core —— 3 字段纯接口、零出向依赖）⇒ 使
// `session/types/eventPayloads.ts` 成为**纯 core 引用**的契约文件（解除 B11 方案甲的 `core -> infra`）。
// 本文件按 R05-013 口径**再导出**，既有消费方（`chat/ReActToolLoop.ts` 等）零改动。
import type { MermaidLintIssue } from '@modules/types/mermaid';

export type { MermaidLintIssue };

/** mermaid 已知图类型关键字（比较时统一小写；`stateDiagram-v2` 之类连字符原样保留） */
const KNOWN_DIAGRAM_TYPES = new Set([
  'graph',
  'flowchart',
  'flowchart-v2',
  'sequencediagram',
  'classdiagram',
  'statediagram',
  'statediagram-v2',
  'erdiagram',
  'journey',
  'gantt',
  'pie',
  'quadrantchart',
  'requirementdiagram',
  'gitgraph',
  'c4context',
  'c4container',
  'c4component',
  'c4dynamic',
  'c4deployment',
  'mindmap',
  'timeline',
  'sankey-beta',
  'xychart-beta',
  'block-beta',
  'packet-beta',
  'architecture-beta',
  'kanban',
  'radar-beta',
  'treemap-beta',
]);

/** 问题项接口 —— 定义已下沉 `@modules/types/mermaid`（本文件再导出，见文件头）。 */

interface MermaidBlock {
  code: string;
  line: number;
}

/** 提取 ```mermaid / ~~~mermaid 代码块（未闭合的块也会返回，便于判"未闭合"） */
function extractMermaidBlocks(text: string): MermaidBlock[] {
  const lines = text.split('\n');
  const blocks: MermaidBlock[] = [];
  let inBlock = false;
  let fenceChar = '`';
  let startLine = 0;
  let buffer: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inBlock) {
      const open = /^\s*(`{3,}|~{3,})\s*mermaid\b/i.exec(line);
      if (open) {
        inBlock = true;
        fenceChar = open[1][0];
        startLine = i + 1;
        buffer = [];
      }
      continue;
    }
    const close =
      fenceChar === '`'
        ? /^\s*`{3,}\s*$/.test(line)
        : /^\s*~{3,}\s*$/.test(line);
    if (close) {
      blocks.push({ code: buffer.join('\n'), line: startLine });
      inBlock = false;
      continue;
    }
    buffer.push(line);
  }
  if (inBlock) blocks.push({ code: buffer.join('\n'), line: startLine });
  return blocks;
}

/** 取首个"有意义"行：跳过空行、`%%` 注释、`%%{...}%%` 指令 */
function firstMeaningfulLine(code: string): string | null {
  for (const raw of code.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('%%{')) continue;
    if (line.startsWith('%%')) continue;
    return line;
  }
  return null;
}

/** 括号/引号配平检查（只统计明显不配平的情况，避免误报） */
function unbalanceReason(code: string): string | null {
  const pairs: Array<[string, string, string]> = [
    ['[', ']', '方括号'],
    ['(', ')', '圆括号'],
    ['{', '}', '花括号'],
  ];
  for (const [open, close, label] of pairs) {
    const o = code.split(open).length - 1;
    const c = code.split(close).length - 1;
    if (o !== c)
      return `${label}数量不配平（${open} ${o} 个、${close} ${c} 个）`;
  }
  const quotes = code.split('"').length - 1;
  if (quotes % 2 !== 0) return '引号数量不配平（" 出现了奇数个）';
  return null;
}

/**
 * 扫描文本中的所有 mermaid 块，返回**问题清单**（空数组 ＝ 未发现结构性问题）。
 */
export function lintMermaidBlocks(text: string): MermaidLintIssue[] {
  const issues: MermaidLintIssue[] = [];
  const blocks = extractMermaidBlocks(text);

  blocks.forEach((block, blockIndex) => {
    const push = (reason: string) =>
      issues.push({ blockIndex, line: block.line, reason });

    if (!block.code.trim()) {
      push('图表内容为空');
      return;
    }

    const head = firstMeaningfulLine(block.code);
    if (!head) {
      push('只有注释或配置指令，缺少图形定义');
      return;
    }

    const firstToken = head.split(/\s+/)[0].replace(/[;:]$/, '').toLowerCase();
    if (!KNOWN_DIAGRAM_TYPES.has(firstToken)) {
      push(`无法识别的图类型「${head.slice(0, 40)}」`);
      return;
    }

    const unbalanced = unbalanceReason(block.code);
    if (unbalanced) push(unbalanced);
  });

  return issues;
}

/** 便捷判定：文本是否含**有问题**的 mermaid 块 */
export function hasMermaidIssues(text: string): boolean {
  return lintMermaidBlocks(text).length > 0;
}

/**
 * 把问题清单渲染为**注入指令里的可读行**（回喂用，P1-1②）。
 *
 * 只负责补"第几个图表 / 起始行"的定位信息 —— `reason` 原样透传，**不在此重写文案**
 * （问题措辞的唯一来源是 `lintMermaidBlocks`，改文案不必改两处）。
 */
export function formatMermaidIssues(issues: MermaidLintIssue[]): string {
  return issues
    .map(
      (i) => `- 第 ${i.blockIndex + 1} 个图表（起始行 ${i.line}）：${i.reason}`
    )
    .join('\n');
}
