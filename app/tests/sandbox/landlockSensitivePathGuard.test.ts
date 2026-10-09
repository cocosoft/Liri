/**
 * Landlock 白名单「敏感路径」守卫（P0-3-b，2026-09-28）
 *
 * **为什么需要**：P0-3 取证时发现 bash 的 Landlock 白名单把 `~/.pyapp`（含
 * `config.json` 可能携带的凭据、`data/app.db` 的全部会话/记忆/台账）**整条放行只读**
 * ⇒ 在 bash 域内这两者**可读**。该缺口由 P0-3-a 处置（需先取证 bash 是否依赖 `~/.pyapp`）。
 * 本文件**不处置缺口**，只把"当前已正确的边界"锁成**不变量** —— 防未来**放宽**时误开。
 *
 * **两份白名单互相独立**（不共用，取证结论）：
 *   A. `code_run`：[`buildBunLandlockPolicy`](../../src/tools/CodeRunner/LinuxSandboxRunner.ts)（**真实策略**，
 *      `LinuxSandboxRunner` 为唯一生产消费者）；
 *   B. `bash`：[`buildBashLandlockPolicy`](../../src/tools/bash/bashLandlockExec.ts)（12 条系统路径 +
 *      `~/.pyapp` 只读 + 受管目录可写 + 工具缓存可写）。
 *
 * **断言写成方向性约束而非"当前快照"**：用"**不得覆盖 / 不得可写**"这类否定式，
 * 使 P0-3-a 把 `~/.pyapp` 规则**收窄或整条移除**之后本文件**仍全绿**（无需同步改写）；
 * 只有在"边界被放宽"时才变红。
 *
 * ⚠️ 平台无关：全部为**纯策略形状断言**（不 spawn、不需要 Linux 内核）。
 */
import { describe, expect, it } from 'bun:test';
import { homedir } from 'os';
import {
  resolveDownloadsDir,
  resolveOutputDir,
  resolvePyappHome,
  resolveTempDir,
} from '@modules/core/paths';
import { buildBashLandlockPolicy } from '../../src/tools/bash/bashLandlockExec';
import { buildBunLandlockPolicy } from '../../src/tools/CodeRunner/LinuxSandboxRunner';
import type { LandlockFsRule } from '../../src/sandbox/landlock/types';

const CWD = '/w';
const HOME = homedir();
const PYAPP_HOME = resolvePyappHome();
/** 承载凭据与全部运行数据的两个敏感路径（Landlock 若放行它们即视为边界被放宽） */
const SENSITIVE_PATHS = [
  `${PYAPP_HOME}/config.json`,
  `${PYAPP_HOME}/data`,
] as const;

/** 写类权限：任一出现即视为"可写" */
const WRITE_ACCESS = ['write', 'make_dir', 'make_reg', 'remove'];

function isWritable(rule: LandlockFsRule): boolean {
  return rule.allow.some((a) => WRITE_ACCESS.includes(a));
}

/** 路径归一化：本文件只做**字符串**包含判定，故把 Windows `\` 统一为 `/` 并去尾部 `/` */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

/**
 * 规则是否**覆盖**目标路径。
 *
 * Landlock 规则按**路径粒度**生效：一条 `{path: P}` 的规则对其所有子路径同样生效
 * ⇒ 父目录规则会传导到子路径（这正是 `~/.pyapp` 只读能覆盖 `data/` 的原因）。
 *
 * ⚠️ 必须**先归一化分隔符**：`resolvePyappHome()` 在 Windows 返回 `C:\…\.pyapp`，
 * 若直接用 `/` 拼接判定，本守卫会在 Windows 上**静默失配**（全部判 false ⇒ 空集假绿）。
 */
function covers(rulePath: string, target: string): boolean {
  const r = normalizePath(rulePath);
  const t = normalizePath(target);
  return t === r || t.startsWith(`${r}/`);
}

/**
 * code_run 侧断言的是**真实下发策略** —— `LinuxSandboxRunner.buildBunLandlockPolicy()`
 * （生产消费者的唯一策略来源；导出仅供离线断言形状）。
 *
 * ⚠️ 2026-10-08（P1-续）：原此处以 **`SandboxConfigBuilder` 的 5/6 种策略** 作输入
 * （再经 `LandlockPolicyBuilder.build` 映射）—— 但 `SandboxConfigBuilder` **全仓零生产消费者**
 * （真实 `code_run` 走 `buildBunLandlockPolicy`）⇒ 那组断言**测的是一条不存在的路径**。
 * 现直接断言**真实策略**。（`SandboxConfigBuilder` 于 2026-10-09 沙箱回滚后重新存在，
 * 但仍为零生产消费者，故本守卫不以其为输入。）
 */
const CODE_RUN_POLICY: LandlockFsRule[] = buildBunLandlockPolicy(CWD, 5).fs;

