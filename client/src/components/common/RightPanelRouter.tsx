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
  ],
  panelMap: {
    '/chat': FilePreviewPanel,
    '/': FilePreviewPanel,
  },
  defaultPanel: ToolPanel,
};

/** 右侧面板路由组件：根据当前路径决定渲染哪个面板 */
export function RightPanelRouter() {
  const location = useLocation();

  // 全宽页面不显示右侧面板
  if (RIGHT_PANEL_CONFIG.fullWidthPaths.includes(location.pathname)) {
    return null;
  }

  // 匹配指定面板，未匹配则使用默认面板
  const Panel = RIGHT_PANEL_CONFIG.panelMap[location.pathname] || RIGHT_PANEL_CONFIG.defaultPanel;
  return <Panel />;
}