/**
 * HD-P2-4 棘轮守卫：`client/src/services/**` 内的**裸 `/v1/*` 路径字面量**只减不增。
 *
 * **为什么是棘轮而非"一次清零"**：回仓实测契约路径字面量在 `services/` 下约 **550 处 / 49 文件**
 * （方案 §7.2 原估 296 处偏小）⇒ 按域增量收口到 `services/endpoints.ts`，每批下调基线。
 *
 * **统计口径**：`client/src/services/**\/*.ts` 中含 `"/v1/` / `'/v1/` / `` `/v1/ `` 的**行数**；
 * **不计入**：`endpoints.ts` 自身（真源）、测试文件、**注释行**（行首 `//` / `*` / `/*`）。
 *
 * 记录/更新基线：`UPDATE_ENDPOINTS_BASELINE=1 bunx vitest run src/tests/endpointsRatchet.test.ts`
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, test } from "vitest";

const SERVICES = join(__dirname, "..", "services");
const SOURCE_FILE = "endpoints.ts";
const BASELINE_PATH = join(__dirname, "fixtures", "endpointsBaseline.json");

const RAW_PATH = /["'`]\/v1\//;

function collect(dir: string, out: string[]): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "__tests__") continue;
      collect(join(dir, e.name), out);
    } else if (/\.ts$/.test(e.name)) {
      out.push(join(dir, e.name));
    }
  }
}

function isCommentLine(line: string): boolean {
  const t = line.trimStart();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

/** 统计 `services/**` 内裸 `/v1/` 路径的**行数**（排除真源/测试/注释） */
function scan(): { total: number; files: Record<string, number> } {
  const abs: string[] = [];
  collect(SERVICES, abs);
  const files: Record<string, number> = {};
  let total = 0;
  for (const p of abs) {
    const rel = relative(SERVICES, p).split("\\").join("/");
    if (rel === SOURCE_FILE || /\.test\.ts$/.test(rel)) continue;
    let n = 0;
    for (const line of readFileSync(p, "utf-8").split("\n")) {
      if (isCommentLine(line)) continue;
      if (RAW_PATH.test(line)) n++;
    }
    if (n > 0) {
      files[rel] = n;
      total += n;
    }
  }
  return { total, files };
}

const { total, files } = scan();

describe("HD-P2-4 · services 内裸 /v1 路径棘轮（只减不增）", () => {
  test("基线存在，且逐文件命中数不超过基线（总量单调下降）", () => {
    expect(existsSync(BASELINE_PATH), `基线缺失：${BASELINE_PATH}`).toBe(true);
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf-8")) as {
      total: number;
      files: Record<string, number>;
    };

    const regressions: string[] = [];
    for (const [file, n] of Object.entries(files)) {
      const base = baseline.files[file] ?? 0;
      if (n > base) regressions.push(`${file}: ${base} → ${n}`);
    }
    expect(
      regressions,
      "services 内新增了裸 `/v1/` 路径（应把路径收口到 `services/endpoints.ts` 后引用 ENDPOINTS.*）",
    ).toEqual([]);
    expect(
      total,
      `总量应 ≤ 基线 ${baseline.total}（当前 ${total}）`,
    ).toBeLessThanOrEqual(baseline.total);
  });
});

if (process.env.UPDATE_ENDPOINTS_BASELINE === "1") {
  mkdirSync(join(__dirname, "fixtures"), { recursive: true });
  writeFileSync(
    BASELINE_PATH,
    JSON.stringify({ total, files }, null, 2) + "\n",
    "utf-8",
  );
  console.log(
    `[endpoints 棘轮] 基线已写入：total=${total}，文件数=${Object.keys(files).length}`,
  );
}
