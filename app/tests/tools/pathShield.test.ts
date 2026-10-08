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
 * A7 防泄题：路径屏蔽的**纯判据**（`tools/pathShield.ts`）。
 *
 * 重点覆盖三类"容易漏掉就会静默泄题"的情形：
 * - **JSON 转义**：入参里 Windows 路径的 `\` 在 JSON 文本里是 `\\` ⇒ 规整时必须折叠成 `/` 才能命中；
 * - **换写法绕过**：绝对 / 相对仓库根 / 相对 `<repoRoot>/app` 三种写法都要挡住；
 * - **非法清单**：`PERMISSION_SHIELDED_PATHS` 值非法 ⇒ **抛错**（fail-closed，不静默失去屏蔽）。
 */
import { describe, expect, test } from 'bun:test';
import {
  ENV_SHIELDED_PATHS,
  SHIELD_UNSERIALIZABLE,
  buildShieldNeedles,
  findShieldedHit,
  foldDotSegments,
  loadShieldPlan,
  normalizeShieldPath,
  parseShieldedPaths,
  resetShieldPlanCache,
} from '../../src/tools/pathShield';

const REPO = 'E:\\PY\\Documents\\CODES\\PY_APP';
const SRC_ABS = `${REPO}\\app\\src\\chat\\services\\bareExplorationStripper.ts`;

describe('parseShieldedPaths：非法值 fail-closed（抛错），不静默失去屏蔽', () => {
  test('未设置 / 空串 ⇒ 空清单', () => {
    expect(parseShieldedPaths(undefined)).toEqual([]);
    expect(parseShieldedPaths('   ')).toEqual([]);
  });

  test('合法 JSON 数组 ⇒ 去空白 + 去重', () => {
    expect(parseShieldedPaths('["a.ts", " a.ts ", "b.ts"]')).toEqual([
      'a.ts',
      'b.ts',
    ]);
  });

  test('非法 JSON / 非数组 / 含非字符串元素 ⇒ 抛错', () => {
    expect(() => parseShieldedPaths('not-json')).toThrow();
    expect(() => parseShieldedPaths('{"a":1}')).toThrow();
    expect(() => parseShieldedPaths('["ok", 42]')).toThrow();
  });
});

describe('normalizeShieldPath：JSON 转义与写法差异的规整', () => {
  test('反斜杠 / 重复分隔符（JSON 转义的 `\\\\`）/ 大小写 / 尾分隔符 / `./` 被规整', () => {
    expect(normalizeShieldPath('E:\\PY\\App\\X.ts')).toBe('e:/py/app/x.ts');
    expect(normalizeShieldPath('E:\\\\PY\\\\App\\\\X.ts')).toBe(
      'e:/py/app/x.ts'
    );
    expect(normalizeShieldPath('./src/a.ts')).toBe('src/a.ts');
    expect(normalizeShieldPath('src/a.ts/')).toBe('src/a.ts');
  });
});

describe('buildShieldNeedles：同一文件的多种写法都要挡住', () => {
  test('仓库内绝对路径 ⇒ 绝对 + 相对仓库根 + 相对 <repoRoot>/app + 直接父目录', () => {
    const needles = buildShieldNeedles(SRC_ABS, REPO).map((n) => n.needle);
    expect(needles).toContain(
      'e:/py/documents/codes/py_app/app/src/chat/services/bareexplorationstripper.ts'
    );
    expect(needles).toContain(
      'app/src/chat/services/bareexplorationstripper.ts'
    );
    expect(needles).toContain('src/chat/services/bareexplorationstripper.ts');
    expect(needles).toContain(
      'e:/py/documents/codes/py_app/app/src/chat/services'
    );
    // 每条都指向同一个声明路径
    expect(
      new Set(buildShieldNeedles(SRC_ABS, REPO).map((n) => n.path))
    ).toEqual(new Set([SRC_ABS]));
  });

  test('仓库外路径 ⇒ 至少保留绝对形式（不臆造相对形式）', () => {
    const outside = 'D:\\elsewhere\\secret.ts';
    const needles = buildShieldNeedles(outside, REPO).map((n) => n.needle);
    expect(needles).toContain('d:/elsewhere/secret.ts');
    expect(needles).toContain('d:/elsewhere');
  });
});

describe('findShieldedHit：命中判定', () => {
  const plan = {
    paths: [SRC_ABS],
    needles: buildShieldNeedles(SRC_ABS, REPO),
  };

  test('绝对路径（JSON 转义后）⇒ 命中', () => {
    expect(findShieldedHit({ file_path: SRC_ABS }, plan)).toBe(SRC_ABS);
  });

  test('相对仓库根 / 相对 <repoRoot>/app 两种写法 ⇒ 都命中（换写法不能绕过）', () => {
    expect(
      findShieldedHit(
        { file_path: 'app/src/chat/services/bareExplorationStripper.ts' },
        plan
      )
    ).toBe(SRC_ABS);
    expect(
      findShieldedHit(
        { file_path: 'src/chat/services/bareExplorationStripper.ts' },
        plan
      )
    ).toBe(SRC_ABS);
  });

  test('只读直接父目录（grep/glob 按目录批量读）⇒ 命中', () => {
    expect(
      findShieldedHit({ path: `${REPO}\\app\\src\\chat\\services` }, plan)
    ).toBe(SRC_ABS);
  });

  test('无关路径 ⇒ 不命中；空清单 ⇒ 不命中（零行为）', () => {
    expect(
      findShieldedHit({ file_path: `${REPO}\\app\\src\\other.ts` }, plan)
    ).toBeNull();
    expect(
      findShieldedHit({ file_path: SRC_ABS }, { paths: [], needles: [] })
    ).toBeNull();
  });

  test('入参无法序列化 ⇒ 哨兵（fail-closed，不放行看不懂的调用）', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(findShieldedHit(cyclic, plan)).toBe(SHIELD_UNSERIALIZABLE);
  });
});

/**
 * D-246（2026-10-08，用户授权）：`..` 段穿越的**机械收口**。
 *
 * 取证：C-8 向量（`antiCheatAudit` 用**本模块的真实匹配器**实测）证明
 * `c:/repo/__x__/../src/answer.ts` **不含任何比较针** ⇒ 参数层屏蔽被绕过。
 * 修复：比较前折叠 `.` / `..`；且 `findShieldedHit` 对"原样"与"折叠后"**都**匹配（**只增不减**）。
 */
describe('D-246：`..` 段折叠', () => {
  const plan = {
    paths: [SRC_ABS],
    needles: buildShieldNeedles(SRC_ABS, REPO),
  };

  test('foldDotSegments：回退 `..` / 丢弃 `.` / 到根钳制 / 保留前导 `/` 与盘符', () => {
    expect(foldDotSegments('c:/repo/__x__/../src/a.ts')).toBe(
      'c:/repo/src/a.ts'
    );
    expect(foldDotSegments('c:/repo/./src/./a.ts')).toBe('c:/repo/src/a.ts');
    expect(foldDotSegments('c:/../../b')).toBe('c:/b'); // 盘符段不可回退（钳制）
    expect(foldDotSegments('/a/../../../b')).toBe('/b'); // POSIX 绝对：保留前导 `/`，钳在根
    expect(foldDotSegments('a/../b')).toBe('b');
  });

  test('normalizeShieldPath：`..` 与 `.` 被折叠（替代原先只去前导 `./`）', () => {
    expect(normalizeShieldPath('E:\\PY\\App\\..\\App\\X.ts')).toBe(
      'e:/py/app/x.ts'
    );
    expect(normalizeShieldPath('./src/./a.ts')).toBe('src/a.ts');
  });

  test('findShieldedHit：`..` 段穿越（改写后不含任何比较针）⇒ **命中**（修复前漏判）', () => {
    // 复刻 C-8 的探测形态：祖父目录 + 哨兵段 + `..` + 父目录名 + 文件名
    const probe = {
      file_path: `${REPO}\\app\\src\\chat\\__shield_probe__\\..\\services\\bareExplorationStripper.ts`,
    };
    expect(findShieldedHit(probe, plan)).toBe(SRC_ABS);
  });

  test('**只增不减**：塞 `a/..` 试图"把比较针折没"⇒ 仍被命中（不引入新绕过面）', () => {
    // 折叠确实会让"折叠后"的 haystack 丢掉比较针；但"原样"形态仍在比较 ⇒ 不得放行
    const eraseAttempt = {
      file_path: 'app/src/chat/services/bareExplorationStripper.ts',
      note: 'a/..',
    };
    expect(findShieldedHit(eraseAttempt, plan)).toBe(SRC_ABS);
  });
});

describe('loadShieldPlan：环境变量驱动（未设置 ⇒ 零行为）', () => {
  test('设置后生成计划；未设置 / 清除后为空计划', () => {
    const env: NodeJS.ProcessEnv = {
      [ENV_SHIELDED_PATHS]: JSON.stringify([SRC_ABS]),
      LIRI_PROJECT_DIR: REPO,
    };
    resetShieldPlanCache();
    const plan = loadShieldPlan(env, REPO);
    expect(plan.paths).toEqual([SRC_ABS]);
    expect(plan.needles.length).toBeGreaterThan(1);

    resetShieldPlanCache();
    expect(loadShieldPlan({}, undefined)).toEqual({ paths: [], needles: [] });
  });
});
