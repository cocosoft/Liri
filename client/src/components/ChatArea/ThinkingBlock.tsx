import React, { useState, useEffect, useRef } from "react";

interface ThinkingBlockProps {
  content: string;
  isStreaming?: boolean;
}

function ThinkingBlock({ content, isStreaming }: ThinkingBlockProps) {
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
      <button onClick={() => setCollapsed(!collapsed)} style={styles.header}>
        <span style={styles.spinner}>{isStreaming ? "⏳" : "💭"}</span>
        <span style={styles.title}>
          {isStreaming ? "Thinking..." : "Thought Process"}
        </span>
        <span style={styles.toggle}>{collapsed ? "▶" : "▼"}</span>
      </button>
      {!collapsed && content && (
        <div style={styles.content}>
          <pre style={styles.pre}>{content}</pre>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    border: "1px solid rgba(255, 193, 7, 0.3)",
    borderRadius: "8px",
    overflow: "hidden",
    marginBottom: "8px",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 12px",
    background: "rgba(255, 193, 7, 0.08)",
    border: "none",
    width: "100%",
    cursor: "pointer",
    color: "#e6c384",
    fontSize: "13px",
    textAlign: "left",
    fontFamily: "inherit",
  },
  spinner: {
    fontSize: "14px",
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
    padding: "8px 12px",
    background: "rgba(255, 193, 7, 0.03)",
    borderTop: "1px solid rgba(255, 193, 7, 0.15)",
  },
  pre: {
    margin: 0,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    fontSize: "13px",
    lineHeight: "1.6",
    color: "#c0b88a",
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    maxHeight: "300px",
    overflowY: "auto",
  },
};

export default ThinkingBlock;
