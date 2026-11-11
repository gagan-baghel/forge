/**
 * 5-field cron (minute hour day-of-month month day-of-week), standard
 * semantics: `*`, `n`, `a-b`, `a,b`, `*​/n`, `a-b/n`, `a/n`; Sunday is 0 or 7;
 * when both day fields are restricted a day matches if EITHER does.
 */

interface Compiled {
  min: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  mon: Set<number>;
  dow: Set<number>;
  domAny: boolean;
  dowAny: boolean;
}

/** Parse one field; null when any part is malformed or out of range. */
function parseField(field: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>();
  const num = (s: string) => (/^\d+$/.test(s) ? Number(s) : NaN);
  for (const part of field.split(",")) {
    const [range, stepStr, extra] = part.split("/");
    if (extra !== undefined) return null;
    const step = stepStr === undefined ? 1 : num(stepStr);
    // A zero or negative step used to loop forever and freeze the app.
    if (!(step >= 1)) return null;

    let lo: number;
    let hi: number;
    if (range === "*") {
      [lo, hi] = [min, max];
    } else if (range.includes("-")) {
      const [a, b] = range.split("-");
      [lo, hi] = [num(a), num(b)];
    } else {
      lo = num(range);
      // `5/15` means "from 5, every 15", not just 5.
      hi = stepStr === undefined ? lo : max;
    }
    if (!(lo >= min && hi <= max && lo <= hi)) return null;
    for (let n = lo; n <= hi; n += step) out.add(n);
  }
  return out;
}

const cache = new Map<string, Compiled | null>();

function compile(cron: string): Compiled | null {
  const key = cron.trim();
  if (cache.has(key)) return cache.get(key)!;
  const fields = key.split(/\s+/);
  let result: Compiled | null = null;
  if (fields.length === 5) {
    const [min, hour, dom, mon, dowRaw] = [
      parseField(fields[0], 0, 59),
      parseField(fields[1], 0, 23),
      parseField(fields[2], 1, 31),
      parseField(fields[3], 1, 12),
      parseField(fields[4], 0, 7),
    ];
    if (min && hour && dom && mon && dowRaw) {
      const dow = new Set([...dowRaw].map((d) => (d === 7 ? 0 : d)));
      result = { min, hour, dom, mon, dow, domAny: fields[2] === "*", dowAny: fields[4] === "*" };
    }
  }
  cache.set(key, result);
  return result;
}

/** Is this a cron expression Forge can run? */
export function isValidCron(cron: string): boolean {
  return compile(cron) !== null;
}

/** Does `cron` fire at the given date (to the minute)? */
export function cronMatches(cron: string, date: Date): boolean {
  const c = compile(cron);
  if (!c) return false;
  if (!c.min.has(date.getMinutes()) || !c.hour.has(date.getHours()) || !c.mon.has(date.getMonth() + 1)) return false;
  const domHit = c.dom.has(date.getDate());
  const dowHit = c.dow.has(date.getDay());
  // Standard cron: two restricted day fields are OR'd, not AND'd.
  if (!c.domAny && !c.dowAny) return domHit || dowHit;
  return domHit && dowHit;
}

/** Next fire time within ~a year (Feb 29 schedules may find none). */
export function nextRun(cron: string, from: Date = new Date()): number | undefined {
  if (!compile(cron)) return undefined;
  const d = new Date(from.getTime());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  for (let i = 0; i < 60 * 24 * 366; i++) {
    if (cronMatches(cron, d)) return d.getTime();
    d.setMinutes(d.getMinutes() + 1);
  }
  return undefined;
}
