/**
 * ChatManager method-map 自动生成器
 *
 * 用 TypeScript Compiler API 扫描 ChatManager.ts 的 AST，
 * 输出每个方法的：方法名 | 行号 | 访问的 this 属性 | 调用的内部方法 | 职责域 | 提取可行性
 *
 * 用法：bun run scripts/generate-method-map.ts
 * 输出：ChatManager.method-map.md
 */

import * as ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";

// ============ 配置 ============

const CHAT_MANAGER_PATH = resolve(
  __dirname,
  "..",
  "app",
  "src",
  "chat",
  "ChatManager.ts"
);
const OUTPUT_PATH = resolve(
  __dirname,
  "..",
  "dev_docs",
  "20260706",
  "ChatManager.method-map.md"
);

// ============ 类型定义 ============

interface MethodInfo {
  name: string;
  line: number;
  visibility: "public" | "private" | "protected";
  isStatic: boolean;
  isAsync: boolean;
  /** 方法体内引用的 this.xxx 属性名（不含方法调用） */
  thisProperties: Set<string>;
  /** 方法体内调用的 this.xxx() 方法名 */
  thisMethodCalls: Set<string>;
  /** 职责域分类 */
  domain: string;
  /** 提取可行性：纯搬 / 需参数化(N个) / 需重构 */
  extractability: string;
}

// ============ 职责域分类规则 ============

const DOMAIN_KEYWORDS: Record<string, string[]> = {
  消息收发: [
    "sendMessage",
    "streamMessage",
    "continueInteraction",
    "send",
    "stream",
    "messages",
    "yield",
  ],
  会话管理: [
    "session",
    "switchSession",
    "loadSession",
    "saveSession",
    "createCheckpoint",
    "checkpoint",
    "clearAll",
    "switch",
    "_loadSessions",
  ],
  LLM调用: [
    "llm",
    "query",
    "streamQuery",
    "getClientForModel",
    "buildToolDefinitions",
    "resolveModel",
    "client",
  ],
  上下文管理: [
    "truncate",
    "compress",
    "sanitize",
    "compact",
    "context",
    "token",
    "persist",
    "turnSummary",
    "history",
    "extractCurrentGoal",
    "getOrAssemble",
    "recordChatResponseUsage",
  ],
  工具执行: [
    "executeTool",
    "toolCall",
    "toolRegistry",
    "toolExecutor",
    "toolIntegration",
    "buildTool",
  ],
  图片上下文: ["image", "ImageContext", "imageContext"],
  安全检查: [
    "security",
    "permission",
    "rollback",
    "sanitize",
    "validate",
  ],
  任务计划: [
    "task",
    "plan",
    "executeStep",
    "executePlan",
    "taskRegistry",
    "taskOrchestrator",
  ],
  会话记忆: ["memory", "accumulate", "extractMemory"],
  Hook链: ["hook", "council", "triggerCouncil", "hookChain"],
  内部辅助: [
    "persistMessage",
    "getSessionMachine",
    "updateMessageBlocks",
    "_addAndPersist",
    "_getLocalSession",
    "truncateToolResult",
  ],
  初始化: ["initialize", "constructor", "_loadSessions"],
};

function classifyDomain(
  methodName: string,
  thisProps: Set<string>,
  thisCalls: Set<string>
): string {
  const allNames = [
    ...Array.from(thisProps),
    ...Array.from(thisCalls),
    methodName,
  ].join(" ");

  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    for (const kw of keywords) {
      if (allNames.includes(kw)) {
        return domain;
      }
    }
  }

  return "未分类";
}

// ============ AST 遍历工具 ============

/** 收集方法体内所有 this.xxx 属性访问 */
function collectThisProperties(node: ts.Node): Set<string> {
  const props = new Set<string>();

  function visit(n: ts.Node): void {
    if (
      ts.isPropertyAccessExpression(n) &&
      n.expression.kind === ts.SyntaxKind.ThisKeyword
    ) {
      // 排除方法调用（由 collectThisMethodCalls 单独处理）
      const parent = n.parent;
      if (!parent || !ts.isCallExpression(parent) || parent.expression !== n) {
        props.add(n.name.text);
      }
    }
    ts.forEachChild(n, visit);
  }

  visit(node);
  return props;
}

