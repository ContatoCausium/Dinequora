/**
 * Serializes reloads of a live screen (the kitchen board).
 *
 * - At most one run at a time, so an older response can never land after a newer one.
 * - Requests that arrive while a run is in progress (or while one is scheduled) collapse into ONE
 *   follow-up run: a burst of realtime events costs a single reload, and the last event is always
 *   reflected because the follow-up starts after it.
 * - `request()` waits `delayMs` to gather a burst; `now()` runs as soon as possible. Both resolve
 *   once a run that started after the call has finished (callers can await fresh data).
 * - Every run has a deadline (`timeoutMs`, 20 s by default). A run that has not settled by then is
 *   abandoned: its AbortSignal fires, `onTimeout` is called, waiters are released and the next run
 *   can start. The task must not apply its result when the signal is aborted, so a late response
 *   never overwrites newer data.
 * - `stop()` (screen closed, store changed) aborts the running task's signal and cancels anything
 *   pending; nothing runs afterwards.
 *
 * The task reports its own errors; a failed or abandoned run never blocks the next one.
 */
export interface RefreshScheduler {
  request(): Promise<void>;
  now(): Promise<void>;
  stop(): void;
}

export interface RefreshSchedulerOptions {
  delayMs?: number;
  timeoutMs?: number;
  onTimeout?: () => void;
}

export const REFRESH_TIMEOUT_MS = 20_000;

export function createRefreshScheduler(
  task: (signal: AbortSignal) => Promise<void>,
  options: RefreshSchedulerOptions | number = {},
): RefreshScheduler {
  const opts = typeof options === "number" ? { delayMs: options } : options;
  const delayMs = opts.delayMs ?? 250;
  const timeoutMs = opts.timeoutMs ?? REFRESH_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let stopped = false;
  let current: AbortController | null = null;
  let waiting: Array<() => void> = []; // served by the next run that starts

  const start = () => {
    timer = null;
    if (stopped || running) return;
    running = true;
    const serving = waiting;
    waiting = [];
    const controller = new AbortController();
    current = controller;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (current === controller) current = null;
      running = false;
      for (const resolve of serving) resolve();
      if (waiting.length > 0 && !stopped) arm(0);
    };
    const deadline = setTimeout(() => {
      if (settled) return;
      controller.abort();
      opts.onTimeout?.();
      finish();
    }, timeoutMs);
    void Promise.resolve()
      .then(() => task(controller.signal))
      .catch(() => undefined)
      .finally(finish);
  };

  const arm = (delay: number) => {
    if (timer === null && !running) timer = setTimeout(start, delay);
  };

  const enqueue = (delay: number) =>
    new Promise<void>((resolve) => {
      if (stopped) {
        resolve();
        return;
      }
      waiting.push(resolve);
      if (running) return; // the follow-up run (armed when this one ends) serves it
      if (delay === 0 && timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      arm(delay);
    });

  return {
    request: () => enqueue(delayMs),
    now: () => enqueue(0),
    stop: () => {
      stopped = true;
      current?.abort();
      if (timer !== null) clearTimeout(timer);
      timer = null;
      const pending = waiting;
      waiting = [];
      for (const resolve of pending) resolve();
    },
  };
}
