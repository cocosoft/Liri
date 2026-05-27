interface SkeletonProps {
  className?: string;
  count?: number;
}

function SkeletonPulse({ className = '' }: { className?: string }) {
  return (
    <div
      className={`animate-pulse bg-gray-200 dark:bg-gray-700 rounded ${className}`}
    />
  );
}

function SkeletonText({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonPulse
          key={i}
          className={`h-3 ${i === lines - 1 ? 'w-3/4' : 'w-full'}`}
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
        <div key={i} className="flex gap-4 px-4 py-3 border-t border-gray-100 dark:border-gray-700/50">
          <SkeletonPulse className="h-4 w-1/2" />
          <SkeletonPulse className="h-4 w-16" />
          <SkeletonPulse className="h-4 w-24" />
        </div>
      ))}
    </div>
  );
}

export { SkeletonPulse, SkeletonText, SkeletonCard, SkeletonTable };
