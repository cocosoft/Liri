import { useEffect, useReducer, useRef } from "react";
import { useSessionStore } from "../stores/sessionStore";
import { useBackendStore } from "../stores/backendStore";
import { useConfigStore } from "../stores/configStore";
import { useRootStore } from "../stores/root-store";
import { initOrchestrationStore } from "../stores/orchestrationStore";
import { sseService } from "../services/sseService";
import { appConfigService } from "../services/appConfigService";
import { migrateLegacyData } from "../services/projectArtifactService";
import { initBackendUrlFromConfig } from "../services/backendUrl";
import { connectionMonitor } from "../services/connectionMonitor";
import { createLogger } from "../utils/logger";

const logger = createLogger("hooks:use-init-app");

// 初始化阶段状态机
type InitPhase =
  | "idle"
  | "phase1_config" // 阶段 1: loadConfig + initBrowserMode（并行）
  | "phase1_first_run" // 阶段 1: 检查首次运行
  | "first_run_wizard" // 显示首次运行向导
  | "phase2_backend" // 阶段 2: checkBackendStatus → startBackend（串行）
  | "phase3_sse" // 阶段 3: sseService.connect（串行）
  | "ready" // 初始化完成
  | "error"; // 初始化失败

type InitAction =
  | { type: "START" }
  | { type: "PHASE1_DONE" }
  | { type: "FIRST_RUN_CHECKED"; isFirstRun: boolean }
  | { type: "WIZARD_COMPLETE" }
  | { type: "PHASE2_DONE" }
  | { type: "PHASE3_DONE" }
  | { type: "ERROR"; error: string };

interface InitState {
  phase: InitPhase;
  error?: string;
}

function initReducer(state: InitState, action: InitAction): InitState {
  switch (action.type) {
    case "START":
      return { phase: "phase1_config" };
    case "PHASE1_DONE":
      return { phase: "phase1_first_run" };
    case "FIRST_RUN_CHECKED":
      return action.isFirstRun
        ? { phase: "first_run_wizard" }
        : { phase: "phase2_backend" };
    case "WIZARD_COMPLETE":
      return { phase: "phase2_backend" };
    case "PHASE2_DONE":
      return { phase: "phase3_sse" };
    case "PHASE3_DONE":
      return { phase: "ready" };
    case "ERROR":
      return { phase: "error", error: action.error };
    default:
      return state;
  }
}

