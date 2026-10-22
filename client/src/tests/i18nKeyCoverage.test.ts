/**
 * BUG-10（2026-10-22 复查）：`t("字面量 key")` 必须在 **zh 与 en 两份字典**里都存在
 *
 * 缺陷现场：`/agent/advanced` → Swarm 图例渲染出裸 key（`agent.legend` / `agent.completed`），
 * 同批还发现 `common.download`（媒体页按钮）、`image.canvasEditorOpened`（画布提示）
 * 等共 16 处——它们在两个语言包里**双双缺失**，而 `createTestT` 只在「组件被测到且未传
 * 默认值」时才会抛错，覆盖面天然有缺口（运行时才暴露成裸 key 或中文）。
 *
 * 本文件是「字典覆盖棘轮」：扫描 `src/` 下所有 `t("a.b")` 静态字面量，
 * 逐条校验 zh / en 是否都能取到字符串叶子；缺任何一条即变红。
 *
 * 不纳入扫描（各有正当理由）：
 *   - `src/tests/**`：测试基建自身（`createTestT` 的文档示例等）；
 *   - 以 `.` 结尾的 key：动态拼接前缀（如 `t("capability.category." + x)`），
 *     真实 key 由拼接结果决定，静态无法判定。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import en from "../i18n/locales/en";
import zh from "../i18n/locales/zh";

type Dict = Record<string, unknown>;

const SRC_ROOT = join(__dirname, "..");

/** 递归收集待扫描的源文件（跳过测试目录） */
function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "tests" || entry === "node_modules") continue;
      collectSourceFiles(full, out);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    if (/\.test\.(ts|tsx)$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

/** 去掉块注释与行注释，避免把注释里的示例 key 当成真实用法 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** 点分路径查表；只有字符串叶子才算"有翻译" */
function lookup(dict: Dict, key: string): string | undefined {
  let cur: unknown = dict;
  for (const part of key.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Dict)[part];
  }
  return typeof cur === "string" ? cur : undefined;
}

/** 收集 `t("literal.key")` 用法（key → 出现文件集合） */
function collectKeyUsage(): Map<string, Set<string>> {
  const usage = new Map<string, Set<string>>();
  const pattern = /\bt\(\s*["']([A-Za-z0-9_.]+)["']/g;

  for (const file of collectSourceFiles(SRC_ROOT)) {
    const source = stripComments(readFileSync(file, "utf-8"));
    for (const match of source.matchAll(pattern)) {
      const key = match[1];
      if (!key.includes(".") || key.endsWith(".")) continue;
      if (!usage.has(key)) usage.set(key, new Set());
      usage.get(key)!.add(file.slice(SRC_ROOT.length + 1).replace(/\\/g, "/"));
    }
  }
  return usage;
}

function missingKeys(dict: Dict, usage: Map<string, Set<string>>): string[] {
  const missing: string[] = [];
  for (const key of usage.keys()) {
    if (lookup(dict, key) === undefined) {
      missing.push(`${key}  ← ${[...usage.get(key)!].slice(0, 3).join(", ")}`);
    }
  }
  return missing.sort();
}

describe("BUG-10：i18n 字典覆盖（zh / en 双份）", () => {
  const usage = collectKeyUsage();

  it("扫描到足量 key（防止正则失效后假绿）", () => {
    expect(usage.size).toBeGreaterThan(1000);
  });

  it("zh 字典不缺任何被使用的 key", () => {
    expect(missingKeys(zh as Dict, usage)).toEqual([]);
  });

  it("en 字典不缺任何被使用的 key", () => {
    expect(missingKeys(en as Dict, usage)).toEqual([]);
  });

  it("本次复查新增的 key 逐条在册（防止删改回归）", () => {
    const repaired = [
      "agent.legend",
      "agent.completed",
      "common.download",
      "chat.exportEmptyHint",
      "chat.orphanToolResult",
      "image.canvasEditorOpened",
      "office.backToList",
      "office.calDeleteError",
      "office.cancel",
      "office.docCreate",
      "office.docTemplate",
      "office.docType",
      "office.downloadFailed",
      "office.mailDeleteError",
      "office.mailFrom",
      "office.previewFailed",
    ];
    for (const key of repaired) {
      expect(lookup(zh as Dict, key), `zh 缺 ${key}`).toBeTruthy();
      expect(lookup(en as Dict, key), `en 缺 ${key}`).toBeTruthy();
    }
  });
});
