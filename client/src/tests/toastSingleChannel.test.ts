/**
 * 错误呈现「**单通道**」源码守卫（防回流）—— 台账 `TOAST-SINGLE-CHANNEL`。
 *
 * **背景（本仓实证）**：toast 曾有两套并行实现 ——
 *   ① `stores/toastStore`（zustand；全局容器 `components/common/ToastContainer` 由 `App.tsx` 挂载，
 *      支持展开原始异常 `detail`）；
 *   ② `hooks/useToast`（自管 `useState` + 自带容器，右上角、无 detail），唯一使用者是
 *      `KnowledgePage` —— 而**同一页面**又在用 ① 的 `toastError` ⇒ 一页两条通道、两种位置与样式，
 *      用户看到同一类失败却弹出两种样式的提示。
 *
 * 本守卫把「只有一条 toast 通道」钉死（四条判据，均**逐文件源码**判定）：
 *   ① 不得再引用 `hooks/useToast`（第二套实现，已删除）；
 *   ② `ToastContainer` 的**定义**只能有一处：`components/common/ToastContainer.tsx`；
 *   ③ `ToastContainer` 的**挂载**只能有一处：`src/App.tsx`（防止某页再挂一个容器实例）；
 *   ④ 除 store 与容器外，不得再出现 `useState<Toast…`（即"自己攒一个 toast 列表"）。
 *
 * ⚠️ 有意**不**覆盖（如实边界）：只检查"通道数量"，不检查**文案是否走 i18n**
 * （那是 `tests/errorMessageI18n.test.ts` 的职责），也不检查"何时该用 toast vs 内联"
 * （口径写在 `stores/toastStore.ts` 头注：与表单/字段强绑定的失败**有意**保留就地内联）。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, test } from "vitest";

const SRC = join(__dirname, "..");
/** 唯一允许**定义**容器的文件；唯一允许**挂载**容器的文件 */
const CONTAINER_DEF = "src/components/common/ToastContainer.tsx";
const CONTAINER_MOUNT = "src/App.tsx";

function collectTs(dir: string, out: string[]): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules") continue;
      collectTs(full, out);
    } else if (/\.(ts|tsx)$/.test(e.name)) {
      out.push(full);
    }
  }
}

/**
 * 注释行跳过（**必要**：口径与收敛说明里**会**提到 `hooks/useToast` 这个名字 ——
 * 实测首跑即因注释命中 4 条，其中 2 条是我自己写的说明文字 ⇒ 判据须只看代码行）。
 */
function isCommentLine(line: string): boolean {
  const s = line.trimStart();
  return (
    s.startsWith("//") ||
    s.startsWith("*") ||
    s.startsWith("/*") ||
    s.startsWith("{/*")
  );
}

test("toast 只有一条通道（不得再引入第二套实现 / 第二个容器 / 自攒 toast 列表）", () => {
  const files: string[] = [];
  collectTs(SRC, files);

  const offenders: string[] = [];
  for (const abs of files) {
    const rel = relative(join(SRC, ".."), abs).split("\\").join("/");
    // 测试文件自身只做断言，不参与"实现面"判定
    if (rel.includes("__tests__") || /\.test\.tsx?$/.test(rel)) continue;

    for (const raw of readFileSync(abs, "utf-8").split("\n")) {
      if (isCommentLine(raw)) continue;
      const line = raw;

      if (/hooks\/useToast/.test(line)) {
        offenders.push(
          `${rel}: 又引用了已删除的第二套 toast（hooks/useToast）`,
        );
      }
      if (
        /(?:function\s+ToastContainer|const\s+ToastContainer)/.test(line) &&
        rel !== CONTAINER_DEF
      ) {
        offenders.push(
          `${rel}: 又定义了第二个 ToastContainer（唯一容器在 ${CONTAINER_DEF}）`,
        );
      }
      if (/<ToastContainer/.test(line) && rel !== CONTAINER_MOUNT) {
        offenders.push(
          `${rel}: 又挂载了第二个 ToastContainer（唯一挂载点在 ${CONTAINER_MOUNT}）`,
        );
      }
      if (
        /useState<\s*Toast\b/.test(line) &&
        rel !== CONTAINER_DEF &&
        rel !== "src/stores/toastStore.ts"
      ) {
        offenders.push(
          `${rel}: 又自攒 toast 列表（状态应统一在 stores/toastStore）`,
        );
      }
    }
  }

  expect(
    offenders,
    "toast 通道应唯一（stores/toastStore + App 挂载的 ToastContainer）——口径见 toastStore 头注",
  ).toEqual([]);
});
