interface SkeletonProps {
  className?: string;
  count?: number;
}

function SkeletonPulse({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse bg-gray-200 dark:bg-gray-700 rounded ${className}`}
    />
  );
}

function SkeletonText({
  lines = 3,
  className = "",
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonPulse
          key={i}
          className={`h-3 ${i === lines - 1 ? "w-3/4" : "w-full"}`}
        />
      ))}
    </div>
  );
}

function SkeletonCard({ count = 1 }: SkeletonProps) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg space-y-3"
        >
          <SkeletonPulse className="h-4 w-1/3" />
          <SkeletonText lines={2} />
        </div>
      ))}
    </>
  );
}

function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      <div className="flex gap-4 px-4 py-2">
        <SkeletonPulse className="h-3 w-1/2" />
        <SkeletonPulse className="h-3 w-16" />
        <SkeletonPulse className="h-3 w-24" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex gap-4 px-4 py-3 border-t border-gray-100 dark:border-gray-700/50"
        >
          <SkeletonPulse className="h-4 w-1/2" />
          <SkeletonPulse className="h-4 w-16" />
          <SkeletonPulse className="h-4 w-24" />
        </div>
      ))}
    </div>
  );
}

/**
 * 消息气泡骨架屏：模拟聊天消息的加载状态
 */
function SkeletonMessageList({ count = 3 }: SkeletonProps) {
  const layouts = [
    { align: "justify-start", bg: "bg-gray-100 dark:bg-gray-800", width: "w-3/4" },
    { align: "justify-end", bg: "bg-blue-100 dark:bg-blue-900/30", width: "w-2/3" },
    { align: "justify-start", bg: "bg-gray-100 dark:bg-gray-800", width: "w-4/5" },
  ];

  return (
    <div className="space-y-4 p-4">
      {Array.from({ length: count }).map((_, i) => {
        const layout = layouts[i % layouts.length];
        return (
          <div key={i} className={`flex ${layout.align}`}>
            <div className={`${layout.width} p-3 rounded-lg space-y-2 ${layout.bg}`}>
              <SkeletonPulse className={`h-3 ${i % 2 === 0 ? "w-1/3" : "w-1/4"}`} />
              <SkeletonPulse className="h-3 w-full" />
              {i % 2 === 0 && <SkeletonPulse className="h-3 w-2/3" />}
              <SkeletonPulse className="h-2 w-12 ml-auto" />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export { SkeletonPulse, SkeletonText, SkeletonCard, SkeletonTable, SkeletonMessageList };