/** 收集方法体内所有 this.xxx() 方法调用 */
function collectThisMethodCalls(node: ts.Node): Set<string> {
  const calls = new Set<string>();

  function visit(n: ts.Node): void {
    if (ts.isCallExpression(n)) {
      const expr = n.expression;
      if (
        ts.isPropertyAccessExpression(expr) &&
        expr.expression.kind === ts.SyntaxKind.ThisKeyword
      ) {
        calls.add(expr.name.text);
      }
    }
    ts.forEachChild(n, visit);
  }

  visit(node);
  return calls;
}

/** 判断提取可行性 */
function assessExtractability(
  methodName: string,
  isStatic: boolean,
  thisProps: Set<string>,
  thisCalls: Set<string>
): string {
  if (isStatic) {
    return "纯搬（static）";
  }

  const ownMethodCalls = Array.from(thisCalls).filter((c) =>
    c.startsWith("_") || c === methodName
  );
  const domainProps = Array.from(thisProps).filter(
    (p) =>
      !["_chatSessions", "sessionMachines", "sessionGateway"].includes(p)
  );

  if (thisProps.size === 0 && thisCalls.size === 0) {
    return "纯搬";
  }

  if (thisCalls.size === 0 && thisProps.size > 0) {
    return `需参数化(${thisProps.size}个): ${Array.from(thisProps).join(", ")}`;
  }

  // 有 this 方法调用 → 标注需要传入回调或拆出
  return `需参数化(${thisProps.size}个属性 + ${thisCalls.size}个方法): ${Array.from(thisProps).join(", ")}; 方法: ${Array.from(thisCalls).join(", ")}`;
}

// ============ 主逻辑 ============

