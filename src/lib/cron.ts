/**
 * Minimal 5-field cron matcher (minute hour day-of-month month day-of-week).
 * Supports `*`, `*​/n`, `a-b`, `a,b`, and `a-b/n`. Enough for routine schedules.
 */

function parseField(field: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    let step = 1;
    let range = part;
    const slash = part.indexOf("/");
    if (slash >= 0) {
      step = parseInt(part.slice(slash + 1), 10) || 1;
      range = part.slice(0, slash);
    }
    let lo = min;
    let hi = max;
    if (range !== "*") {
      const dash = range.indexOf("-");
      if (dash >= 0) {
        lo = parseInt(range.slice(0, dash), 10);
        hi = parseInt(range.slice(dash + 1), 10);
      } else {
        lo = hi = parseInt(range, 10);
      }
    }
    for (let n = lo; n <= hi; n += step) {
      if (n >= min && n <= max) out.add(n);
    }
  }
  return out;
}

/** Does `cron` fire at the given date (to the minute)? */
export function cronMatches(cron: string, date: Date): boolean {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const [min, hour, dom, mon, dow] = fields;
  return (
    parseField(min, 0, 59).has(date.getMinutes()) &&
    parseField(hour, 0, 23).has(date.getHours()) &&
    parseField(dom, 1, 31).has(date.getDate()) &&
    parseField(mon, 1, 12).has(date.getMonth() + 1) &&
    parseField(dow, 0, 6).has(date.getDay())
  );
}

/** Estimate the next fire time within the next ~14 days (for display). */
export function nextRun(cron: string, from: Date = new Date()): number | undefined {
  const d = new Date(from.getTime());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  for (let i = 0; i < 60 * 24 * 14; i++) {
    if (cronMatches(cron, d)) return d.getTime();
    d.setMinutes(d.getMinutes() + 1);
  }
  return undefined;
}
