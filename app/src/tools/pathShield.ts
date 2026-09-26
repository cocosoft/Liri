// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 路径屏蔽 —— A7「沙箱屏蔽题源路径」的强制点（评测防泄题）。
 *
 * **要解决的实测缺口**：把本仓代码变成任务源时，原始实现就躺在仓库里；而评测沙箱把
 * `LIRI_PROJECT_DIR` 指向真实仓库（`evals/sandbox.ts` 的 `cwd` 与 `LIRI_PROJECT_DIR`）
 * ⇒ 被测 Agent 只要 `file_read` 原文件就能抄到答案（`.trae/specs/eval-framework-a-group.md`
 * §4.8 D 记录的 A7 最大发现，当时阻塞"注册题源任务"）。
 *
 * **机制**：评测运行器把题源路径写进环境变量 `PERMISSION_SHIELDED_PATHS`（值是**JSON 字符串
 * 数组** —— 用 JSON 而非分隔符，避免路径里的分隔符歧义；复用项目 §1.4 既有的 `PERMISSION_*`
 * 前缀，不新增前缀），`ToolRegistry.executeTool` 在**分派前**检查工具参数是否引用被屏蔽路径，
 * 命中即 **fail-closed 拒绝**（不调用工具、返回明确拒绝原因）。
 *
 * **为什么收口在工具执行层**：读文件的路径不止一条（`file_read` / `grep` / `glob` / `bash` 的
 * `cat`/`sed`…），逐工具加检查必漏。**实测执行收口有两条且互不调用**（2026-09-26 更正了我最初
 * "唯一收口"的判断）：Agent 路径（`ToolExecutionService → ToolRegistry.executeTool`）与
 * HTTP/CoreAPI 路径（`CoreAPIImpl.executeTool → ToolManager.executeTool`）。两处各调一次**共用守卫**
 * （见 `shieldGuard.ts`），逻辑与拒绝文案只有一份。
 *
 * ⚠️ **能力边界（如实，不要当成通用沙箱）**：
 * - 只挡"工具参数里**直接出现**被屏蔽路径（或其**直接父目录**）"的调用；
 * - **挡不住**：`bash` 里用变量/通配拼路径、`symlink`、对**祖先目录**的批量读取、以及任何
 *   不经工具分派点的文件访问（如工具内部自己扫目录）；
 * - 环境变量未设置时**零行为**（普通用户运行完全不受影响）。
 * 需要更强隔离时应做真沙箱（挂载/容器），不在本模块职责内。
 */
import { isAbsolute, resolve, sep } from 'node:path';

/** §1.4 既有前缀 `PERMISSION_*`；值为 JSON 字符串数组，如 `["E:/repo/app/src/a.ts"]` */
export const ENV_SHIELDED_PATHS = 'PERMISSION_SHIELDED_PATHS';

/** `findShieldedHit` 对"无法序列化的入参"返回的哨兵（fail-closed） */
export const SHIELD_UNSERIALIZABLE = '<unserializable-input>';

/** 一条比较针：`path` 保留声明原样（报错用），`needle` 是规整后的比较串 */
export interface ShieldNeedle {
  path: string;
  needle: string;
}

export interface ShieldPlan {
  /** 声明的题源路径（原样） */
  paths: string[];
  /** 展开后的比较针（绝对 / 相对仓库根 / 相对仓库 app / 直接父目录） */
  needles: ShieldNeedle[];
}

/**
 * 解析环境变量值。**非法值抛错**（fail-closed：宁可响亮失败，也不静默失去屏蔽）。
 * 未设置 / 空串 ⇒ `[]`。
 */