function main(): void {
  console.log(`[method-map] 读取: ${CHAT_MANAGER_PATH}`);

  const sourceCode = readFileSync(CHAT_MANAGER_PATH, "utf-8");
  const sourceFile = ts.createSourceFile(
    CHAT_MANAGER_PATH,
    sourceCode,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TSX
  );

  const methods: MethodInfo[] = [];

  // 遍历 AST，找到 ChatManagerImpl 类
  function visit(node: ts.Node): void {
    if (ts.isClassDeclaration(node) && node.name?.text === "ChatManagerImpl") {
      for (const member of node.members) {
        if (
          ts.isMethodDeclaration(member) &&
          member.name &&
          ts.isIdentifier(member.name)
        ) {
          const name = member.name.text;

          // 获取行号
          const { line } = sourceFile.getLineAndCharacterOfPosition(
            member.getStart(sourceFile)
          );

          // 获取修饰符
          const modifiers = ts.getModifiers(member);
          const modifierFlags = modifiers
            ? modifiers.map((m) => m.kind)
            : [];

          const visibility = modifierFlags.includes(
            ts.SyntaxKind.PrivateKeyword
          )
            ? "private"
            : modifierFlags.includes(ts.SyntaxKind.ProtectedKeyword)
              ? "protected"
              : "public";

          const isStatic = modifierFlags.includes(ts.SyntaxKind.StaticKeyword);
          const isAsync = modifierFlags.includes(ts.SyntaxKind.AsyncKeyword);

          // 收集 this 依赖
          const thisProps = collectThisProperties(member.body ?? member);
          const thisCalls = collectThisMethodCalls(member.body ?? member);

          // 分类
          const domain = classifyDomain(name, thisProps, thisCalls);

          // 提取可行性
          const extractability = assessExtractability(
            name,
            isStatic,
            thisProps,
            thisCalls
          );

          methods.push({
            name,
            line: line + 1, // TS Compiler API 行号从 0 开始
            visibility,
            isStatic,
            isAsync,
            thisProperties: thisProps,
            thisMethodCalls: thisCalls,
            domain,
            extractability,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  // ============ 生成输出 ============

  const lines: string[] = [];

  lines.push("# ChatManager.method-map.md");
  lines.push("");
  lines.push(
    `> 自动生成于 ${new Date().toISOString().split("T")[0]}，由 \`scripts/generate-method-map.ts\` 扫描 AST 生成`
  );
  lines.push(
    `> 源文件: [ChatManager.ts](file:///E:/PY/CODES/PY_APP/app/src/chat/ChatManager.ts) — ${methods.length} 个方法`
  );
  lines.push("");
  lines.push("---");
  lines.push("");

  // 按职责域分组统计
  lines.push("## 职责域分布");
  lines.push("");
  const domainCounts = new Map<string, number>();
  for (const m of methods) {
    domainCounts.set(m.domain, (domainCounts.get(m.domain) ?? 0) + 1);
  }
  lines.push("| 职责域 | 方法数 |");
  lines.push("|--------|:---:|");
  for (const [domain, count] of [...domainCounts.entries()].sort(
    (a, b) => b[1] - a[1]
  )) {
    lines.push(`| ${domain} | ${count} |`);
  }
  lines.push("");

  // 提取可行性统计
  lines.push("## 提取可行性统计");
  lines.push("");
  const pureCount = methods.filter(
    (m) => m.extractability.startsWith("纯搬") || m.extractability === "纯搬"
  ).length;
  const paramCount = methods.filter((m) =>
    m.extractability.includes("需参数化")
  ).length;
  lines.push(`- 纯搬: ${pureCount} 个`);
  lines.push(`- 需参数化: ${paramCount} 个`);
  lines.push(`- 总计: ${methods.length} 个`);
  lines.push("");

  // 方法列表
  lines.push("## 完整方法列表");
  lines.push("");
  lines.push(
    "| 方法名 | 行号 | 可见性 | 静态 | 异步 | this 属性 | this 方法调用 | 职责域 | 提取可行性 |"
  );
  lines.push(
    "|--------|:---:|:---:|:---:|:---:|----------|------------|--------|-----------|"
  );

  for (const m of methods) {
    const staticMark = m.isStatic ? "✓" : "";
    const asyncMark = m.isAsync ? "✓" : "";
    const props =
      m.thisProperties.size > 0
        ? Array.from(m.thisProperties).join(", ")
        : "—";
    const calls =
      m.thisMethodCalls.size > 0
        ? Array.from(m.thisMethodCalls).join(", ")
        : "—";

    lines.push(
      `| \`${m.name}\` | ${m.line} | ${m.visibility} | ${staticMark} | ${asyncMark} | ${props} | ${calls} | ${m.domain} | ${m.extractability} |`
    );
  }

  lines.push("");

  // 按职责域分组详情
  lines.push("## 按职责域分组");
  lines.push("");

  const grouped = new Map<string, MethodInfo[]>();
  for (const m of methods) {
    const list = grouped.get(m.domain) ?? [];
    list.push(m);
    grouped.set(m.domain, list);
  }

  for (const [domain, domainMethods] of [...grouped.entries()].sort()) {
    lines.push(`### ${domain}（${domainMethods.length} 个方法）`);
    lines.push("");
    for (const m of domainMethods) {
      const deps: string[] = [];
      if (m.thisProperties.size > 0) {
        deps.push(`this 属性: ${Array.from(m.thisProperties).join(", ")}`);
      }
      if (m.thisMethodCalls.size > 0) {
        deps.push(
          `内部调用: ${Array.from(m.thisMethodCalls).join(", ")}`
        );
      }
      const depStr = deps.length > 0 ? ` — ${deps.join("; ")}` : "";

      lines.push(
        `- **\`${m.name}\`** (L${m.line}) — ${m.extractability}${depStr}`
      );
    }
    lines.push("");
  }

  // 写入文件
  const output = lines.join("\n");
  writeFileSync(OUTPUT_PATH, output, "utf-8");
  console.log(
    `[method-map] 完成: ${methods.length} 个方法 → ${OUTPUT_PATH}`
  );
}

main();
