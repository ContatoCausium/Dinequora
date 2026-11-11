/**
 * Serializes reloads of a live screen (the kitchen board).
 *
 * - At most one run at a time, so an older response can never land after a newer one.
 * - Requests that arrive while a run is in progress (or while one is scheduled) collapse into ONE
 *   follow-up run: a burst of realtime events costs a single reload, and the last event is always
 *   reflected because the follow-up starts after it.
 * - `request()` waits `delayMs` to gather a burst; `now()` runs as soon as possible. Both resolve
 *   once a run that started after the call has finished (callers can await fresh data).
 * - Stall deadline (`timeoutMs`, 20 s by default): a run that receives NO answer for that long is
 *   abandoned — its AbortSignal fires, `onTimeout` is called, waiters are released and the next run
 *   can start. The task calls `progress()` whenever a request answers (e.g. each page of a long
 *   read), which restarts the 20 s, so a large board that keeps receiving pages loads completely
 *   while a stalled request is still cut. The task must not apply its result when the signal is
 *   aborted, so a late response never overwrites newer data.
 * - `stop()` (screen closed, store changed) is final: it aborts the running task's signal, clears
 *   that run's stall deadline (so `onTimeout` never fires after it), releases every waiter at once
 *   (a button awaiting fresh data is never left pending by an unmounted screen) and cancels
 *   anything scheduled. Later `request()`/`now()` calls resolve immediately without running, and
 *   a late answer of the stopped run is ignored and never arms a follow-up. To restart (e.g. for a
 *   new store), create a new scheduler.
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
  task: (signal: AbortSignal, progress: () => void) => Promise<void>,
  options: RefreshSchedulerOptions | number = {},
): RefreshScheduler {
  const opts = typeof options === "number" ? { delayMs: options } : options;
  const delayMs = opts.delayMs ?? 250;
  const timeoutMs = opts.timeoutMs ?? REFRESH_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let stopped = false;
  let current: AbortController | null = null;
  let settleCurrent: (() => void) | null = null; // ends the run in progress (stop())
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
      if (settleCurrent === finish) settleCurrent = null;
      running = false;
      for (const resolve of serving) resolve();
      if (waiting.length > 0 && !stopped) arm(0);
    };
    settleCurrent = finish;
    const expire = () => {
      if (settled) return;
      controller.abort();
      opts.onTimeout?.();
      finish();
    };
    let deadline = setTimeout(expire, timeoutMs);
    const progress = () => {
      if (settled || controller.signal.aborted) return;
      clearTimeout(deadline);
      deadline = setTimeout(expire, timeoutMs);
    };
    void Promise.resolve()
      .then(() => task(controller.signal, progress))
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
      if (timer !== null) clearTimeout(timer);
      timer = null;
      const pending = waiting;
      waiting = [];
      // The run in progress: abort its signal (the task ignores its late answer), clear its stall
      // deadline and settle it now, which releases its waiters. Its own completion is then a no-op.
      current?.abort();
      settleCurrent?.();
      for (const resolve of pending) resolve();
    },
  };
}
