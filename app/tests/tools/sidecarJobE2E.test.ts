/**
 * T1-2② / TG-2+TG-6 · **C₁ 片**：跨进程「提交即返 → 完成回推」端到端（2026-10-13）
 *
 * 用**真实子进程**夹具（`fixtures/fakeJobSidecar.js`，与既有 `fakeLspServer.js` 同法）驱动
 * `ToolSidecarSupervisor`：验证 `submitJob()` **立即返回**、完成由 `notify{job.completed}` 兑现；
 * 失败作业 `reject`；**永不回推 ⇒ 超时兜底 reject**（绝不悬挂）；**侧车退出 ⇒ 在飞作业同口 reject**。
 *
 * ⚠️ **取证注记（2026-10-13；**含两次结论更正后再更正，如实留痕**）**：
 * **现象**：**单作业**用例（提交后等 `notify` 兑现）若在**本测试进程内**直接调主管，在 **bun test**
 * 下**稳定走超时兜底**；而「多作业（并发 2 作业）/ 超时兜底 / 侧车退出」用例**通过**。
 * **已排除（逐项证据）**：夹具未写出（同步落盘探针证明 `notify written`）· 夹具侧 stdio 冲刷
 * （改 `fs.writeSync(1,…)` 现象不变）· 静态顶层导入 · 文件内先后位置 · 实例生命周期共享
 * （每条自持 + `finally` 自停）· **`readline`**（主管 `start()` 内加**原始 stdout 帧计数**后见
 * `notify` **迟到至杀进程 EOF（+3.02s）**，据此**改手写分帧仍 2 例 fail** ⇒ 排除）· spawn `env` 覆盖 ·
 * `child.on('exit')` 监听（单变量实验两者均 ~183ms 正常）· **子进程 stdout 管道本身** · **产品接线**。
 * **决定性隔离（建议 3：脱离 `bun test` 的纯脚本）**：{纯脚本, `bun test`} × {裸 spawn, 经主管}
 * = **✅ ✅ / ✅ ❌** —— 同一主管 + 同一夹具在**纯脚本**下 **3/3 正常**（兑现 31–32ms），
 * `bun test` 内**裸 spawn** 亦正常（`notify` +169ms）⇒ **失败仅在「`bun test` × 主管」组合**；
 * **机制未解释**（**不宣称平台缺陷**）。
 * **结论更正留痕**：原推断「平台 `readline` 投递缺陷」→ 曾被一次「独立文件即通过」的观察撤回 →
 * 该观察**不可复现**（新建同代码独立文件 2/2 失败）⇒ 定性回归「根因未定位」→ 再由 2×2 矩阵
 * **收敛为「运行器 × 主管 组合」**（且**非产品接线**）。
 * **⇒ 本两例改用「子进程 oracle」**（`fixtures/jobSupervisorChild.ts`，与既有
 * `executionCrashChild.ts` 同法）：把**真实主管 + 真实侧车**放进**真实子进程**跑，
 * 父进程只核对**投影结果**（结果行 + 退出码）⇒ 取得**真实跨进程端到端证据**，
 * 且**不改产品接线、不推红测、不依赖该运行器语义**。**代价（如实）**：断言发生在子进程，
 * 父进程核对的是**投影结果**。
 *
 * **C₂ 增补（2026-10-13）**：同一 oracle 增 `suspend-e2e` 场景 —— **提交 → 挂起 → 完成 → 续跑**
 * （真实主管 + **真实挂起协调器** + **真实 SPI 注册** `registerToolJobSuspendSpi`；并订阅
 * `state:projected` **实收**投影）：核对 `kind='tool-job'` 登记、**完成前后均处挂起**、释放后解冻、
 * `SUSPENDED → RUNNING` **时序**、结果回填。开关经 spawn 的 **env** 打开（由子进程环境决定）。
 */
import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { ToolSidecarSupervisor } from '../../src/tools/sidecar/ToolSidecarSupervisor.js';

const SCRIPT = resolve(__dirname, 'fixtures/fakeJobSidecar.js');

/** 子进程 oracle（`fixtures/jobSupervisorChild.ts`）：真实主管 + 真实侧车在**真实子进程**中跑 */
const CHILD = resolve(__dirname, 'fixtures/jobSupervisorChild.ts');