export function parseShieldedPaths(raw: string | undefined): string[] {
  const trimmed = raw?.trim();
  if (!trimmed) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    throw new Error(
      `${ENV_SHIELDED_PATHS} 不是合法 JSON：${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${ENV_SHIELDED_PATHS} 必须是 JSON 字符串数组`);
  }
  const out: string[] = [];
  for (const item of parsed) {
    if (typeof item !== 'string') {
      throw new Error(`${ENV_SHIELDED_PATHS} 的元素必须都是字符串`);
    }
    const v = item.trim();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

/**
 * 规整为可比较形式：统一 `/`、小写（Windows 盘符/路径大小写不敏感）、折叠重复分隔符
 * （`JSON.stringify` 会把 `\` 转义成 `\\` ⇒ 反向替换后会出现 `//`）、去尾分隔符、去 `./`。
 */
export function normalizeShieldPath(p: string): string {
  return p
    .trim()
    .replace(/\\/g, '/')
    .toLowerCase()
    .replace(/\/{2,}/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+$/, '');
}

/**
 * 为一个题源路径展开"比较针"。
 *
 * 同一文件在工具参数里可能有四种写法，**都要挡住**（只挡绝对路径的话，Agent 换个写法就绕过）：
 * ① 绝对路径；② 相对仓库根（评测沙箱 `cwd = <repoRoot>/app`，也常写 `app/src/...`）；
 * ③ 相对 `<repoRoot>/app`（如 `src/...`）；④ 其**直接父目录**（挡住 `grep`/`glob` 按目录批量读）。
 */
export function buildShieldNeedles(
  shieldedPath: string,
  repoRoot?: string
): ShieldNeedle[] {
  const needles: ShieldNeedle[] = [];
  const push = (candidate: string): void => {
    const needle = normalizeShieldPath(candidate);
    if (needle && !needles.some((x) => x.needle === needle)) {
      needles.push({ path: shieldedPath, needle });
    }
  };

  push(shieldedPath);
  // 直接父目录（仅当父目录不是空/根时）
  const normalized = normalizeShieldPath(shieldedPath);
  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash > 0) push(normalized.slice(0, lastSlash));

  const root = repoRoot?.trim();
  if (root && isAbsolute(shieldedPath)) {
    const abs = resolve(shieldedPath);
    const rootAbs = resolve(root);
    const prefix = rootAbs.endsWith(sep) ? rootAbs : rootAbs + sep;
    if (abs.startsWith(prefix)) {
      const rel = abs.slice(prefix.length).replace(/\\/g, '/');
      push(rel); // 相对仓库根，如 app/src/chat/services/x.ts
      if (rel.toLowerCase().startsWith('app/')) push(rel.slice(4)); // 相对 <repoRoot>/app
    }
  }
  return needles;
}

/** 缓存：环境变量原值 → 计划（同一进程内环境变量不会变，避免每次工具调用重复解析） */
let cachedPlan:
  | { raw: string | undefined; repoRoot: string | undefined; plan: ShieldPlan }
  | undefined;

export function loadShieldPlan(
  env: NodeJS.ProcessEnv = process.env,
  repoRoot: string | undefined = env.LIRI_PROJECT_DIR
): ShieldPlan {
  const raw = env[ENV_SHIELDED_PATHS];
  if (
    cachedPlan &&
    cachedPlan.raw === raw &&
    cachedPlan.repoRoot === repoRoot
  ) {
    return cachedPlan.plan;
  }
  const paths = parseShieldedPaths(raw);
  const needles = paths.flatMap((p) => buildShieldNeedles(p, repoRoot));
  const plan: ShieldPlan = { paths, needles };
  cachedPlan = { raw, repoRoot, plan };
  return plan;
}

/** 仅测试用：清掉进程内缓存（改环境变量后需要） */
export function resetShieldPlanCache(): void {
  cachedPlan = undefined;
}

/**
 * 入参是否引用了被屏蔽路径？命中 ⇒ 返回声明的题源路径（报错用）；未命中 ⇒ `null`。
 *
 * 入参**无法序列化**时返回 {@link SHIELD_UNSERIALIZABLE}（fail-closed：宁可拒绝，也不放行
 * 一个读不懂的调用）。
 */
export function findShieldedHit(
  input: unknown,
  plan: ShieldPlan
): string | null {
  if (plan.needles.length === 0) return null;
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(input);
  } catch {
    // @ignore-catch: 入参含循环引用等无法序列化 ⇒ 走下方 fail-closed 分支
    return SHIELD_UNSERIALIZABLE;
  }
  if (serialized === undefined) return SHIELD_UNSERIALIZABLE;
  const haystack = normalizeShieldPath(serialized);
  for (const n of plan.needles) {
    if (haystack.includes(n.needle)) return n.path;
  }
  return null;
}
