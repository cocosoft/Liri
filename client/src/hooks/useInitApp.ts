import { useEffect, useReducer } from "react";
import { useSessionStore } from "../stores/sessionStore";
import { useBackendStore } from "../stores/backendStore";
import { useConfigStore } from "../stores/configStore";
import { useRootStore } from "../stores/root-store";
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
        await initBackendUrlFromConfig();
        await checkBackendStatus();
        const { status } = useBackendStore.getState();
        if (!status.running) {
          await startBackend();
        }
        // P0b-4: 后端就绪后执行旧数据迁移（幂等，仅首次执行）
        // W9 修复：失败不再静默吞掉——告警留痕，避免迁移中断无任何提示
        migrateLegacyData().catch((err) => {
          logger.warn("旧数据迁移失败（非致命，跳过）", {
            error: err instanceof Error ? err.message : String(err),
          });
        });
        dispatch({ type: "PHASE2_DONE" });
      } catch (e) {
        dispatch({ type: "ERROR", error: String(e) });
      }
    };
    runPhase2();
  }, [initState.phase, checkBackendStatus, startBackend]);

  // 阶段 3: SSE 连接
  useEffect(() => {
    if (initState.phase !== "phase3_sse") return;

    // P2-4 修复：订阅会话变更事件刷新侧栏列表——后端自动生成标题
    // （autoGenerateTitle → session:renamed）、其它端创建/删除/清空会话时，
    // 前端列表需实时反映；原实现无订阅 + loadChatSessions 早退（列表非空即
    // no-op），标题/列表必须刷新页面才更新。
    // 定义在 try 外以便 cleanup 闭包引用同一引用注销。
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

    // W9 修复：loadSessions 需要 await 完成再 dispatch PHASE3_DONE，
    // 否则 ready 时列表仍为空（用户看到"无会话"闪屏）
    const runPhase3 = async () => {
      try {
        sseService.on("heartbeat", onHeartbeat);
        sseService.on("session:renamed", refreshSessions);
        sseService.on("session:created", refreshSessions);
        sseService.on("session:deleted", refreshSessions);
        sseService.on("session:cleared", refreshSessions);
        // P0b-3: AI 自动建项目时，前端同步创建 worktree
        sseService.on("project:auto_created", onProjectAutoCreated);
        // M1 修复（2026-08-13）：接线 SSE 断开轮询兜底——sseService.setPollHandler
        // 此前从未被调用（死代码），SSE 断开时无任何轮询兜底，只能干等重连。
        // 断开期间每 15s 轮询一次会话列表，保证会话变更在重连前可见。
        sseService.setPollHandler(refreshSessions);
        sseService.connect();
        await loadSessions();
        // 连接/网络状态监测：记录后端掉线/恢复、网络断开/恢复事件
        connectionMonitor.start();
        dispatch({ type: "PHASE3_DONE" });
      } catch (e) {
        dispatch({ type: "ERROR", error: String(e) });
      }
    };
    runPhase3();

    return () => {
      sseService.off("heartbeat", onHeartbeat);
      sseService.off("session:renamed", refreshSessions);
      sseService.off("session:created", refreshSessions);
      sseService.off("session:deleted", refreshSessions);
      sseService.off("session:cleared", refreshSessions);
      sseService.off("project:auto_created", onProjectAutoCreated);
      // M1 修复：卸载时解除轮询回调，避免残留引用
      sseService.setPollHandler(null);
      sseService.disconnect();
      connectionMonitor.stop();
    };
  }, [initState.phase, checkBackendStatus, loadSessions]);

  // 对外暴露的 wizard 完成回调
  const completeWizard = () => {
    dispatch({ type: "WIZARD_COMPLETE" });
  };

  return { initState, completeWizard };
}
