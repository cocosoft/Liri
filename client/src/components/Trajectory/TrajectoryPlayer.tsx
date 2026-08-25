// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * TrajectoryPlayer — 轨迹回放控制条（P6，2026-08-25）
 *
 * 纯前端播放器：按拍平行逐行播放（基于事件流，不新增数据源）。
 * - ▶ / ⏸ 播放暂停
 * - 速度 1x / 2x / 4x（播放间隔倍率）
 * - 进度条按行定位（拖动 seek）
 */

export interface TrajectoryPlayerProps {
  totalRows: number;
  playing: boolean;
  playbackSpeed: number;
  playbackIndex: number;
  onToggle: () => void;
  onSpeed: (speed: number) => void;
  onSeek: (index: number) => void;
}

const SPEEDS = [1, 2, 4];

export function TrajectoryPlayer({
  totalRows,
  playing,
  playbackSpeed,
  playbackIndex,
  onToggle,
  onSpeed,
  onSeek,
}: TrajectoryPlayerProps) {
  const progress =
    totalRows > 0 ? Math.round((playbackIndex / totalRows) * 100) : 0;

  return (
    <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50 flex items-center gap-3">
      <button
        onClick={onToggle}
        disabled={totalRows === 0}
        className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs transition-colors ${
          totalRows === 0
            ? "text-gray-300 dark:text-gray-600 cursor-not-allowed"
            : "text-white bg-blue-600 hover:bg-blue-700"
        }`}
        aria-label={playing ? "暂停" : "播放"}
        title={playing ? "暂停" : "播放"}
      >
        {playing ? "⏸" : "▶"}
      </button>

      <div className="flex items-center gap-1 shrink-0">
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => onSpeed(s)}
            className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${
              playbackSpeed === s
                ? "bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300"
                : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
            }`}
          >
            {s}x
          </button>
        ))}
      </div>

      <div className="flex-1 flex items-center gap-2 min-w-0">
        <input
          type="range"
          min={0}
          max={Math.max(0, totalRows - 1)}
          value={playbackIndex}
          onChange={(e) => onSeek(Number(e.target.value))}
          className="flex-1 accent-blue-600"
          aria-label="回放进度"
        />
        <span className="text-[10px] text-gray-400 dark:text-gray-500 shrink-0">
          {playbackIndex}/{totalRows} · {progress}%
        </span>
      </div>
    </div>
  );
}

export default TrajectoryPlayer;
