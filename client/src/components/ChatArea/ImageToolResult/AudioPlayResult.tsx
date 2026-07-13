import { useMemo } from "react";

interface DisplayAudio {
  url: string;
  name: string;
  size?: number;
  originalPath: string;
}

interface Props {
  data: Record<string, unknown>;
}

/** 格式化文件大小 */
function formatSize(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 音频播放组件：直接播放音频，支持 controls */
function AudioPlayResult({ data }: Props) {
  const audios = useMemo(() => {
    const innerData = (data.data as Record<string, unknown>) ?? data;
    return (innerData.audios as DisplayAudio[]) || [];
  }, [data]);

  if (audios.length === 0) {
    return <div className="text-gray-400 text-sm">无音频可播放</div>;
  }

  return (
    <div className="flex flex-col gap-2 my-2">
      {audios.map((audio, idx) => (
        <div key={idx} className="rounded-lg overflow-hidden border border-gray-700 bg-gray-900">
          {/* 音频信息栏 */}
          <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800 text-gray-400 text-xs">
            <span className="truncate max-w-[70%]" title={audio.name}>
              {audio.name}
            </span>
            {audio.size && (
              <span className="text-gray-500">{formatSize(audio.size)}</span>
            )}
          </div>

          {/* 音频播放器 */}
          <div className="px-3 py-2">
            <audio
              src={audio.url}
              controls
              className="w-full"
              preload="metadata"
            >
              <track kind="captions" />
            </audio>
          </div>
        </div>
      ))}
    </div>
  );
}

export default AudioPlayResult;