import { useMemo } from "react";

interface DisplayVideo {
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

/** 视频预览组件：直接播放视频，支持 controls */
function VideoDisplayResult({ data }: Props) {
  const videos = useMemo(() => {
    const innerData = (data.data as Record<string, unknown>) ?? data;
    return (innerData.videos as DisplayVideo[]) || [];
  }, [data]);

  if (videos.length === 0) {
    return <div className="text-gray-400 text-sm">无视频可显示</div>;
  }

  return (
    <div className="flex flex-col gap-3 my-2">
      {videos.map((video, idx) => (
        <div key={idx} className="rounded-lg overflow-hidden border border-gray-700 bg-gray-900">
          {/* 视频信息栏 */}
          <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800 text-gray-400 text-xs">
            <span className="truncate max-w-[70%]" title={video.name}>
              {video.name}
            </span>
            {video.size && (
              <span className="text-gray-500">{formatSize(video.size)}</span>
            )}
          </div>

          {/* 视频播放器 */}
          <video
            src={video.url}
            controls
            className="w-full max-h-[480px]"
            style={{ background: "#000" }}
            preload="metadata"
          >
            <track kind="captions" />
          </video>
        </div>
      ))}
    </div>
  );
}

export default VideoDisplayResult;