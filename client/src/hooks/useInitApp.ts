import { useEffect, useReducer } from "react";
import { useSessionStore } from "../stores/sessionStore";
import { useBackendStore } from "../stores/backendStore";
import { useConfigStore } from "../stores/configStore";
import { useRootStore } from "../stores/root-store";
import { sseService } from "../services/sseService";
import { appConfigService } from "../services/appConfigService";
import { migrateLegacyData } from "../services/projectArtifactService";
import { initBackendUrlFromConfig } from "../services/backendUrl";

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
        migrateLegacyData().catch(() => {});
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

    try {
      sseService.on("heartbeat", () => checkBackendStatus());
      // P0b-3: AI 自动建项目时，前端同步创建 worktree
      sseService.on("project:auto_created", (data) => {
        const { projectId, name } = data;
        if (projectId && name) {
          const { createWorkspace } = useRootStore.getState();
          const worktrees = useRootStore.getState().workspaceList;
          // 去重：已存在则跳过
          if (!worktrees.some((w) => w.id === String(projectId))) {
            createWorkspace({
              id: String(projectId),
              name: String(name),
              path: String(projectId),
              workspaceSource: "system",
              workspaceType: "project",
            });
          }
        }
      });
      sseService.connect();
      loadSessions();
      dispatch({ type: "PHASE3_DONE" });
    } catch (e) {
      dispatch({ type: "ERROR", error: String(e) });
    }

    return () => {
      sseService.off("heartbeat", checkBackendStatus);
      sseService.off("project:auto_created", () => {});
      sseService.disconnect();
    };
  }, [initState.phase, checkBackendStatus, loadSessions]);

  // 对外暴露的 wizard 完成回调
  const completeWizard = () => {
    dispatch({ type: "WIZARD_COMPLETE" });
  };

  return { initState, completeWizard };
}
