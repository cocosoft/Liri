/**
 * ChatInspector — 对话信息面板（主组件）
 *
 * Tab 容器 + 收起/展开 + 拖拽调整宽度 + 键盘快捷键。
 * 嵌入 ChatPageLayout 内部，仅聊天页渲染。
 */

import React from "react";
import { useCallback, useRef, useEffect } from "react";
import { useChatInspectorStore } from "../../stores/chatInspectorStore";
import type { InspectorTab } from "../../stores/chatInspectorStore";
import ContextTab from "./ContextTab";
import ToolsTab from "./ToolsTab";
import FilesTab from "./FilesTab";
import SettingsTab from "./SettingsTab";

// ─── 配置 ─────────────────────────────────────────

const TABS: { id: InspectorTab; icon: React.ReactNode; label: string }[] = [
  {
    id: "context",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
        <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6z" />
        <path d="M10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
      </svg>
    ),
    label: "上下文",
  },
  {
    id: "tools",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
        <path
          fillRule="evenodd"
          d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
          clipRule="evenodd"
        />
      </svg>
    ),
    label: "工具",
  },
  {
    id: "files",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
        <path
          fillRule="evenodd"
          d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"
          clipRule="evenodd"
        />
      </svg>
    ),
    label: "文件",
  },
  {
    id: "settings",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
        <path
          fillRule="evenodd"
          d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
          clipRule="evenodd"
        />
      </svg>
    ),
    label: "设置",
  },
];

// ─── 子组件 ───────────────────────────────────────

function CollapsedBarImpl({
  onExpandAndSwitch,
}: {
  onExpandAndSwitch: (tab: InspectorTab) => void;
}) {
  const activeToolCount = useChatInspectorStore((s) => s.activeToolCount);
  const newFileCount = useChatInspectorStore((s) => s.newFileCount);
  const tokenWarning = useChatInspectorStore((s) => s.tokenWarning);

  return (
    <div className="w-12 flex flex-col items-center py-2 gap-2 bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700">
      {TABS.map((tab) => {
        const badge =
          tab.id === "tools" && activeToolCount > 0
            ? `${activeToolCount}`
            : tab.id === "files" && newFileCount > 0
              ? `+${newFileCount}`
              : tab.id === "context" && tokenWarning
                ? "!"
                : null;
        return (
          <button
            key={tab.id}
            onClick={() => onExpandAndSwitch(tab.id)}
            className="relative p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            title={`展开到${tab.label} Tab`}
          >
            {tab.icon}
            {badge && (
              <span
                className={`absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center text-[10px] font-bold text-white rounded-full ${
                  tab.id === "context"
                    ? "bg-red-500"
                    : tab.id === "tools"
                      ? "bg-blue-500 animate-pulse"
                      : "bg-green-500"
                }`}
              >
                {badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
const CollapsedBar = React.memo(CollapsedBarImpl);

function TabContentImpl({ tabId }: { tabId: InspectorTab }) {
  switch (tabId) {
    case "context":
      return <ContextTab />;
    case "tools":
      return <ToolsTab />;
    case "files":
      return <FilesTab />;
    case "settings":
      return <SettingsTab />;
  }
}
const TabContent = React.memo(TabContentImpl);

// ─── 主组件 ───────────────────────────────────────

function ChatInspector() {
  const isOpen = useChatInspectorStore((s) => s.isOpen);
  const activeTab = useChatInspectorStore((s) => s.activeTab);
  const panelWidth = useChatInspectorStore((s) => s.panelWidth);
  const setOpen = useChatInspectorStore((s) => s.setOpen);
  const setActiveTab = useChatInspectorStore((s) => s.setActiveTab);
  const setPanelWidth = useChatInspectorStore((s) => s.setPanelWidth);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  // 小屏 (<1024px) 自动收起
  useEffect(() => {
    const BREAKPOINT = 1024;
    function handleResize() {
      if (window.innerWidth < BREAKPOINT && isOpen) {
        setOpen(false);
      }
    }
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [isOpen, setOpen]);

  // Ctrl+1~4 切换 Tab, Ctrl+` 切换展开/收起
  useEffect(() => {
    const KEY_MAP: Record<string, InspectorTab> = {
      "1": "context",
      "2": "tools",
      "3": "files",
      "4": "settings",
    };
    function handleKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey && KEY_MAP[e.key]) {
        e.preventDefault();
        setActiveTab(KEY_MAP[e.key]);
        if (!isOpen) setOpen(true);
      }
      if (e.ctrlKey && e.key === "`") {
        e.preventDefault();
        setOpen(!isOpen);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, setOpen, setActiveTab]);

  const handleExpandAndSwitch = useCallback(
    (tab: InspectorTab) => {
      setActiveTab(tab);
      setOpen(true);
    },
    [setActiveTab, setOpen],
  );
  const handleTabClick = useCallback(
    (tab: InspectorTab) => {
      setActiveTab(tab);
    },
    [setActiveTab],
  );

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      if (!isOpen) return;
      e.preventDefault();
      draggingRef.current = true;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      const onMove = (ev: MouseEvent) => {
        if (!draggingRef.current || !wrapperRef.current) return;
        const parent = wrapperRef.current.parentElement;
        if (!parent) return;
        const rect = parent.getBoundingClientRect();
        setPanelWidth(rect.right - ev.clientX);
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
    },
    [isOpen, setPanelWidth],
  );

  if (!isOpen)
    return <CollapsedBar onExpandAndSwitch={handleExpandAndSwitch} />;

  return (
    <div
      ref={wrapperRef}
      className="relative flex-shrink-0 h-full bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 flex flex-col transition-all duration-300 ease-in-out overflow-hidden"
      style={{ width: `${panelWidth}px` }}
    >
      <div
        className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-400/50 active:bg-blue-500/50 transition-colors z-10"
        style={{ marginLeft: -3 }}
        onMouseDown={handleResizeStart}
      />
      <div className="flex border-b border-gray-200 dark:border-gray-700">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => handleTabClick(tab.id)}
            className={`flex-1 flex flex-col items-center gap-1 py-2.5 text-xs transition-colors ${
              activeTab === tab.id
                ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
            title={tab.label}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        <TabContent tabId={activeTab} />
      </div>
      <button
        onClick={() => setOpen(false)}
        className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 w-5 h-10 bg-gray-200 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-l-md flex items-center justify-center hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors z-20 shadow-sm"
        style={{ marginLeft: -3 }}
        title="收起面板"
      >
        <svg
          className="w-3 h-3 text-gray-500 dark:text-gray-400"
          viewBox="0 0 16 16"
          fill="currentColor"
        >
          <path
            d="M10.5 3L5.5 8l5 5"
            stroke="currentColor"
            strokeWidth="2"
            fill="none"
          />
        </svg>
      </button>
    </div>
  );
}

export default React.memo(ChatInspector);
