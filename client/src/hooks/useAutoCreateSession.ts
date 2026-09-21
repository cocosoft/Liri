/**
 * useAutoCreateSession — 页面导航时自动在 SessionHub 创建模块 session
 *
 * 监听 react-router 的 location.pathname，通过 FeatureSlice 的模块注册表
 * （moduleRegistry.ts）将 URL 路径映射为 moduleType，自动调用
 * sessionSlice.getOrCreateSession() 确保 SessionHub 中有对应记录。
 *
 * Phase 4 全部迁移后，此钩子可移除（届时由 ViewRouter 直接管理）。
 */

import { useEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useRootStore } from "@/stores/root-store";
import { createLogger } from "@/utils/logger";

const logger = createLogger("hooks:useAutoCreateSession");

/**
 * 根据当前 URL 路径，自动在 SessionHub 中获取或创建对应模块的 session。
 * 仅在根 Store 已初始化时生效。
 *
 * URL → moduleType 映射来自 FeatureSlice 的模块注册表（CS01 归一化），
 * 而非硬编码。新增模块只需在 moduleRegistry.ts 中注册 paths 即可。
 */
export function useAutoCreateSession(): void {
  const location = useLocation();
  const { t } = useTranslation();
  const moduleContext = useRootStore((s) => s.moduleContext);
  const modules = useRootStore((s) => s.modules);
  const getOrCreateSession = useRootStore((s) => s.getOrCreateSession);

  // 从 FeatureSlice 模块注册表派生 URL → moduleType 映射
  const pathToModule = useMemo(() => {
    const map: Record<string, string> = {};
    for (const mod of modules) {
      if (mod.paths) {
        for (const p of mod.paths) {
          map[p] = mod.type;
        }
      }
    }
    return map;
  }, [modules]);

  useEffect(() => {
    // 精确匹配或前缀匹配（如 /office/doc → office）
    let moduleType: string | undefined;
    for (const [path, type] of Object.entries(pathToModule)) {
      if (
        location.pathname === path ||
        location.pathname.startsWith(path + "/")
      ) {
        moduleType = type;
        break;
      }
    }

    if (!moduleType) return; // 首页等非模块页面跳过

    // N-65（2026-09-20）：**会话列表尚未加载完成时不要触发自动创建/恢复**。
    // `getOrCreateSession` 的 chat 复用分支（复用当前会话 → 回退最近的 chat 会话）**都依赖
    // `chatSessions`**；列表未就绪时二者皆空 ⇒ fallthrough 到纯本地 `createSession`
    // ⇒ 生成只存在于前端的幽灵会话（id `sess-*`、标题 `新对话`，实测后端 0 条）。
    // 再叠加 `main.tsx:44` 的 `React.StrictMode`（dev 下 effect 双执行）
    // ⇒ **一次导航就建 2 条**（与实测"恰好 2 条、年龄同步更新"完全吻合）。
    if (useRootStore.getState().isLoading) {
      logger.debug("useAutoCreateSession:会话列表加载中，跳过自动创建/恢复", {
        moduleType,
        path: location.pathname,
      });
      return;
    }

    // A1 临时对话：URL 携带 ?temporary=1 时，确保 chat 当前会话为 temporary 模式。
    // 场景：刷新 /chat?temporary=1（后端 listSessions 已排除临时会话，store 中
    // 无对应记录）→ 自动新建一个临时会话，满足"刷新保留临时状态"。
    const wantsTemporary =
      new URLSearchParams(location.search).get("temporary") === "1";

    // chat 模块：使用 enterModule 设置上下文，替代 switchWorkspace
    if (moduleType === "chat") {
      const state = useRootStore.getState();
      if (state.moduleContext.moduleType !== "chat") {
        state.enterModule({ moduleType: "chat" });
        return;
      }
      if (wantsTemporary) {
        const current =
          state.chatSessions.find((s) => s.id === state.currentSessionId) ??
          (state.currentTempSession?.id === state.currentSessionId
            ? state.currentTempSession
            : null);
        if (!current || current.metadata?.temporary !== true) {
          logger.info("useAutoCreateSession:?temporary=1 当前会话非临时，新建临时会话", {
            path: location.pathname + location.search,
            currentSessionId: state.currentSessionId,
          });
          void state
            .createChatSession(t("chat.temporaryToggle"), { temporary: true })
            .catch((err) =>
              logger.warn("useAutoCreateSession:创建临时会话失败", {
                error: String(err),
              }),
            );
          return;
        }
      }
    }

    // N-64（2026-09-20）：project 模块**不在此处自动创建会话** ——
    // 项目会话的创建/恢复由 `ProjectsPage.init()` 统一负责（走 `createChatSession` ⇒ 落库）。
    // 本 hook 挂在 App 级且依赖 `pathname`/`search`，若在此创建，
    // **每次导航到项目页都会凭空多出一个空会话**（且该路径不落库 ⇒ 刷新即被清 ⇒ 反复创建）。
    if (moduleType === "project") return;

    const sessionId = getOrCreateSession(moduleType);
    logger.debug("Session 自动创建/恢复", {
      path: location.pathname,
      moduleType,
      sessionId,
    });
  }, [location.pathname, location.search, moduleContext, pathToModule, getOrCreateSession, t]);
}
