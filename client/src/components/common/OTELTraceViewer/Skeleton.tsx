import { memo } from "react";

interface SkeletonProps {
  isDark?: boolean;
  rows?: number;
}

export const Skeleton = memo(function Skeleton({
  isDark,
  rows = 4,
}: SkeletonProps) {
  return (
    <div
      className={`rounded-lg border p-6 ${isDark ? "border-gray-700 bg-gray-800" : "border-gray-200 bg-white"}`}
    >
      <div className="animate-pulse space-y-4">
        {/* Stats bar */}
        <div
          className={`h-6 w-2/3 rounded ${isDark ? "bg-gray-700" : "bg-gray-200"}`}
        />
        {/* Filter bar */}
        <div
          className={`h-8 w-full rounded ${isDark ? "bg-gray-700" : "bg-gray-200"}`}
        />
        {/* Trace rows */}
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="space-y-2">
            <div
              className={`h-5 w-1/4 rounded ${isDark ? "bg-gray-700" : "bg-gray-200"}`}
            />
            <div
              className={`h-4 w-3/4 rounded ${isDark ? "bg-gray-700" : "bg-gray-200"}`}
            />
            <div
              className={`h-4 w-1/2 rounded ${isDark ? "bg-gray-700" : "bg-gray-200"}`}
            />
          </div>
        ))}
      </div>
    </div>
  );
});
