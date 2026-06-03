import { useVoiceStore } from "../stores/voiceStore";

interface VoiceSessionIndicatorProps {
  isDark: boolean;
}

function VoiceSessionIndicator({ isDark }: VoiceSessionIndicatorProps) {
  const { isRecording, isProcessing, isPlaying, audioLevel } = useVoiceStore();

  const getStatus = () => {
    if (isRecording)
      return {
        label: "录音中",
        color: "text-red-500",
        bgColor: isDark ? "bg-red-900/30" : "bg-red-50",
      };
    if (isProcessing)
      return {
        label: "处理中",
        color: "text-yellow-500",
        bgColor: isDark ? "bg-yellow-900/30" : "bg-yellow-50",
      };
    if (isPlaying)
      return {
        label: "播放中",
        color: "text-blue-500",
        bgColor: isDark ? "bg-blue-900/30" : "bg-blue-50",
      };
    return null;
  };

  const status = getStatus();

  if (!status) return null;

  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${status.bgColor}`}
    >
      {isRecording && (
        <div className="flex items-end gap-0.5 h-4">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="w-1 bg-red-500 rounded-full animate-pulse"
              style={{
                height: `${Math.max(20, audioLevel * (0.3 + i * 0.2))}%`,
                animationDelay: `${i * 0.1}s`,
              }}
            />
          ))}
        </div>
      )}

      {isProcessing && (
        <svg
          className="w-4 h-4 animate-spin text-yellow-500"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      )}

      {isPlaying && (
        <svg
          className="w-4 h-4 text-blue-500 animate-pulse"
          fill="currentColor"
          viewBox="0 0 24 24"
        >
          <path d="M8 5v14l11-7z" />
        </svg>
      )}

      <span className={`text-sm font-medium ${status.color}`}>
        {status.label}
      </span>
    </div>
  );
}

export default VoiceSessionIndicator;
