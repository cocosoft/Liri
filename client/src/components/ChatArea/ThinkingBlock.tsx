import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

interface ThinkingBlockProps {
  content: string;
  isStreaming?: boolean;
}

function ThinkingBlock({ content, isStreaming }: ThinkingBlockProps) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(true);
  const prevStreaming = useRef(isStreaming);

  useEffect(() => {
    if (isStreaming && content) {
      setCollapsed(false);
      return;
    }

    const wasStreaming = prevStreaming.current;
    if (wasStreaming && !isStreaming) {
      setCollapsed(true);
    }
  }, [isStreaming, content]);

  useEffect(() => {
    prevStreaming.current = isStreaming;
  });

  return (
    <div style={styles.container}>
      {/* P1-12（2026-09-27 审计）：原内联 hex 颜色为暗色专用（light 不可读）
          ⇒ 颜色移交 Tailwind 类（light 基础 + dark: 变体），内联样式只留布局 */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        style={styles.header}
        // P2-5（2026-09-27 审计）：补 aria-expanded（折叠语义对读屏/键盘可达）
        aria-expanded={!collapsed}
        className="text-gray-600 dark:text-[#a9b1d6]"
      >
        <span style={styles.spinner}>{isStreaming ? "⏳" : "💭"}</span>
        <span
          style={styles.title}
          className="text-amber-700 dark:text-[#c0b88a]"
        >
          {isStreaming ? t("chat.thinking") : t("chat.thoughtProcess")}
        </span>
        <span style={styles.toggle}>{collapsed ? "▶" : "▼"}</span>
      </button>
      {!collapsed && content && (
        <div style={styles.content}>
          {/* 修复：流式时原 maxHeight:none 导致超长思考无限撑高页面，
              统一沿用 styles.pre 的 300px 上限 + 纵向滚动 */}
          <pre style={styles.pre} className="text-gray-800 dark:text-[#c0b88a]">
            {content}
          </pre>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    border: "1px solid rgba(128, 128, 128, 0.2)",
    borderRadius: "8px",
    overflow: "hidden",
    marginBottom: "6px",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "6px 10px",
    background: "rgba(128, 128, 128, 0.05)",
    border: "none",
    width: "100%",
    cursor: "pointer",
    fontSize: "12px",
    textAlign: "left",
    fontFamily: "inherit",
  },
  spinner: {
    fontSize: "13px",
    flexShrink: 0,
  },
  title: {
    flex: 1,
    fontWeight: 500,
  },
  toggle: {
    fontSize: "10px",
    flexShrink: 0,
  },
  content: {
    padding: "6px 10px",
    background: "rgba(128, 128, 128, 0.03)",
    borderTop: "1px solid rgba(128, 128, 128, 0.1)",
  },
  pre: {
    margin: 0,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    fontSize: "13px",
    lineHeight: "1.6",
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    maxHeight: "300px",
    overflowY: "auto",
  },
};

export default ThinkingBlock;
