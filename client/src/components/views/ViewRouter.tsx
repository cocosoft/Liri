/**
 * ViewRouter — 基于 Session 的动态模块路由
 *
 * 根据当前 session 的 moduleType 动态渲染对应模块视图组件。
 * 组件从 FeatureSlice 的 modules 注册表中查找，新模块只需 registerModule()，
 * 无需修改 ViewRouter 或路由表。
 */

import React, { Suspense } from "react";
import { useRootStore } from "@/stores/root-store";
import { selectCurrentSession, selectEnabledModules } from "@/stores/selectors";
import { createLogger } from "@/utils/logger";

const logger = createLogger("ViewRouter");

/** 无 Session 时的欢迎/首页占位 */
function WelcomeScreen(): React.ReactElement {
  const wt = useRootStore(selectCurrentSession);

  return (
    <div className="flex items-center justify-center h-full text-muted-foreground">
      <div className="text-center">
        <p className="text-lg mb-2">选择一个功能模块开始</p>
        {wt && (
          <p className="text-sm">当前工作空间: {wt.workspaceId ?? "未选择"}</p>
        )}
      </div>
    </div>
  );
}

/**
 * 主路由组件
 *
 * 从 Root Store 中读取当前 session 和已注册的模块列表，
 * 根据 moduleType 动态查找对应视图组件渲染。
 */
export function ViewRouter(): React.ReactElement {
  const currentSession = useRootStore(selectCurrentSession);
  const modules = useRootStore(selectEnabledModules);

  if (!currentSession) {
    return <WelcomeScreen />;
  }

  // 按 moduleType 匹配（因为 session.moduleType 存的是模块类型如 'chat'/'media'）
  const mod = modules.find((m) => m.type === currentSession.moduleType);
  const Component = mod?.component;

  if (!Component) {
    logger.debug("未找到模块视图组件", {
      moduleType: currentSession.moduleType,
    });
    return <WelcomeScreen />;
  }

  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full">加载中...</div>
      }
    >
      <Component sessionId={currentSession.id} />
    </Suspense>
  );
}

export default ViewRouter;
