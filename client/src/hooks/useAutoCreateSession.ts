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

    // chat 模块：使用 enterModule 设置上下文，替代 switchWorkspace
    if (moduleType === "chat") {
      const state = useRootStore.getState();
      if (state.moduleContext.moduleType !== "chat") {
        state.enterModule({ moduleType: "chat" });
        return;
      }
    }

    const sessionId = getOrCreateSession(moduleType);
    logger.debug("Session 自动创建/恢复", {
      path: location.pathname,
      moduleType,
      sessionId,
    });
  }, [location.pathname, moduleContext, pathToModule, getOrCreateSession]);
}
