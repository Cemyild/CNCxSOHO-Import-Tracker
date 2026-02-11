import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

interface BrandedSkeletonLoaderProps {
  variant?: 'table' | 'card' | 'header' | 'dashboard';
  rows?: number;
  className?: string;
}

export function BrandedSkeletonLoader({ 
  variant = 'table', 
  rows = 5, 
  className 
}: BrandedSkeletonLoaderProps) {
  
  if (variant === 'table') {
    return (
      <div className={cn("space-y-4", className)}>
        {/* Table Header Skeleton */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Skeleton className="h-8 w-32 bg-gradient-to-r from-slate-200 via-slate-300 to-slate-200" />
            <Skeleton className="h-8 w-24 bg-gradient-to-r from-slate-200 via-slate-300 to-slate-200" />
          </div>
          <Skeleton className="h-8 w-28 bg-gradient-to-r from-blue-200 via-blue-300 to-blue-200" />
        </div>
        
        {/* Table Content Skeleton */}
        <div className="rounded-lg border">
          <div className="border-b bg-muted/40 p-4">
            <div className="flex items-center space-x-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton 
                  key={i} 
                  className={cn(
                    "h-4",
                    i === 0 ? "w-24" : i === 1 ? "w-32" : i === 2 ? "w-28" : "w-20",
                    "bg-gradient-to-r from-slate-200 via-slate-300 to-slate-200"
                  )} 
                />
              ))}
            </div>
          </div>
          
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="border-b p-4 last:border-b-0">
              <div className="flex items-center space-x-4">
                <Skeleton className="h-5 w-24 bg-gradient-to-r from-slate-200 via-slate-300 to-slate-200" />
                <Skeleton className="h-5 w-32 bg-gradient-to-r from-slate-200 via-slate-300 to-slate-200" />
                <Skeleton className="h-5 w-28 bg-gradient-to-r from-green-200 via-green-300 to-green-200" />
                <Skeleton className="h-5 w-20 bg-gradient-to-r from-blue-200 via-blue-300 to-blue-200" />
                <Skeleton className="h-5 w-16 bg-gradient-to-r from-slate-200 via-slate-300 to-slate-200" />
                <Skeleton className="h-8 w-8 rounded-full bg-gradient-to-r from-slate-200 via-slate-300 to-slate-200" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  
  if (variant === 'card') {
    return (
      <div className={cn("space-y-4", className)}>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="rounded-lg border p-6 space-y-4">
            <div className="flex items-center justify-between">
              <Skeleton className="h-6 w-48 bg-gradient-to-r from-slate-200 via-slate-300 to-slate-200" />
              <Skeleton className="h-6 w-20 bg-gradient-to-r from-blue-200 via-blue-300 to-blue-200" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-full bg-gradient-to-r from-slate-200 via-slate-300 to-slate-200" />
              <Skeleton className="h-4 w-3/4 bg-gradient-to-r from-slate-200 via-slate-300 to-slate-200" />
            </div>
            <div className="flex items-center space-x-4 pt-2">
              <Skeleton className="h-8 w-24 bg-gradient-to-r from-green-200 via-green-300 to-green-200" />
              <Skeleton className="h-8 w-24 bg-gradient-to-r from-blue-200 via-blue-300 to-blue-200" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  
  if (variant === 'header') {
    return (
      <div className={cn("space-y-4", className)}>
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-8 w-64 bg-gradient-to-r from-slate-200 via-slate-300 to-slate-200" />
            <Skeleton className="h-4 w-96 bg-gradient-to-r from-slate-200 via-slate-300 to-slate-200" />
          </div>
          <Skeleton className="h-10 w-32 bg-gradient-to-r from-blue-200 via-blue-300 to-blue-200" />
        </div>
      </div>
    );
  }
  
  if (variant === 'dashboard') {
    return (
      <div className={cn("grid gap-4 md:grid-cols-2 lg:grid-cols-4", className)}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border p-6 space-y-4">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-32 bg-gradient-to-r from-slate-200 via-slate-300 to-slate-200" />
              <Skeleton className="h-6 w-6 bg-gradient-to-r from-blue-200 via-blue-300 to-blue-200" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-8 w-24 bg-gradient-to-r from-green-200 via-green-300 to-green-200" />
              <Skeleton className="h-4 w-16 bg-gradient-to-r from-slate-200 via-slate-300 to-slate-200" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  
  return null;
}

export function PaymentTableSkeleton() {
  return <BrandedSkeletonLoader variant="table" rows={8} />;
}

export function ExpenseCardSkeleton() {
  return <BrandedSkeletonLoader variant="card" rows={3} />;
}

export function DashboardSkeleton() {
  return <BrandedSkeletonLoader variant="dashboard" />;
}

export function PageHeaderSkeleton() {
  return <BrandedSkeletonLoader variant="header" />;
}