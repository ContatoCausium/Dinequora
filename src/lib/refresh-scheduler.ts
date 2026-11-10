/**
 * Serializes reloads of a live screen (the kitchen board).
 *
 * - At most one run at a time, so an older response can never land after a newer one.
 * - Requests that arrive while a run is in progress (or while one is scheduled) collapse into ONE
 *   follow-up run: a burst of realtime events costs a single reload, and the last event is always
 *   reflected because the follow-up starts after it.
 * - `request()` waits `delayMs` to gather a burst; `now()` runs as soon as possible. Both resolve
 *   once a run that started after the call has finished (callers can await fresh data).
 * - `stop()` cancels anything pending; nothing runs afterwards.
 *
 * The task reports its own errors; a failed run never blocks the next one.
 */
export interface RefreshScheduler {
  request(): Promise<void>;
  now(): Promise<void>;
  stop(): void;
}

export function createRefreshScheduler(task: () => Promise<void>, delayMs = 250): RefreshScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let stopped = false;
  let waiting: Array<() => void> = []; // served by the next run that starts

  const start = () => {
    timer = null;
    if (stopped || running) return;
    running = true;
    const serving = waiting;
    waiting = [];
    void Promise.resolve()
      .then(task)
      .catch(() => undefined)
      .finally(() => {
        running = false;
        for (const resolve of serving) resolve();
        if (waiting.length > 0 && !stopped) arm(0);
      });
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
      for (const resolve of pending) resolve();
    },
  };
}