/** oracle 的**投影结果**（父进程只能看到这些；判定在父侧做） */
type OracleProjection = {
  facts: {
    startupMs?: number;
    submitMs?: number;
    pendingAfterSubmit?: number;
    elapsedMs?: number;
    pendingAfter?: number;
    result?: unknown;
    error?: string | null;
    /** `suspend-e2e`（C₂）专用事实 */
    spiIds?: string[];
    jobId?: string;
    registerOutcome?: { registered: boolean; reason?: string };
    suspendedDuringWait?: boolean;
    suspendedAfterCompletion?: boolean;
    released?: boolean;
    suspendedAfterRelease?: boolean;
    kinds?: string[];
    projections?: string[];
  };
  fatal: string | null;
};

/**
 * 运行 oracle 并解析其**单行**投影（前缀 `ORACLE_RESULT `）。
 *
 * `projection=null` 表示 oracle **未产出结果行**（如进程被崩、结果行未到达）——
 * 此时由调用方连同 `raw` 一并断言，**不臆造**投影（CS06）。
 *
 * `extraEnv` 用于按场景开启功能开关（如 C₂ 的作业挂起 / 四原语投影广播）——
 * 开关由**子进程环境**决定，故必须经 spawn 传入（父进程内改 env 影响不到已 spawn 的子进程）。
 */
function runOracle(
  scenario: 'single-ok' | 'single-fail' | 'suspend-e2e',
  extraEnv?: Record<string, string>
): {
  status: number | null;
  projection: OracleProjection | null;
  raw: string;
} {
  const r = spawnSync(process.execPath, [CHILD, scenario], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 30_000,
    env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
  });
  const raw = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const line = raw.split('\n').find((l) => l.startsWith('ORACLE_RESULT '));
  return {
    status: r.status,
    projection: line
      ? (JSON.parse(line.slice('ORACLE_RESULT '.length)) as OracleProjection)
      : null,
    raw,
  };
}

/** 每条用例**自持**实例：构造 → 启动 → 用 → `finally` 自停（**不跨用例共享、不统一清理**） */
async function withSidecar(
  jobTimeoutMs: number,
  run: (sup: ToolSidecarSupervisor) => Promise<void>
): Promise<void> {
  const sup = new ToolSidecarSupervisor({
    scriptPath: SCRIPT,
    startupTimeoutMs: 10_000,
    requestTimeoutMs: 3_000,
    jobTimeoutMs,
    maxRestarts: 0,
  });
  try {
    await sup.start();
    await run(sup);
  } finally {
    try {
      sup.stop();
    } catch {
      // 停止失败不影响断言（夹具进程随测试进程退出）
    }
  }
}

