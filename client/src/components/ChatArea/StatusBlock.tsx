import React, { useState, useRef, useEffect } from "react";
import { STYLES } from "../../styles/animations";

interface StatusBlockProps {
  content: string;
  isStreaming?: boolean;
  /** 状态标记（用于图标判断，不依赖字符串匹配） */
  status?: string;
  /** 压缩状态阶段（status='compaction' 时存在）：compacting=进行中 / done=完成 */
  phase?: "compacting" | "done";
}

function StatusBlock({
  content,
  isStreaming,
  status,
  phase,
}: StatusBlockProps) {
  const [collapsed, setCollapsed] = useState(!isStreaming);
  const prevStreaming = useRef(isStreaming);

  useEffect(() => {
    const wasStreaming = prevStreaming.current;
    prevStreaming.current = isStreaming;

    if (wasStreaming && !isStreaming) {
      setCollapsed(true);
    }
  }, [isStreaming]);

  const isRunning = status === "running";
  const isToolStatus = status === "completed" || status === "failed";
  // 压缩进行中：脉冲动画 + 强调色（类似工具调用的运行态）
  const isCompacting =
    status === "compaction" && phase === "compacting" && isStreaming;
  // 压缩完成：静态图标
  const isCompactionDone = status === "compaction" && phase === "done";

  const icon = isRunning || isCompacting ? (
    <span style={styles.dot}></span>
  ) : isToolStatus ? (
    "📦"
  ) : isCompactionDone ? (
    "🗜️"
  ) : (
    "⚪"
  );

  return (
    <div style={styles.container}>
      <button onClick={() => setCollapsed(!collapsed)} style={styles.header}>
        <span style={styles.icon}>{icon}</span>
        <span
          style={{
            ...styles.text,
            color: isRunning || isCompacting ? "#e6c384" : "#7aa2f7",
            fontStyle: isRunning || isCompacting ? "italic" : "normal",
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
