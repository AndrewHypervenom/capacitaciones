import { cn } from '@/lib/cn';

interface SkeletonProps {
  className?: string;
  rounded?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | 'full';
}

export function Skeleton({ className, rounded = 'lg' }: SkeletonProps) {
  const roundedMap = {
    sm: 'rounded-sm', md: 'rounded-md', lg: 'rounded-lg',
    xl: 'rounded-xl', '2xl': 'rounded-2xl', '3xl': 'rounded-3xl', full: 'rounded-full',
  };
  return (
    <div
      className={cn(
        'bg-glass-border/8 animate-pulse',
        roundedMap[rounded],
        className,
      )}
      aria-hidden
    />
  );
}

export function ModulePageSkeleton() {
  return (
    <div className="mx-auto max-w-5xl px-5 pt-10 pb-28 space-y-10">
      {/* Header */}
      <div className="space-y-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-12 w-3/4" rounded="2xl" />
        <Skeleton className="h-5 w-1/2" />
        <div className="grid sm:grid-cols-3 gap-3 mt-6">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16" rounded="2xl" />
          ))}
        </div>
      </div>
      {/* Divider */}
      <Skeleton className="h-px w-full" />
      {/* Sections */}
      <div className="space-y-16">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-5">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-8 w-2/3" rounded="xl" />
            <div className="space-y-2.5">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="mx-auto max-w-5xl px-5 pt-10 pb-20 space-y-8">
      <div className="space-y-3">
        <Skeleton className="h-9 w-56" rounded="2xl" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="grid sm:grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-32" rounded="3xl" />)}
      </div>
      <div className="space-y-3">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20" rounded="2xl" />)}
      </div>
    </div>
  );
}
