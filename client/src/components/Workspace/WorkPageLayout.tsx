import { useCallback, useRef, useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import WorkSpaceSidebar from "./WorkSpaceSidebar";
import WorkContentArea from "./WorkContentArea";
import WorkChatPanel from "./WorkChatPanel";
import { useWorkspaceStore } from "../../stores/workspaceStore";

/**
 * 工作界面三栏布局容器
 *
 * 左栏（260px）: 文件树 + 工作项列表
 * 中栏（flex 1）: 内容区（根据 Plan/Do 模式切换视图）
 * 右栏（400px）: AI 对话区
 *
 * 支持左右栏宽度拖拽调整
 */
export default function WorkPageLayout() {
  const { id: workspaceId } = useParams<{ id: string }>();
  const containerRef = useRef<HTMLDivElement>(null);
  const [leftWidth, setLeftWidth] = useState(260);
  const [rightWidth, setRightWidth] = useState(400);
  const [dragging, setDragging] = useState<"left" | "right" | null>(null);

  const openWorkspace = useWorkspaceStore((s) => s.openWorkspace);
  const checkBackendReady = useWorkspaceStore((s) => s.checkBackendReady);

  /** 初始化：打开工作空间 + 检查后端就绪状态 */
  useEffect(() => {
    if (workspaceId) {
      openWorkspace(workspaceId);
    }
    checkBackendReady();
  }, [workspaceId, openWorkspace, checkBackendReady]);

  /**
   * 拖拽手柄鼠标事件处理
   */
  const handleMouseDown = useCallback((side: "left" | "right") => (e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(side);
  }, []);

  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();

      if (dragging === "left") {
        const w = Math.max(200, Math.min(500, e.clientX - rect.left));
        setLeftWidth(w);
      } else if (dragging === "right") {
        const w = Math.max(320, Math.min(600, rect.right - e.clientX));
        setRightWidth(w);
      }
    };

    const handleMouseUp = () => setDragging(null);

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragging]);

  return (
    <div
      ref={containerRef}
      className="flex h-screen bg-gray-50 dark:bg-gray-950 select-none"
    >
      {/* 左栏：文件树 + 工作项列表 */}
      <div style={{ width: leftWidth }} className="flex-shrink-0 h-full">
        <WorkSpaceSidebar className="h-full" />
      </div>

      {/* 左拖拽手柄 */}
      <div
        className={`w-1 cursor-col-resize flex-shrink-0 transition-colors ${
          dragging === "left"
            ? "bg-blue-500"
            : "bg-transparent hover:bg-blue-300 dark:hover:bg-blue-700"
        }`}
        onMouseDown={handleMouseDown("left")}
      />

      {/* 中间：内容区 */}
      <div className="flex-1 min-w-0 h-full">
        <WorkContentArea className="h-full" />
      </div>

      {/* 右拖拽手柄 */}
      <div
        className={`w-1 cursor-col-resize flex-shrink-0 transition-colors ${
          dragging === "right"
            ? "bg-blue-500"
            : "bg-transparent hover:bg-blue-300 dark:hover:bg-blue-700"
        }`}
        onMouseDown={handleMouseDown("right")}
      />

      {/* 右栏：AI 对话区 */}
      <div style={{ width: rightWidth }} className="flex-shrink-0 h-full">
        <WorkChatPanel className="h-full" />
      </div>
    </div>
  );
}