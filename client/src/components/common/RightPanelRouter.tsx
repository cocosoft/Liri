import { useState, useRef, useCallback } from "react";
import { useLocation } from "react-router-dom";
import FilePreviewPanel from "../ChatArea/FilePreviewPanel";
import ToolPanel from "../ToolPanel/ToolPanel";

/** 右侧面板配置：决定各页面显示哪个面板 */
interface RightPanelConfig {
  /** 全宽页面路径（不显示右侧面板） */
  fullWidthPaths: string[];
  /** 路径 → 面板组件映射 */
  panelMap: Record<string, React.ComponentType>;
  /** 默认面板（未匹配到 panelMap 时使用） */
  defaultPanel: React.ComponentType;
}

/** 配置驱动：与 App.tsx 中 inline IIFE 逻辑完全等价 */
const RIGHT_PANEL_CONFIG: RightPanelConfig = {
  fullWidthPaths: [
    "/settings", "/help", "/user", "/dashboard", "/login",
    "/buddy", "/dream", "/memory", "/skills", "/permissions",
    "/market/skills", "/market/mcp",
    "/media", "/image", "/video",
    "/office", "/office/doc", "/office/mail", "/office/calendar",
    "/calendar",
  ],
  panelMap: {
    '/chat': FilePreviewPanel,
    '/': FilePreviewPanel,
  },
  defaultPanel: ToolPanel,
};

const PANEL_MIN = 360;
const PANEL_DEFAULT = 360;
const COLLAPSED_WIDTH = 0;

/** 右侧面板路由组件：根据当前路径决定渲染哪个面板，支持拖拽调整宽度和收缩展开 */
export function RightPanelRouter() {
  const location = useLocation();
  const [panelW, setPanelW] = useState(PANEL_DEFAULT);
  const [collapsed, setCollapsed] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  /** 收缩/展开切换 */
  const toggleCollapse = useCallback(() => {
    setCollapsed((prev) => !prev);
  }, []);

  /** 拖拽调整面板宽度（仅在展开状态下） */
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    if (collapsed) return;
    e.preventDefault();
    draggingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current || !wrapperRef.current) return;
      const parent = wrapperRef.current.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const maxW = rect.width * 0.5;
      const newW = rect.right - ev.clientX;
      setPanelW(Math.max(PANEL_MIN, Math.min(maxW, newW)));
    };

    const onUp = () => {
      draggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [collapsed]);

  // 全宽页面不显示右侧面板
  if (RIGHT_PANEL_CONFIG.fullWidthPaths.includes(location.pathname)) {
    return null;
  }

  // 匹配指定面板，未匹配则使用默认面板
  const Panel = RIGHT_PANEL_CONFIG.panelMap[location.pathname] || RIGHT_PANEL_CONFIG.defaultPanel;

  return (
    <div
      ref={wrapperRef}
      className="relative flex-shrink-0 h-full"
      style={{ width: collapsed ? `${COLLAPSED_WIDTH}px` : `${panelW}px` }}
    >
      {/* 收缩状态：边缘收缩条，hover 提示可展开 */}
      {collapsed && (
        <div
          className="absolute left-0 top-0 bottom-0 w-1.5 cursor-pointer
            hover:bg-blue-400/50 transition-colors z-10"
          style={{ marginLeft: -3 }}
          onClick={toggleCollapse}
          title="展开面板"
        />
      )}

      {/* 展开状态：拖拽手柄 + 收缩按钮 */}
      {!collapsed && (
        <>
          {/* 拖拽手柄 */}
          <div
            className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize 
              hover:bg-blue-400/50 active:bg-blue-500/50 transition-colors z-10"
            style={{ marginLeft: -3 }}
            onMouseDown={handleResizeStart}
          />
          {/* 收缩按钮（在手柄上方） */}
          <button
            onClick={toggleCollapse}
            className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 
              w-5 h-10 bg-gray-200 dark:bg-gray-700 border border-gray-300 
              dark:border-gray-600 rounded-l-md flex items-center justify-center
              hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors z-20
              shadow-sm"
            style={{ marginLeft: -3 }}
            title="收起面板"
          >
            <svg className="w-3 h-3 text-gray-500 dark:text-gray-400" viewBox="0 0 16 16" fill="currentColor">
              <path d="M10.5 3L5.5 8l5 5" stroke="currentColor" strokeWidth="2" fill="none" />
            </svg>
          </button>
          <div className="h-full overflow-hidden">
            <Panel />
          </div>
        </>
      )}
    </div>
  );
}