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
 * 命令执行沙箱配置的写入校验（S3，2026-11-17；设置方案 §11.2 / §11.5）
 *
 * 职责：把 `PUT /v1/config/sandbox` 收到的 `landlock` 补丁**校验 + 规范化**，
 * 与当前配置合并成完整值后再落盘。**纯函数**（除 `resolve()` 外零 IO），可直接单测。
 *
 * 为什么需要这一层（评审 P1-4）：
 * - `bashExtraWritablePaths` 是直接进沙箱写白名单的路径 ⇒ 若允许相对路径 / 根目录 /
 *   应用数据目录，等于把沙箱的"额外可写"变成"全盘可写"；
 * - 规范化必须在**保存时**做（原实现只在读取时 `normalizePathList`）⇒ 否则
 *   `config.json` 存脏值、UI 回显 ≠ 生效值；
 * - `~/.pyapp` 子树是既定保护面（P0-3-a）：放行它属**显式放弃保护** ⇒ 必须带
 *   非空 `forceWithReason`，并由调用方写审计。
 */
import { isAbsolute, parse as parsePath, resolve, sep } from 'node:path';

/** 与 `readLandlockConfig()` 返回值同构（只取可写字段） */
export interface LandlockConfigView {
  enabled: boolean;
  bashEnabled: boolean;
  failClosed: boolean;
  bashExtraWritablePaths: string[];
}

/** 允许经本接口写入的字段（未知字段一律拒绝，防拼写错误静默落盘） */
const BOOLEAN_FIELDS = ['enabled', 'bashEnabled', 'failClosed'] as const;
const PATH_LIST_FIELD = 'bashExtraWritablePaths';
const ALLOWED_FIELDS = new Set<string>([...BOOLEAN_FIELDS, PATH_LIST_FIELD]);

/** 额外可写路径条数上限（配置防膨胀；够覆盖正常"漏声明路径"场景） */
export const MAX_EXTRA_WRITABLE_PATHS = 50;
/** 放行 `~/.pyapp` 子树时理由的长度上限（只做边界校验，不评价内容） */
export const MAX_FORCE_REASON_LENGTH = 500;

/** 校验结果：成功给出合并后的完整配置；失败给出可定位的字段与原因 */
export type LandlockPatchResult =
  | { ok: true; next: LandlockConfigView; forcedPaths: string[] }
  | { ok: false; field: string; message: string };

/**
 * 路径归一（**落盘值**）：`resolve` ⇒ 去掉 `.` / `..` / 尾分隔符。
 *
 * 注意与 `compareKey` 的分工：落盘保留用户写成的大小写（Windows 上路径不区分大小写，
 * 但把它整条小写化会让 UI 回显变得不可读），比较/去重才用 `compareKey`。
 */
function normalizePath(input: string): string {
  return resolve(input);
}

/** 比较键：Windows 上路径不区分大小写 ⇒ 小写化后再比 */
function compareKey(input: string): string {
  return process.platform === 'win32' ? input.toLowerCase() : input;
}

/** `child` 是否等于 `parent` 或位于其下（入参为比较键） */
function isSameOrInside(child: string, parent: string): boolean {
  if (child === parent) return true;
  const prefix = parent.endsWith(sep) ? parent : parent + sep;
  return child.startsWith(prefix);
}

/** `candidate` 是否为 `target` 的祖先目录（严格祖先；入参为比较键） */
function isStrictAncestor(candidate: string, target: string): boolean {
  if (candidate === target) return false;
  const prefix = candidate.endsWith(sep) ? candidate : candidate + sep;
  return target.startsWith(prefix);
}