/** 应用初始化 Hook：分阶段并行 + 状态机管理 */
export function useInitApp() {
  const [initState, dispatch] = useReducer(initReducer, { phase: "idle" });

  const { loadSessions } = useSessionStore();
  const {
    checkStatus: checkBackendStatus,
    initBrowserMode,
    startBackend,
  } = useBackendStore.getState();
  const { loadConfig } = useConfigStore();

  // 启动初始化流程
  useEffect(() => {
    dispatch({ type: "START" });
  }, []);

  // 阶段 1: 并行加载配置 + 初始化浏览器模式
  useEffect(() => {
    if (initState.phase !== "phase1_config") return;

    const runPhase1 = async () => {
      try {
        await Promise.all([loadConfig(), initBrowserMode()]);
        dispatch({ type: "PHASE1_DONE" });
      } catch (e) {
        dispatch({ type: "ERROR", error: String(e) });
      }
    };
    runPhase1();
  }, [initState.phase, loadConfig, initBrowserMode]);

  // 阶段 1.5: 检查首次运行
  useEffect(() => {
    if (initState.phase !== "phase1_first_run") return;

    appConfigService
      .isFirstRun()
      .then((firstRun) => {
        dispatch({ type: "FIRST_RUN_CHECKED", isFirstRun: firstRun });
      })
      .catch((e) => {
        dispatch({ type: "ERROR", error: String(e) });
      });
  }, [initState.phase]);

  // 阶段 2: 后端状态检查 + 启动
  useEffect(() => {
    if (initState.phase !== "phase2_backend") return;

    const runPhase2 = async () => {
      try {
        logger.info(
          "[init] phase2 开始：initBackendUrlFromConfig + checkBackendStatus",
        );
        await initBackendUrlFromConfig();
        await checkBackendStatus();
        const { status } = useBackendStore.getState();
        logger.info("[init] phase2 后端状态检查结果", status);
        if (!status.running) {
          logger.info("[init] 后端未运行，调用 startBackend");
          await startBackend();
          const after = useBackendStore.getState();
          logger.info("[init] startBackend 之后状态", after.status);
          if (after.error) {
            logger.error("[init] 后端启动失败", { error: after.error });
          }
        }
        // P0b-4: 后端就绪后执行旧数据迁移（幂等，仅首次执行）
        // W9 修复：失败不再静默吞掉——告警留痕，避免迁移中断无任何提示
        migrateLegacyData().catch((err) => {
          logger.warn("旧数据迁移失败（非致命，跳过）", {
            error: err instanceof Error ? err.message : String(err),
          });
        });
        dispatch({ type: "PHASE2_DONE" });
        logger.info("[init] phase2 完成");
      } catch (e) {
        logger.error("[init] phase2 异常", { error: String(e) });
        dispatch({ type: "ERROR", error: String(e) });
      }
    };
    runPhase2();
  }, [initState.phase, checkBackendStatus, startBackend]);

  // 阶段 3: SSE 连接（重构 2026-09-06：SSE 生命周期脱离 init phase）
  // 原实现把订阅+connect 挂在 initState.phase==='phase3_sse' 的 effect：runPhase3 收尾
  // dispatch PHASE3_DONE（phase→ready）触发 cleanup 断开 SSE，effect 重跑又被门控挡下 →
  // 应用就绪后 SSE 永久断开，pdca:* / session:* 事件永不达前端（UI 走查实证：控制台
  // connect→disconnect 且无 onopen，orchestrationStore 零摄入）。
  // 现改为后端 running 驱动常驻：后端掉线自动断开、恢复自动重连；cleanup 仅在卸载/掉线发生。
  const backendRunning = useBackendStore((s) => s.status.running);
  const sseAttachedRef = useRef(false);
  useEffect(() => {
    if (!backendRunning || sseAttachedRef.current) return;
    sseAttachedRef.current = true;

    // P2-4 修复：订阅会话变更事件刷新侧栏列表——后端自动生成标题
    // （autoGenerateTitle → session:renamed）、其它端创建/删除/清空会话时，
    // 前端列表需实时反映；loadChatSessions 早退（列表非空即 no-op）时仍生效。
    const refreshSessions = () => loadSessions();
    // BUG-2 修复：project:auto_created 处理函数提升为稳定引用——原实现注册传
    // 内联箭头、cleanup 传 `() => {}` 全新函数，按引用匹配永远删不掉监听器：
    // StrictMode 下 effect 双执行 → 事件被处理两次（worktree 创建跑两遍）；
    // 组件卸载后监听器残留 sseService 全局单例，App 重建后叠加。
    const onProjectAutoCreated = (data: Record<string, unknown>) => {
      const { projectId, name } = data;
      logger.info("project:auto_created 收到", {
        projectId,
        name,
        sandboxPath: data.sandboxPath ?? null,
      });
      if (projectId && name) {
        const { createWorkspace } = useRootStore.getState();
        const worktrees = useRootStore.getState().workspaceList;
        // 去重：已存在则跳过
        const worktreeExists = worktrees.some(
          (w) => w.id === String(projectId),
        );
        // P2-2: worktree.path 用事件携带的真实 sandboxPath（工具默认 cwd 依赖它），
        // 兜底退回 projectId
        const pathToUse = String(data.sandboxPath ?? projectId);
        logger.info("project worktree 创建判定", {
          projectId: String(projectId),
          name: String(name),
          pathToUse,
          worktreeExists,
          worktreeCount: worktrees.length,
        });
        if (!worktreeExists) {
          createWorkspace({
            id: String(projectId),
            name: String(name),
            path: pathToUse,
            workspaceSource: "system",
            workspaceType: "project",
          });
          logger.info("project worktree 已创建", {
            projectId: String(projectId),
            name: String(name),
            path: pathToUse,
          });
        }
      } else {
        logger.warn("project:auto_created 事件缺少 projectId/name", {
          projectId,
          name,
        });
      }
    };

    // BUG-1 修复：heartbeat 处理函数提升为稳定引用——原实现注册传内联箭头
    // `() => checkBackendStatus()`、cleanup 传 `checkBackendStatus`（不同引用），
    // sseService.off 按引用删除永远删不掉监听器 → StrictMode/HMR 下泄漏累积。
    const onHeartbeat = () => checkBackendStatus();

    sseService.on("heartbeat", onHeartbeat);
    sseService.on("session:renamed", refreshSessions);
    sseService.on("session:created", refreshSessions);
    sseService.on("session:deleted", refreshSessions);
    sseService.on("session:cleared", refreshSessions);
    // P0b-3: AI 自动建项目时，前端同步创建 worktree
    sseService.on("project:auto_created", onProjectAutoCreated);
    // OBS（M1b）：PDCA 独立事件通道订阅（幂等；任意页面可实时可见任务进度）
    initOrchestrationStore();
    // M1 修复（2026-08-13）：SSE 断开轮询兜底——断开期间每 15s 轮询会话列表，
    // 保证会话变更在重连前可见。
    sseService.setPollHandler(refreshSessions);
    // 注：`connectionMonitor` 的启停已拆到**独立 effect**（deps=[]，见下方），
    // 不再与本 effect 共生命周期 —— 原因见该 effect 的注释（TB-4）。
    sseService.connect();
    logger.info("[init] SSE 常驻订阅已挂接（backend running）");

    return () => {
      sseAttachedRef.current = false;
      sseService.off("heartbeat", onHeartbeat);
      sseService.off("session:renamed", refreshSessions);
      sseService.off("session:created", refreshSessions);
      sseService.off("session:deleted", refreshSessions);
      sseService.off("session:cleared", refreshSessions);
      sseService.off("project:auto_created", onProjectAutoCreated);
      // M1 修复：卸载/掉线时解除轮询回调，避免残留引用
      sseService.setPollHandler(null);
      sseService.disconnect();
    };
  }, [backendRunning, loadSessions, checkBackendStatus]);

  // 连接/网络状态监测 —— **独立 effect，deps 为 `[]`**（2026-09-23 TB-4 修复）
  //
  // 为什么必须独立、且 deps 只能是 `[]`：
  // 1. **循环依赖**：原先它挂在上面那个 effect 上（deps 含 `backendRunning`）—— 而
  //    `backendRunning` 来自 `backendStore.checkStatus()`，其 **catch 分支会把 `running` 置 false**
  //    （`backendStore.ts:72-76`），且它由**每个 SSE heartbeat** 触发（本文件 `onHeartbeat`）。
  //    ⇒ 任何一次后端探测异常 ⇒ 依赖变化 ⇒ 上面 effect 的 cleanup 执行 `stop()`，
  //    而 body 又因门控 `if (!backendRunning || …) return;` **早退**（不再 `start()`）
  //    ⇒ 监测器**被停掉且不再恢复** ⇒ `failCount` 永远到不了 `FAIL_THRESHOLD=3`
  //    ⇒ **后端掉线检测失效**（实测调用栈定位，台账 §TB-4）。
  //    "用后端是否 running 来开关后端可用性检测"本身就是循环依赖 —— 监测器恰恰要在
  //    后端不可用时仍在跑，故其生命周期只能绑**页面**。
  // 2. **解耦副作用**：不再被上面 effect 的门控/依赖抖动（`loadSessions`/`checkBackendStatus` 身份变化）牵连。
  useEffect(() => {
    connectionMonitor.start();
    // 可观测性（dev-only，TB-3）：把**本页应用自己用的那份**实例挂到 window。
    // 必要性：E2E 里 `page.evaluate(() => import("...connectionMonitor.ts"))`（**无 query**）与
    // 页面 bundle 使用的 `?t=<HMR 时间戳>` 是**两个 URL** ⇒ 可能读到**另一份实例**，据此得出
    // "监测器未运行"的**假结论**（TB-3 实测踩过）。由 app 侧导出后，E2E 直接读句柄
    // 即可观测真实实例，无需猜测模块身份。
    if (import.meta.env.DEV) {
      (window as unknown as { __liriConnMonitor?: typeof connectionMonitor })[
        "__liriConnMonitor"
      ] = connectionMonitor;
    }
    return () => {
      connectionMonitor.stop();
    };
  }, []);

  // 阶段 3 收尾：仅加载会话列表并置 ready（W9：await 完成再 ready，避免"无会话"闪屏）
  useEffect(() => {
    if (initState.phase !== "phase3_sse") return;

    const runPhase3 = async () => {
      try {
        await loadSessions();
        dispatch({ type: "PHASE3_DONE" });
      } catch (e) {
        dispatch({ type: "ERROR", error: String(e) });
      }
    };
    runPhase3();
  }, [initState.phase, loadSessions]);

  // 对外暴露的 wizard 完成回调
  const completeWizard = () => {
    dispatch({ type: "WIZARD_COMPLETE" });
  };

  return { initState, completeWizard };
}
