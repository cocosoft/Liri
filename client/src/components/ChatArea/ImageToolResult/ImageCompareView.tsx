/**
 * ImageCompareView — 并排图片对比组件
 *
 * 用于展示编辑前后、分析对比等场景的两图对比视图。
 */
import { useState } from 'react';

interface ImageCompareViewProps {
  /** 左侧图片（原图） */
  originalSrc: string;
  /** 左侧标签 */
  originalLabel?: string;
  /** 右侧图片（修改后） */
  modifiedSrc: string;
  /** 右侧标签 */
  modifiedLabel?: string;
  /** 容器宽度 */
  width?: number;
}

export function ImageCompareView({
  originalSrc,
  originalLabel = '原始',
  modifiedSrc,
  modifiedLabel = '修改后',
  width = 600,
}: ImageCompareViewProps) {
  const [sliderPos, setSliderPos] = useState(50);

  return (
    <div className="flex flex-col gap-2">
      {/* 对比模式切换 */}
      <div className="flex items-center gap-2 text-sm text-gray-400">
        <span>{originalLabel}</span>
        <span>vs</span>
        <span>{modifiedLabel}</span>
      </div>

      {/* 并排对比 */}
      <div className="flex gap-2 overflow-hidden rounded-lg border border-gray-700">
        <div className="flex-1">
          <img
            src={originalSrc}
            alt={originalLabel}
            className="w-full object-contain"
            style={{ maxHeight: 400 }}
          />
          <p className="text-center text-xs text-gray-500 py-1 bg-gray-900">
            {originalLabel}
          </p>
        </div>
        <div className="flex-1">
          <img
            src={modifiedSrc}
            alt={modifiedLabel}
            className="w-full object-contain"
            style={{ maxHeight: 400 }}
          />
          <p className="text-center text-xs text-gray-500 py-1 bg-gray-900">
            {modifiedLabel}
          </p>
        </div>
      </div>

      {/* 滑块对比模式 */}
      <div className="relative overflow-hidden rounded-lg border border-gray-700"
        style={{ width }}
      >
        <div className="relative" style={{ width }}>
          <img
            src={modifiedSrc}
            alt={modifiedLabel}
            className="w-full object-contain"
            style={{ maxHeight: 400 }}
          />
          <div
            className="absolute top-0 left-0 h-full overflow-hidden"
            style={{ width: `${sliderPos}%` }}
          >
            <img
              src={originalSrc}
              alt={originalLabel}
              className="w-full object-contain"
              style={{ width, maxHeight: 400 }}
            />
          </div>

          {/* 滑块分隔线 */}
          <div
            className="absolute top-0 h-full w-0.5 bg-white cursor-ew-resize"
            style={{ left: `${sliderPos}%` }}
          >
            <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-6 h-6 rounded-full bg-white border-2 border-gray-700 shadow-lg flex items-center justify-center text-xs text-gray-700">
              ⟷
            </div>
          </div>

          {/* 滑块拖拽区域 */}
          <input
            type="range"
            min={0}
            max={100}
            value={sliderPos}
            onChange={(e) => setSliderPos(Number(e.target.value))}
            className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize"
          />
        </div>

        <p className="text-center text-xs text-gray-500 py-1 bg-gray-900">
          拖动滑块对比 ← {originalLabel} | {modifiedLabel} →
        </p>
      </div>
    </div>
  );
}
