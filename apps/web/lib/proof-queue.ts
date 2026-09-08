type Job = { priority: number; run: () => Promise<void> };
export class ProofQueue {
  private jobs: Job[] = [];
  private running = false;
  run<T>(priority: number, task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(new Error('Proof request ended'));
    if (this.jobs.length >= 16) return Promise.reject(new Error('Proof queue busy. Try again after this hand.'));
    return new Promise<T>((resolve, reject) => {
      const job = { priority, run: async () => {
        signal?.removeEventListener('abort', cancel);
        try { signal?.throwIfAborted(); resolve(await task()); } catch (e) { reject(e); }
      } };
      const cancel = () => {
        const index = this.jobs.indexOf(job);
        if (index < 0) return; // A running native task still owns capacity.
        this.jobs.splice(index, 1);
        signal?.removeEventListener('abort', cancel);
        reject(new Error('Proof request ended'));
      };
      signal?.addEventListener('abort', cancel, { once: true });
      this.jobs.push(job);
      this.jobs.sort((a, b) => a.priority - b.priority);
      void this.drain();
    });
  }
  private async drain() {
    if (this.running) return;
    this.running = true;
    try { while (this.jobs.length) await this.jobs.shift()!.run(); }
    finally { this.running = false; }
  }
}
// Mandatory deal = 0. Optional challenge = 1. Public audit = 2.
// A running native call is never treated as preempted.
export const proofQueue = new ProofQueue();
