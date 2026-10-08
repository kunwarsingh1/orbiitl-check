export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Simple per-host throttle: ensures at least `delayMs` passes between
 * requests that go through the same throttle instance. One instance is
 * shared across all probes to a given target so we never hammer it.
 */
export class Throttle {
  private lastAt = 0;
  constructor(private readonly delayMs: number) {}

  async wait(): Promise<void> {
    if (this.delayMs <= 0) return;
    const now = Date.now();
    const elapsed = now - this.lastAt;
    const remaining = this.delayMs - elapsed;
    if (remaining > 0) {
      await sleep(remaining);
    }
    this.lastAt = Date.now();
  }
}

export class RequestBudgetExceededError extends Error {
  constructor(max: number) {
    super(`Request budget exceeded (max ${max}). Increase --max-requests to scan more.`);
    this.name = "RequestBudgetExceededError";
  }
}
