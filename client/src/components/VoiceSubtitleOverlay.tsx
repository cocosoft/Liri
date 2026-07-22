/**
 * 实时语音字幕覆盖组件
 *
 * 在聊天输入框上方显示语音识别的中间结果和最终结果，
 * 支持音频电平指示器和多位置模式。
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

interface VoiceSubtitleOverlayProps {
  /** 中间结果文本（实时更新，灰色/闪烁） */
  interimText: string;
  /** 最终确定文本（白色稳定） */
  finalText: string;
  /** 音频电平 0-100 */
  audioLevel: number;
  /** 字幕状态 */
  status: "idle" | "listening" | "processing" | "done";
  /** 是否为深色主题 */
  isDark: boolean;
  /** 显示位置 */
  position?: "bottom" | "top" | "floating";
  /** 最大显示行数 */
  maxLines?: number;
  /** 识别结束后自动隐藏超时（毫秒） */
  autoHideTimeout?: number;
  /** 是否允许点击展开历史 */
  onToggleHistory?: () => void;
}

export default function VoiceSubtitleOverlay({
  interimText,
  finalText,
  audioLevel,
  status,
  isDark,
  position = "bottom",
  maxLines = 2,
  autoHideTimeout = 3000,
  onToggleHistory,
}: VoiceSubtitleOverlayProps) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 当状态变化时控制显示/自动隐藏
  useEffect(() => {
    if (status === "listening" || status === "processing") {
      setVisible(true);
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    } else if (status === "done") {
      // 识别结束后延迟自动隐藏
      hideTimerRef.current = setTimeout(() => {
        setVisible(false);
      }, autoHideTimeout);
    } else {
      // idle
      setVisible(false);
    }

    return () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, [status, autoHideTimeout]);

  // 没有内容且 idle 时直接隐藏
  const hasContent = interimText.trim() || finalText.trim();
  if ((status === "idle" || !visible) && !hasContent) {
    return null;
  }

  const bgColor = isDark
    ? "rgba(30, 30, 30, 0.92)"
    : "rgba(255, 255, 255, 0.92)";
  const borderColor = isDark
    ? "rgba(255, 255, 255, 0.08)"
    : "rgba(0, 0, 0, 0.08)";
  const textColor = isDark ? "rgba(255, 255, 255, 0.9)" : "rgba(0, 0, 0, 0.85)";
  const interimColor = isDark
    ? "rgba(255, 255, 255, 0.45)"
    : "rgba(0, 0, 0, 0.4)";
  const accentColor = "#3b82f6";

  // 音频电平条宽度
  const levelBarWidth = Math.min(Math.max(audioLevel, 0), 100);

  // 位置样式
  const positionStyle: Record<string, React.CSSProperties> = {
    bottom: {
      position: "absolute",
      bottom: "100%",
      left: 0,
      right: 0,
      marginBottom: 4,
    },
    top: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
    },
    floating: {
      position: "fixed",
      bottom: 120,
      left: "50%",
      transform: "translateX(-50%)",
      maxWidth: 600,
      width: "90%",
      zIndex: 100,
    },
  };

  /** 状态文本 */
  const statusLabel: Record<string, string> = {
    idle: "",
    listening: t("voice.listening"),
    processing: t("voice.processing"),
    done: t("voice.speaking") + " " + t("common.success"),
  };

  return (
    <div
      style={{
        ...positionStyle[position],
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "8px 12px",
        borderRadius: 8,
        background: bgColor,
        border: `1px solid ${borderColor}`,
        backdropFilter: "blur(8px)",
        boxShadow: isDark
          ? "0 -2px 12px rgba(0,0,0,0.3)"
          : "0 -2px 12px rgba(0,0,0,0.08)",
        transition: "opacity 0.3s ease, transform 0.3s ease",
        opacity: visible || hasContent ? 1 : 0,
        transform: visible || hasContent ? "translateY(0)" : "translateY(8px)",
        pointerEvents: status === "listening" ? "auto" : "none",
        ...(position === "bottom" ? { marginLeft: 8, marginRight: 8 } : {}),
      }}
    >
      {/* 状态行：电平指示器 + 状态标签 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 2,
        }}
      >
        {/* 音频电平条 */}
        <div
          style={{
            width: 60,
            height: 4,
            borderRadius: 2,
            background: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)",
            overflow: "hidden",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: `${levelBarWidth}%`,
              height: "100%",
              borderRadius: 2,
              background:
                status === "listening"
                  ? `linear-gradient(90deg, ${accentColor}, #8b5cf6)`
                  : isDark
                    ? "rgba(255,255,255,0.3)"
                    : "rgba(0,0,0,0.2)",
              transition: "width 0.1s ease",
            }}
          />
        </div>

        {/* 状态标签 */}
        <span
          style={{
            fontSize: 11,
            color: interimColor,
            fontWeight: 500,
            letterSpacing: 0.3,
          }}
        >
          {statusLabel[status] || ""}
        </span>
      </div>

      {/* 字幕文本 */}
      <div
        style={{
          display: "-webkit-box",
          WebkitLineClamp: maxLines,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
          lineHeight: 1.5,
          minHeight: 20,
        }}
      >
        {/* 最终结果（稳定） */}
        {finalText && (
          <span
            style={{
              color: textColor,
              fontSize: 13,
              fontWeight: 500,
              marginRight: 4,
            }}
          >
            {finalText}
          </span>
        )}

        {/* 中间结果（闪烁灰色） */}
        {interimText && (
          <span
            style={{
              color: interimColor,
              fontSize: 13,
              fontStyle: "italic",
              animation: "none",
            }}
          >
            {interimText}
          </span>
        )}

        {/* 无文本时的占位 */}
        {!finalText && !interimText && status === "listening" && (
          <span
            style={{
              color: interimColor,
              fontSize: 13,
              fontStyle: "italic",
            }}
          >
            等待语音输入...
          </span>
        )}
      </div>

      {/* 历史记录入口 */}
      {onToggleHistory && (
        <button
          onClick={onToggleHistory}
          style={{
            fontSize: 11,
            color: accentColor,
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 0,
            textAlign: "left",
            marginTop: 2,
          }}
        >
          {t("voice.voiceHistory")}
        </button>
      )}
    </div>
  );
}
