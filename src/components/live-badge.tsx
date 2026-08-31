import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AirStatus } from "@/lib/types";

export function LiveBadge({ status, className }: { status: AirStatus; className?: string }) {
  if (status === "live") {
    return (
      <Badge variant="live" className={cn("uppercase tracking-[0.14em]", className)}>
        <span className="tally-dot size-1.5 rounded-full bg-accent-fg" />
        On air
      </Badge>
    );
  }
  if (status === "aired") {
    return (
      <Badge variant="outline" className={className}>
        Aired
      </Badge>
    );
  }
  return (
    <Badge variant="cream" className={className}>
      Upcoming
    </Badge>
  );
}
