/** Turns a block time (unix seconds) into the labels the activity list uses. */
export function describeWhen(blockTime: number | null, now: Date = new Date()): { when: string; daysAgo: number } {
  if (blockTime === null) return { when: "Just now", daysAgo: 0 };
  const date = new Date(blockTime * 1000);
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const daysAgo = Math.max(0, Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000));
  const clock = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const day =
    daysAgo === 0
      ? "Today"
      : daysAgo === 1
        ? "Yesterday"
        : daysAgo < 7
          ? `${daysAgo} days ago`
          : date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return { when: `${day}, ${clock}`, daysAgo };
}
