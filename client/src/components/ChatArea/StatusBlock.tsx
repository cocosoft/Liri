import React, { useState, useRef, useEffect } from "react";
import { STYLES } from "../../styles/animations";

interface StatusBlockProps {
  content: string;
  isStreaming?: boolean;
}

function StatusBlock({ content, isStreaming }: StatusBlockProps) {
  const [collapsed, setCollapsed] = useState(!isStreaming);
  const prevStreaming = useRef(isStreaming);

  useEffect(() => {
    const wasStreaming = prevStreaming.current;
    prevStreaming.current = isStreaming;

    if (wasStreaming && !isStreaming) {
      setCollapsed(true);
    }
  }, [isStreaming]);

  const isRunning = content.includes("Running");
  const isToolStatus =
    content.includes("Running tool") ||
    (content.includes("Tool ") &&
      (content.includes("completed") || content.includes("失败")));

  return (
    <div style={styles.container}>
      <button onClick={() => setCollapsed(!collapsed)} style={styles.header}>
        <span style={styles.icon}>
          {isRunning ? (
            <span style={styles.dot}></span>
          ) : isToolStatus ? (
            "📦"
          ) : (
            "⚪"
          )}
        </span>
        <span
          style={{
            ...styles.text,
            color: isRunning ? "#e6c384" : "#7aa2f7",
            fontStyle: isRunning ? "italic" : "normal",
          }}
        >
          {content}
        </span>
        <span style={styles.toggle}>{collapsed ? "▶" : "▼"}</span>
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    marginBottom: "3px",
    border: "1px solid rgba(128, 128, 128, 0.15)",
    borderRadius: "6px",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "3px 10px",
    background: "rgba(128, 128, 128, 0.04)",
    border: "none",
    width: "100%",
    cursor: "pointer",
    textAlign: "left",
    fontFamily: "inherit",
    fontSize: "11px",
  },
  icon: {
    fontSize: "10px",
    color: "#565f89",
    flexShrink: 0,
  },
  dot: {
    display: "inline-block",
    width: "6px",
    height: "6px",
    borderRadius: "50%",
    background: "#e6c384",
    ...STYLES.pulseDot,
  },
  text: {
    flex: 1,
    textAlign: "left",
  },
  toggle: {
    fontSize: "10px",
    color: "#565f89",
    flexShrink: 0,
  },
};

export default StatusBlock;
