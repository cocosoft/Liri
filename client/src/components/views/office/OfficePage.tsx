/**
 * OfficePage — 办公模块入口页面（v6 三栏式）
 * 三栏布局：功能区(260px) | 预览区(1fr) | AI辅助(260px)
 * CSS Grid 过渡 + 响应式 + a11y + 拖拽
 */

import { useEffect, useCallback, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useOfficeStore } from "../../../stores/officeStore";
import { useRootStore } from "../../../stores/root-store";
import { useChatStore } from "../../../stores/chat";
import { useSessionStore } from "../../../stores/sessionStore";
import { officeService } from "../../../services/officeService";
import { useOfficeHotkeys } from "../../../hooks/useOfficeHotkeys";
import { LeftPanel } from "./LeftPanel";
import { CenterPanel } from "./CenterPanel";
import { OfficeChatPanel } from "./OfficeChatPanel";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useSessionContextSync } from "../../../hooks/useSessionContextSync";
import { createLogger } from "../../../utils/logger";

const logger = createLogger("components:office:OfficePage");

export default function OfficePage() {
  const { t } = useTranslation();
  const {
    userCollapsed,
    responsiveMode,
    setDocStatus,
    setMailConfigured,
    setMailList,
    setCalendarEvents,
    setResponsiveMode,
    refreshFileList,
  } = useOfficeStore();

  const enterModule = useRootStore((s) => s.enterModule);
  const leaveModule = useRootStore((s) => s.leaveModule);
  useEffect(() => {
    enterModule({ moduleType: "office" });
    return () => leaveModule();
  }, [enterModule, leaveModule]);

  /** 注册快捷键 */
  useOfficeHotkeys();

  /** 模块上下文同步：保存/恢复 OfficeSessionContext */
  useSessionContextSync("office", {
    save: () => {
      const state = useOfficeStore.getState();
      return {
        moduleType: "office" as const,
        fileRef: state.selectedFile?.name ?? "",
        templateId: state.docTemplates?.[0],
      };
    },
    restore: (ctx) => {
      if (ctx.moduleType !== "office") return;
      if (ctx.fileRef) {
        const state = useOfficeStore.getState();
        const file = state.fileList.find((f) => f.name === ctx.fileRef);
        if (file) state.selectFile(file);
      }
    },
  });

  /** 初始化：加载办公模块状态 */
  useEffect(() => {
    fetchOfficeStatus();
    refreshFileList();
    setupResizeListener();
    setupBeforeUnload();

    return () => {
      teardownResizeListener();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 获取各办公模块状态 */
  async function fetchOfficeStatus() {
    try {
      const [docEnvelope, mailEnvelope, calEnvelope] = await Promise.all([
        officeService.getDocStatus().catch(() => null),
        officeService.getMailStatus().catch(() => null),
        officeService.getCalendarStatus().catch(() => null),
      ]);

      const docData = (docEnvelope as unknown as Record<string, unknown>)
        ?.data as unknown as Record<string, unknown> | undefined;
      const docInstalled =
        (docData?.data as unknown as Record<string, unknown>)?.officeCliInfo &&
        (
          (docData?.data as unknown as Record<string, unknown>)
            ?.officeCliInfo as unknown as Record<string, unknown>
        )?.installed === true;

      const mailOk =
        (mailEnvelope as unknown as Record<string, unknown>)?.ok !== false;

      const calOk =
        (calEnvelope as unknown as Record<string, unknown>)?.ok !== false;

      setDocStatus(docInstalled ? "FULL" : "DEGRADED");

      if (mailOk) {
        setMailConfigured(true);
        try {
          const inboxRes = await officeService
            .getMailInbox(3)
            .catch(() => null);
          const inboxData = (inboxRes as unknown as Record<string, unknown>)
            ?.data as unknown as Record<string, unknown> | undefined;
          const mails =
            ((inboxData?.data as unknown as Record<string, unknown>)
              ?.mails as Array<Record<string, unknown>>) ?? [];
          setMailList(
            mails as unknown as Array<{
              subject: string;
              from: string;
              date: string;
            }>,
          );
        } catch {
          // 静默
        }
      }

      if (calOk) {
        try {
          const calRes = await officeService
            .getCalendarEvents()
            .catch(() => null);
          const calData = (calRes as unknown as Record<string, unknown>)
            ?.data as unknown as Record<string, unknown> | undefined;
          const events =
            ((calData?.data as unknown as Record<string, unknown>)
              ?.events as Array<Record<string, unknown>>) ?? [];
          setCalendarEvents(
            events as unknown as Array<{
              id: string;
              summary: string;
              start: string;
              end: string;
            }>,
          );
        } catch {
          // 静默
        }
      }
    } catch {
      setDocStatus("DEGRADED");
    }
  }

  // --- 响应式监听 ---
  let resizeTimer: ReturnType<typeof setTimeout>;

  function setupResizeListener() {
    handleResize();
    window.addEventListener("resize", handleResizeDebounced);
  }

  function teardownResizeListener() {
    window.removeEventListener("resize", handleResizeDebounced);
  }

  function handleResizeDebounced() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(handleResize, 150);
  }

  function handleResize() {
    const w = window.innerWidth;
    if (w >= 1280) {
      setResponsiveMode("normal");
    } else if (w >= 1024) {
      setResponsiveMode("drawer");
    } else {
      setResponsiveMode("hidden");
    }
  }

  // --- beforeunload 保护 ---
  function setupBeforeUnload() {
    const handler = (e: BeforeUnloadEvent) => {
      if (useOfficeStore.getState().chatDirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    // 存储引用以便清理
    (window as unknown as Record<string, unknown>).__officeBeforeUnload =
      handler;
  }

  useEffect(() => {
    return () => {
      const handler = (window as unknown as Record<string, unknown>)
        .__officeBeforeUnload as (e: BeforeUnloadEvent) => void;
      if (handler) {
        window.removeEventListener("beforeunload", handler);
      }
    };
  }, []);

  // --- 抽屉关闭 ---
  const handleCloseDrawer = useCallback(() => {
    useOfficeStore.getState().toggleRightPanel();
  }, []);

  // --- 发送消息回调（接入真实 AI 管线）---
  const handleSendMessage = useCallback(async (message: string) => {
    const officeStore = useOfficeStore.getState();
    const chatStore = useChatStore.getState();
    const sessionStore = useSessionStore.getState();

    logger.debug("handleSendMessage 触发", {
      message: message.slice(0, 50),
    });

    // 每次文档生成请求都创建新会话，避免旧历史污染 AI 判断
    let sessionId: string;
    try {
      const newSession = await sessionStore.createSession("办公文档");
      sessionId = newSession?.id ?? "office-default";
      logger.debug("创建办公专用新会话", { sessionId });
    } catch (err) {
      logger.error("创建会话失败", err);
      sessionId = "office-default";
    }

    // 记录文件列表快照（用于生成后对比，找到新文件）
    const beforeFiles = new Set(officeStore.fileList.map((f) => f.name));
    logger.debug("发送前文件列表", {
      count: beforeFiles.size,
      files: [...beforeFiles],
    });

    officeStore.setGenerationStatus({
      active: true,
      fileName: "文档",
      progress: "AI 正在处理您的请求...",
    });

    try {
      // 通过主 AI 管线发送消息
      logger.debug("调用 chatStore.sendMessage", { sessionId });
      await chatStore.sendMessage(message, sessionId);
      logger.debug("sendMessage 完成");

      // AI 响应完成后，同步助手消息到办公面板
      const latestMessages = useChatStore.getState().messages;
      const lastAssistant = [...latestMessages]
        .reverse()
        .find((m) => m.role === "assistant" && m.session_id === sessionId);

      logger.debug("AI响应", {
        hasAssistant: !!lastAssistant,
        content: lastAssistant?.content?.slice(0, 100),
        totalMessages: latestMessages.length,
      });

      if (lastAssistant) {
        const assistantMsg = {
          id: lastAssistant.id,
          role: "assistant" as const,
          content: lastAssistant.content || "(文档已生成)",
          timestamp: lastAssistant.timestamp,
        };
        officeStore.addChatMessage(assistantMsg);
      }

      // 刷新文件列表，检测新生成的文件
      logger.debug("刷新文件列表");
      await officeStore.refreshFileList();

      // 自动选中新生成的文件（对比前后文件列表差异）
      const afterFiles = useOfficeStore.getState().fileList;
      const newFile = afterFiles.find((f) => !beforeFiles.has(f.name));

      logger.debug("文件对比结果", {
        beforeCount: beforeFiles.size,
        afterCount: afterFiles.length,
        newFileName: newFile?.name,
        afterFileNames: afterFiles.map((f) => f.name),
      });

      if (newFile) {
        officeStore.selectFile(newFile);
        officeStore.setPreviewState("loading");
        officeStore.setGenerationStatus({
          active: false,
          fileName: newFile.name,
        });
      } else {
        // 未检测到新文件，可能是 AI 以文本方式回复
        officeStore.setGenerationStatus({ active: false });
      }
    } catch (err) {
      // 错误处理：展示用户友好的提示
      logger.error("sendMessage 异常", err);
      const errMsg = err instanceof Error ? err.message : String(err);
      officeStore.addChatMessage({
        id: `err-${Date.now()}`,
        role: "assistant",
        content: `抱歉，文档生成遇到问题：${errMsg}`,
        timestamp: Date.now(),
      });
      officeStore.setGenerationStatus({ active: false });
    }
  }, []);

  // --- 右栏可拖拽宽度 ---
  const RIGHT_PANEL_MIN = 360; // 最小宽度 px
  const RIGHT_PANEL_DEFAULT = 360; // 默认宽度 px
  const [rightPanelW, setRightPanelW] = useState(RIGHT_PANEL_DEFAULT);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  /** 拖拽开始 */
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const maxW = rect.width * 0.5; // 最大 50%
      const newW = rect.right - ev.clientX;
      setRightPanelW(Math.max(RIGHT_PANEL_MIN, Math.min(maxW, newW)));
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
  }, []);

  // --- 计算右栏显示 ---
  const rightPanelVisible = !userCollapsed && responsiveMode !== "hidden";
  const rightPanelMode: "inline" | "drawer" =
    responsiveMode === "drawer" ? "drawer" : "inline";

  // Grid 列布局（左栏 260px | 中栏自适应 | 右栏可拖拽）
  const rightCol = `${rightPanelW}px`;
  const gridColumns =
    rightPanelVisible && rightPanelMode === "inline"
      ? `260px 1fr ${rightCol}`
      : "260px 1fr 0px";

  /** 右栏渲染方式：始终嵌入 OfficePage 内部，drawer 模式用 absolute 覆盖 */
  const renderRightPanel = () => {
    if (!rightPanelVisible) return null;

    const isDrawer = rightPanelMode === "drawer";

    return (
      <div
        className={
          isDrawer
            ? "absolute right-0 top-0 bottom-0 z-[1000] shadow-lg"
            : "relative"
        }
        style={isDrawer ? { width: `${rightPanelW}px` } : undefined}
      >
        {/* 拖拽手柄 + 收缩按钮（内联模式） */}
        {!isDrawer && (
          <>
            <div
              className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize 
                hover:bg-blue-400/50 active:bg-blue-500/50 transition-colors z-10"
              style={{ marginLeft: -3 }}
              onMouseDown={handleResizeStart}
            />
            <button
              onClick={() => useOfficeStore.getState().toggleRightPanel()}
              className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 
                w-5 h-10 bg-gray-200 dark:bg-gray-700 border border-gray-300 
                dark:border-gray-600 rounded-l-md flex items-center justify-center
                hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors z-20
                shadow-sm"
              style={{ marginLeft: -3 }}
              title="收起AI面板"
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
          </>
        )}
        {isDrawer && (
          <div
            className="fixed inset-0 bg-black/30 z-[999]"
            onClick={handleCloseDrawer}
          />
        )}
        <div className="h-full">
          <ErrorBoundary message={t("office.aiPanelError", "AI助手加载失败")}>
            <OfficeChatPanel
              drawerMode={isDrawer}
              showBackdrop={false}
              onClose={handleCloseDrawer}
              onSendMessage={handleSendMessage}
            />
          </ErrorBoundary>
        </div>
      </div>
    );
  };

  return (
    <div
      ref={containerRef}
      className="h-full w-full min-h-0 overflow-hidden bg-white dark:bg-gray-950 relative"
    >
      <div
        className="h-full w-full grid"
        style={{
          gridTemplateColumns: gridColumns,
          gridTemplateRows: "100%",
          transition: "grid-template-columns 0.3s ease",
        }}
        role="application"
        aria-label={t("office.title", "办公")}
      >
        {/* 左栏：功能区 */}
        <ErrorBoundary message={t("office.leftPanelError", "功能区加载失败")}>
          <LeftPanel />
        </ErrorBoundary>

        {/* 中栏：预览区 */}
        <ErrorBoundary message={t("office.previewError", "预览区加载失败")}>
          <CenterPanel />
        </ErrorBoundary>

        {/* 右栏：AI 辅助（内联模式占据 Grid 第三列） */}
        {rightPanelVisible && rightPanelMode === "inline" && renderRightPanel()}
      </div>

      {/* 右栏：抽屉模式 — 覆盖在 OfficePage 上方，不脱离文档 */}
      {rightPanelVisible && rightPanelMode === "drawer" && renderRightPanel()}

      {/* 右栏已收缩：显示展开按钮（absolute 定位于容器右边缘） */}
      {userCollapsed && responsiveMode !== "hidden" && (
        <button
          onClick={() => useOfficeStore.getState().toggleRightPanel()}
          className="absolute right-0 top-1/2 -translate-y-1/2 
            w-5 h-10 bg-gray-200 dark:bg-gray-700 border border-gray-300 
            dark:border-gray-600 rounded-l-md flex items-center justify-center
            hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors z-20
            shadow-sm"
          title="展开AI面板"
        >
          <svg
            className="w-3 h-3 text-gray-500 dark:text-gray-400"
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <path
              d="M5.5 3L10.5 8l-5 5"
              stroke="currentColor"
              strokeWidth="2"
              fill="none"
            />
          </svg>
        </button>
      )}
    </div>
  );
}
