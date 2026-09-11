export interface ClassCountdownDisplay {
  caption: "Starts in" | "Status";
  label: string;
}

export function getClassCountdownDisplay(
  targetDate: Date,
  durationMinutes: number | null | undefined,
  now: Date = new Date(),
): ClassCountdownDisplay {
  const diff = targetDate.getTime() - now.getTime();
  const hasDuration =
    typeof durationMinutes === "number" && durationMinutes > 0;
  const endTime =
    targetDate.getTime() + (hasDuration ? durationMinutes : 0) * 60 * 1000;

  if (diff <= 0) {
    if (hasDuration && now.getTime() >= endTime) {
      return { caption: "Status", label: "Ended" };
    }
    return { caption: "Status", label: "In progress" };
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (days > 0) return { caption: "Starts in", label: `${days}d ${hours}h` };
  if (hours > 0) return { caption: "Starts in", label: `${hours}h ${minutes}m` };
  if (minutes > 0) return { caption: "Starts in", label: `${minutes}m` };
  return { caption: "Starts in", label: "Starting soon!" };
}