describe('Landlock 白名单：敏感路径守卫（P0-3-b）', () => {
  describe('code_run 侧：buildBunLandlockPolicy（真实策略）', () => {
    it('控制组：真实策略**确有**规则（防"空集假绿"）', () => {
      expect(CODE_RUN_POLICY.length).toBeGreaterThan(0);
    });

    it('**不得覆盖** `~/.pyapp/config.json` 与 `~/.pyapp/data`', () => {
      for (const rule of CODE_RUN_POLICY) {
        for (const sensitive of SENSITIVE_PATHS) {
          expect(
            covers(rule.path, sensitive),
            `规则 ${rule.path} 覆盖了敏感路径 ${sensitive}`
          ).toBe(false);
        }
      }
    });

    it('**不得**出现"家目录整体"规则（防"为省事放行 $HOME"）', () => {
      expect(
        CODE_RUN_POLICY.some(
          (rule) => normalizePath(rule.path) === normalizePath(HOME)
        ),
        `放行了家目录整体 ${HOME}`
      ).toBe(false);
    });
  });

  describe('bash 侧：buildBashLandlockPolicy', () => {
    // 不注入 homeDir ⇒ 用**真实**路径，使"受管目录 vs ~/.pyapp"自洽
    const policy = buildBashLandlockPolicy({ cwd: CWD, abi: 5 });

    it('**不得**出现"家目录整体"规则', () => {
      expect(
        policy.fs.some(
          (rule) => normalizePath(rule.path) === normalizePath(HOME)
        )
      ).toBe(false);
    });

    it('**不得**出现 `~/.pyapp` 本身的规则（P0-3-a 加固：整棵树不放行）', () => {
      // P0-3-a（2026-09-28）已把该规则整条移除；本条把它锁成**长期不变量**：
      // 受管产物目录（output / downloads / temp）是 `~/.pyapp` 下的**具体子路径**，不受影响；
      // 但任何"放行整个 `~/.pyapp`"的写法都会让 `config.json` / `credentials.json` /
      // `data/app.db` / `sessions/` 一并暴露 ⇒ 必须变红。
      expect(
        policy.fs.some(
          (rule) => normalizePath(rule.path) === normalizePath(PYAPP_HOME)
        )
      ).toBe(false);
    });

    it('`config.json` 与 `data/` **不得可写**（P0-3-a 后：整棵树已不放行）', () => {
      for (const rule of policy.fs) {
        if (!isWritable(rule)) continue;
        for (const sensitive of SENSITIVE_PATHS) {
          expect(
            covers(rule.path, sensitive),
            `可写规则 ${rule.path} 覆盖了敏感路径 ${sensitive}`
          ).toBe(false);
        }
      }
    });

    it('`~/.pyapp` 下的**可写**规则仅限受管产物目录（output / downloads / temp）', () => {
      // 只允许这三者（AI 产物落点）；若将来往 `~/.pyapp` 下开别的可写目录 ⇒ 本断言变红，
      // 强制"新增家目录下可写目录"必须显式评审
      const allowed = new Set([
        resolveOutputDir(),
        resolveDownloadsDir(),
        resolveTempDir(),
      ]);
      const writableUnderPyapp = policy.fs.filter(
        (rule) =>
          isWritable(rule) &&
          covers(PYAPP_HOME, rule.path) &&
          normalizePath(rule.path) !== normalizePath(PYAPP_HOME)
      );
      for (const rule of writableUnderPyapp) {
        expect(
          allowed.has(rule.path),
          `${rule.path} 不在受管产物目录白名单内`
        ).toBe(true);
      }
    });

    it('控制组：上面的 `~/.pyapp` 过滤**确实命中**（否则该用例会"空集假绿"）', () => {
      // 本断言存在的理由有实证：该过滤的第一版用 `/` 拼路径判定，而 `resolvePyappHome()`
      // 在 Windows 返回 `C:\…` ⇒ 命中数恒为 0、用例静默变绿（已修为 `covers` 内归一化）。
      // 故此处显式要求"至少命中 1 条"，并单独验证"受管目录确实可写"这一契约仍在。
      const writableUnderPyapp = policy.fs.filter(
        (rule) =>
          isWritable(rule) &&
          covers(PYAPP_HOME, rule.path) &&
          normalizePath(rule.path) !== normalizePath(PYAPP_HOME)
      );
      expect(writableUnderPyapp.length).toBeGreaterThan(0);

      const outputRule = policy.fs.find(
        (rule) => normalizePath(rule.path) === normalizePath(resolveOutputDir())
      );
      expect(outputRule).toBeDefined();
      expect(isWritable(outputRule!)).toBe(true);
    });
  });

  describe('判定函数自检（证明守卫不是恒真断言）', () => {
    it('`covers` / `isWritable` 对"放宽形态"确实命中', () => {
      // 若将来有人把 `covers` 改成"严格相等"（丢掉"父目录规则覆盖其子路径"这一 Landlock 语义），
      // 整套守卫会**静默失效**（敏感路径永不被判为被覆盖）⇒ 本自检会先红。
      const relaxed: LandlockFsRule = {
        path: PYAPP_HOME,
        allow: ['read', 'write', 'make_dir', 'make_reg', 'remove'],
      };
      expect(covers(relaxed.path, `${PYAPP_HOME}/config.json`)).toBe(true);
      expect(covers(relaxed.path, `${PYAPP_HOME}/data/app.db`)).toBe(true);
      expect(isWritable(relaxed)).toBe(true);

      // 反向 1：受管产物目录**不**覆盖 `data/`（否则"仅限受管目录"的判定会被污染）
      expect(covers(resolveOutputDir(), `${PYAPP_HOME}/data`)).toBe(false);
      // 反向 2：只读形态**不**被判为可写
      const readOnly: LandlockFsRule = {
        path: PYAPP_HOME,
        allow: ['read', 'execute'],
      };
      expect(isWritable(readOnly)).toBe(false);
    });
  });
});
