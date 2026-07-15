/**
 * VideoPlayer — 自定义视频播放器（Phase 5）
 *
 * 增强原生 <video> 控件，增加：
 *   - 倍速控制（0.5x / 1x / 1.5x / 2x）
 *   - 画中画（Picture-in-Picture）
 *   - 全屏切换
 *   - 截图帧（下载当前帧为图片）
 *   - 视频元数据读取（分辨率、时长）
 */

import { useRef, useState, useCallback, useEffect } from "react";

export interface VideoMeta {
  width: number;
  height: number;
  duration: number;
}

interface Props {
  src: string;
  className?: string;
  /** 元数据加载完成回调 */
  onMetaLoaded?: (meta: VideoMeta) => void;
}

export default function VideoPlayer({ src, className, onMetaLoaded }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [isPiP, setIsPiP] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // 元数据加载
  const handleLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setDuration(video.duration);
    onMetaLoaded?.({
      width: video.videoWidth,
      height: video.videoHeight,
      duration: video.duration,
    });
  }, [onMetaLoaded]);

  // 时间更新
  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setCurrentTime(video.currentTime);
  }, []);

  // 播放/暂停
  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play();
      setPlaying(true);
    } else {
      video.pause();
      setPlaying(false);
    }
  }, []);

  // 进度条跳转
  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;
    const t = Number(e.target.value);
    video.currentTime = t;
    setCurrentTime(t);
  }, []);

  // 倍速切换
  const cycleSpeed = useCallback(() => {
    const speeds = [0.5, 1, 1.5, 2];
    const nextIdx = (speeds.indexOf(speed) + 1) % speeds.length;
    const nextSpeed = speeds[nextIdx];
    if (videoRef.current) videoRef.current.playbackRate = nextSpeed;
    setSpeed(nextSpeed);
  }, [speed]);

  // 画中画
  const togglePiP = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        setIsPiP(false);
      } else {
        await video.requestPictureInPicture();
        setIsPiP(true);
      }
    } catch {
      // 浏览器不支持 PiP
    }
  }, []);

  // 监听 PiP 退出
  useEffect(() => {
    const handler = () => {
      if (!document.pictureInPictureElement) setIsPiP(false);
    };
    document.addEventListener("leavepictureinpicture", handler);
    return () => document.removeEventListener("leavepictureinpicture", handler);
  }, []);

  // 全屏
  const toggleFullscreen = useCallback(async () => {
    const container = containerRef.current;
    if (!container) return;

    if (document.fullscreenElement) {
      await document.exitFullscreen();
      setIsFullscreen(false);
    } else {
      await container.requestFullscreen();
      setIsFullscreen(true);
    }
  }, []);

  // 监听全屏退出
  useEffect(() => {
    const handler = () => {
      if (!document.fullscreenElement) setIsFullscreen(false);
    };
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  // 截图帧
  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0);
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `frame_${Date.now()}.png`;
    a.click();
  }, []);

  // 格式化时间
  const fmtTime = (t: number) => {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  // 进度百分比
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden rounded-lg bg-black ${className || ""}`}
    >
      <video
        ref={videoRef}
        src={src}
        className="w-full"
        preload="metadata"
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onClick={togglePlay}
      />

      {/* 自定义控件栏 */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5">
        {/* 进度条 */}
        <input
          type="range"
          min="0"
          max={duration || 1}
          step="0.1"
          value={currentTime}
          onChange={handleSeek}
          className="mb-1 h-1 w-full cursor-pointer accent-white"
          style={{
            background: `linear-gradient(to right, white ${progress}%, rgba(255,255,255,0.3) ${progress}%)`,
          }}
        />

        {/* 控件按钮 */}
        <div className="flex items-center gap-2">
          {/* 播放/暂停 */}
          <button
            onClick={togglePlay}
            className="text-white/80 hover:text-white text-xs bg-transparent border-0 cursor-pointer"
          >
            {playing ? "⏸" : "▶"}
          </button>

          {/* 时间 */}
          <span className="text-white/60 text-[10px] min-w-[4em]">
            {fmtTime(currentTime)} / {fmtTime(duration)}
          </span>

          <div className="flex-1" />

          {/* 倍速 */}
          <button
            onClick={cycleSpeed}
            className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/80 hover:bg-white/20 cursor-pointer"
            title="切换倍速"
          >
            {speed}x
          </button>

          {/* 画中画 */}
          <button
            onClick={togglePiP}
            className={`text-[10px] bg-transparent border-0 cursor-pointer ${
              isPiP ? "text-blue-400" : "text-white/60 hover:text-white"
            }`}
            title="画中画"
          >
            ▣
          </button>

          {/* 截图帧 */}
          <button
            onClick={captureFrame}
            className="text-white/60 hover:text-white text-[10px] bg-transparent border-0 cursor-pointer"
            title="截图帧"
          >
            📷
          </button>

          {/* 全屏 */}
          <button
            onClick={toggleFullscreen}
            className="text-white/60 hover:text-white text-[10px] bg-transparent border-0 cursor-pointer"
            title="全屏"
          >
            {isFullscreen ? "⤓" : "⤢"}
          </button>
        </div>
      </div>
    </div>
  );
}