describe('T1-2② C₁：侧车作业跨进程端到端', () => {
  // ① 提交即返 + 完成兑现（**子进程 oracle**：真实主管 + 真实侧车在真实子进程中跑；
  //    原因见顶部取证注记 —— 「`bun test` × 主管」组合下异步完成通知在本进程内未被兑现）
  it('提交即返；完成由 `notify{job.completed}` 兑现（**子进程 oracle**）', () => {
    const r = runOracle('single-ok');
    expect(
      r.projection,
      `oracle 未产出结果行（status=${String(r.status)}）；原始输出：\n${r.raw}`
    ).not.toBeNull();
    expect(r.projection!.fatal).toBeNull();
    expect(r.status).toBe(0);
    const f = r.projection!.facts;
    // **提交即返**：提交本身耗时可忽略（不含完成等待），且此刻作业在飞
    expect(f.submitMs).toBeLessThan(500);
    expect(f.pendingAfterSubmit).toBe(1);
    // **完成兑现**（非超时兜底：oracle 侧兜底为 4s ⇒ < 1s 即证是真 `notify` 兑现）
    expect(f.elapsedMs).toBeLessThan(1_000);
    expect(f.result).toEqual({ echo: 'slow', n: 1 });
    expect(f.pendingAfter).toBe(0); // 两本账都结清
  });

  // ② 失败作业 ⇒ reject（同一 oracle 机制）
  it('作业失败（`ok=false`）⇒ reject（**子进程 oracle**）', () => {
    const r = runOracle('single-fail');
    expect(
      r.projection,
      `oracle 未产出结果行（status=${String(r.status)}）；原始输出：\n${r.raw}`
    ).not.toBeNull();
    expect(r.projection!.fatal).toBeNull();
    const f = r.projection!.facts;
    expect(f.error).toContain('fixture failure');
    expect(f.elapsedMs).toBeLessThan(1_000); // 真实回推，非超时兜底
    expect(f.pendingAfter).toBe(0);
  });

  // ③ C₂（挂起 → 续跑）：真实主管 + 真实挂起协调器 + **真实 SPI 注册**，在真实子进程中跑
  it('「提交 → 挂起 → 完成 → 续跑」（**子进程 oracle**：真实协调器 + 真实 SPI）', () => {
    const r = runOracle('suspend-e2e', {
      FEATURE_TOOL_JOB_SUSPEND: 'true',
      FEATURE_STATE_PROJECTION_BROADCAST: 'true',
    });
    expect(
      r.projection,
      `oracle 未产出结果行（status=${String(r.status)}）；原始输出：\n${r.raw}`
    ).not.toBeNull();
    expect(r.projection!.fatal).toBeNull();
    expect(r.status).toBe(0);
    const f = r.projection!.facts;
    // 真实 SPI 注册（生产同一入口 `entrypoints/spiWiring.ts` 的推送注册）
    expect(f.spiIds).toEqual(['core.spi.IToolJobSuspendPort']);
    expect(f.registerOutcome).toEqual({ registered: true });
    // **挂起**：提交后 / 完成前确处挂起态（"不推进轮次"的登记事实），类别为 tool-job
    expect(f.suspendedDuringWait).toBe(true);
    expect(f.kinds).toEqual(['tool-job']);
    // **完成 → 解冻**先后可辨：完成通知兑现之后、释放之前**仍**挂起
    expect(f.suspendedAfterCompletion).toBe(true);
    // **续跑**：释放 ⇒ 解冻 + 结果回填
    expect(f.released).toBe(true);
    expect(f.suspendedAfterRelease).toBe(false);
    expect(f.result).toEqual({ echo: 'slow', n: 1 });
    // 四原语投影**时序**（经 `globalEventBus` 实收）
    expect(f.projections).toEqual(['SUSPENDED', 'RUNNING']);
    expect(f.pendingAfter).toBe(0);
  });

  it('侧车**永不回推** ⇒ 超时兜底 reject（绝不永久悬挂）', async () => {
    await withSidecar(3_000, async (sup) => {
      const { completion } = await sup.submitJob('never', undefined, {
        timeoutMs: 60,
      });
      await expect(completion).rejects.toThrow(/超时/);
      expect(sup.pendingJobCount).toBe(0);
    });
  });

  it('并发多作业：各自独立兑现（互不串线）', async () => {
    await withSidecar(3_000, async (sup) => {
      const a = await sup.submitJob('slow', { delayMs: 40 });
      const b = await sup.submitJob('slow', { delayMs: 5 });
      expect(sup.pendingJobCount).toBe(2);
      const [ra, rb] = await Promise.all([a.completion, b.completion]);
      expect(ra).toEqual({ echo: 'slow', n: expect.any(Number) });
      expect(rb).toEqual({ echo: 'slow', n: expect.any(Number) });
      expect(sup.pendingJobCount).toBe(0);
    });
  });

  it('侧车退出 ⇒ 在飞作业与在飞请求同口 reject（两本账都不悬挂）', async () => {
    const sup = new ToolSidecarSupervisor({
      scriptPath: SCRIPT,
      startupTimeoutMs: 10_000,
      requestTimeoutMs: 3_000,
      jobTimeoutMs: 3_000,
      maxRestarts: 0,
    });
    await sup.start();
    const { completion } = await sup.submitJob('never');
    expect(sup.pendingJobCount).toBe(1);
    sup.stop(); // 杀子进程 ⇒ onExit ⇒ rejectAllPending → jobs.rejectAll
    await expect(completion).rejects.toThrow(/已退出|工具侧车/);
    expect(sup.pendingJobCount).toBe(0);
  });
});
