import React from "react";
import { STYLES } from "../../styles/animations";
import { isInternalTransitionStatus } from "../../stores/chat/chat-toolcall.slice";

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
  // 内部过渡状态（AI is thinking 等）→ 不渲染；空 content 无信息价值同样跳过。
  // 覆盖回放/历史数据路径（消息直接来自后端 blocks，不经过流式派生过滤）。
  if (!content.trim() || isInternalTransitionStatus(content, status)) {
    return null;
  }
  // P3-6：折叠功能为死代码（无内容区随 collapsed 隐藏），已移除 collapsed state/箭头/button
  const isRunning = status === "running";
  const isToolStatus = status === "completed" || status === "failed";
  // 压缩进行中：脉冲动画 + 强调色（类似工具调用的运行态）
  const isCompacting =
    status === "compaction" && phase === "compacting" && isStreaming;
  // 压缩完成：静态图标
  const isCompactionDone = status === "compaction" && phase === "done";

  const icon =
    isRunning || isCompacting ? (
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
      <div style={styles.header}>
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
      </div>
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
    width: "100%",
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
};

export default StatusBlock;
