export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const randInt = (min: number, max: number) => Math.floor(min + Math.random() * (Math.max(max, min) - min + 1));

export const round = (n: number, decimals = 2) => {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
};

export const decimalsOf = (step: number) => {
  const s = step.toString();
  if (s.includes('e-')) return Number(s.split('e-')[1]);
  return s.includes('.') ? s.split('.')[1].length : 0;
};

/** Floors a volume to the broker's volume step (avoids float artefacts). */
export const floorToStep = (value: number, step: number) => {
  if (step <= 0) return value;
  const floored = Math.floor(value / step + 1e-9) * step;
  return round(floored, decimalsOf(step));
};

/** YYYY-MM-DD for the given IANA timezone. */
export const dayKey = (date: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

/** Start of the current trading day (in tz) as a Date. */
export const startOfDay = (date: Date, timeZone: string) => {
  const key = dayKey(date, timeZone);
  // Find offset of tz at that moment.
  const tzDate = new Date(date.toLocaleString('en-US', { timeZone }));
  const offsetMs = tzDate.getTime() - date.getTime();
  return new Date(new Date(`${key}T00:00:00Z`).getTime() - offsetMs);
};

export async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, rej) => {
        t = setTimeout(() => rej(new Error(`Timeout after ${ms}ms: ${label}`)), ms);
      }),
    ]);
  } finally {
    if (t) clearTimeout(t);
  }
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e));