/** 单条路径的校验结果：`null` = 通过；字符串 = 拒绝原因 */
function validateOnePath(input: {
  raw: unknown;
  index: number;
  appHome: string;
  forceWithReason: string;
}): { normalized?: string; forced?: boolean; error?: string } {
  const { raw, index, appHome, forceWithReason } = input;
  const field = `${PATH_LIST_FIELD}[${index}]`;
  if (typeof raw !== 'string') {
    return { error: `${field} 必须是字符串` };
  }
  const trimmed = raw.trim();
  if (!trimmed) return { error: `${field} 不能为空` };
  if (!isAbsolute(trimmed)) {
    return { error: `${field} 必须是绝对路径（收到「${trimmed}」）` };
  }
  const normalized = normalizePath(trimmed);
  const key = compareKey(normalized);
  // 根目录（`/` 或 `C:\`）⇒ 等同"全盘可写"
  if (key === compareKey(parsePath(normalized).root)) {
    return { error: `${field} 不能是根目录（等同全盘可写）` };
  }
  const homeKey = compareKey(resolve(appHome));
  // 应用数据目录本身与其祖先：无条件拒绝（放行祖先 = 放行 app home 整树）
  if (key === homeKey || isStrictAncestor(key, homeKey)) {
    return {
      error: `${field} 不能是应用数据目录或其祖先目录（${appHome}）`,
    };
  }
  // 应用数据目录**子树**：既定保护面，仅显式理由可放行（调用方写审计）
  if (isSameOrInside(key, homeKey)) {
    if (!forceWithReason) {
      return {
        error: `${field} 位于应用数据目录内（${appHome}）；如确需放行，请填写 forceWithReason`,
      };
    }
    return { normalized, forced: true };
  }
  return { normalized };
}

/**
 * 校验并合并 `landlock` 补丁。
 *
 * @param current 当前生效配置（调用方用 `readLandlockConfig()` 取，已带默认值）
 * @param patch 请求体里的 `landlock` 对象（`unknown`：来自 JSON，不做类型假设）
 * @param appHome 应用数据目录（`resolvePyappHome()`）
 * @param forceWithReason 放行 app home 子树时必填的显式理由
 */
export function applyLandlockConfigPatch(input: {
  current: LandlockConfigView;
  patch: unknown;
  appHome: string;
  forceWithReason?: unknown;
}): LandlockPatchResult {
  const { current, patch, appHome } = input;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return {
      ok: false,
      field: 'sandbox.landlock',
      message: 'sandbox.landlock 必须是对象',
    };
  }
  const record = patch as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!ALLOWED_FIELDS.has(key)) {
      return {
        ok: false,
        field: `sandbox.landlock.${key}`,
        message: `sandbox.landlock 不接受字段「${key}」`,
      };
    }
  }

  const next: LandlockConfigView = { ...current };
  for (const field of BOOLEAN_FIELDS) {
    if (!(field in record)) continue;
    const value = record[field];
    if (typeof value !== 'boolean') {
      return {
        ok: false,
        field: `sandbox.landlock.${field}`,
        message: `sandbox.landlock.${field} 必须是布尔值`,
      };
    }
    next[field] = value;
  }

  const forcedPaths: string[] = [];
  if (PATH_LIST_FIELD in record) {
    const rawList = record[PATH_LIST_FIELD];
    if (!Array.isArray(rawList)) {
      return {
        ok: false,
        field: `sandbox.landlock.${PATH_LIST_FIELD}`,
        message: `sandbox.landlock.${PATH_LIST_FIELD} 必须是字符串数组`,
      };
    }
    if (rawList.length > MAX_EXTRA_WRITABLE_PATHS) {
      return {
        ok: false,
        field: `sandbox.landlock.${PATH_LIST_FIELD}`,
        message: `sandbox.landlock.${PATH_LIST_FIELD} 最多 ${MAX_EXTRA_WRITABLE_PATHS} 条`,
      };
    }
    const rawReason =
      typeof input.forceWithReason === 'string'
        ? input.forceWithReason.trim()
        : '';
    if (rawReason.length > MAX_FORCE_REASON_LENGTH) {
      return {
        ok: false,
        field: 'forceWithReason',
        message: `forceWithReason 最长 ${MAX_FORCE_REASON_LENGTH} 个字符`,
      };
    }
    const seen = new Set<string>();
    const paths: string[] = [];
    const effectivePaths: string[] = [];
    for (let i = 0; i < rawList.length; i++) {
      const result = validateOnePath({
        raw: rawList[i],
        index: i,
        appHome,
        forceWithReason: rawReason,
      });
      if (result.error) {
        return {
          ok: false,
          field: `sandbox.landlock.${PATH_LIST_FIELD}`,
          message: result.error,
        };
      }
      const normalized = result.normalized!;
      const key = compareKey(normalized);
      if (seen.has(key)) continue;
      seen.add(key);
      paths.push(normalized);
      // 保留用户写法还是归一化值？——存**归一化值**（UI 回显 = 生效值）
      if (result.forced) effectivePaths.push(normalized);
    }
    next[PATH_LIST_FIELD] = paths;
    forcedPaths.push(...effectivePaths);
  }

  return { ok: true, next, forcedPaths };
}
