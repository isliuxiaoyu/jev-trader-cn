/** China has no daylight saving. Shanghai is fixed at UTC+8. */

export function shanghaiTs(year: number, month: number, day: number, hour: number, minute: number, second = 0): number {
  return Date.UTC(year, month - 1, day, hour - 8, minute, second);
}

export function shanghaiParts(ts: number): { year: number; month: number; day: number; minutes: number; weekday: number; dateKey: string } {
  const d = new Date(ts + 8 * 3_600_000);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  const weekday = d.getUTCDay();
  const dateKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { year, month, day, minutes, weekday, dateKey };
}

/** Continuous auction only: 09:30-11:30 and 13:00-15:00, weekdays. */
export function inContinuousSession(ts: number): boolean {
  const p = shanghaiParts(ts);
  if (p.weekday === 0 || p.weekday === 6) return false;
  const m = p.minutes;
  return (m >= 9 * 60 + 30 && m < 11 * 60 + 30) || (m >= 13 * 60 && m < 15 * 60);
}

export function roundPx(n: number): number {
  return Math.round(n * 100) / 100;
}
