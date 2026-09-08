import type { CipherValue, PointValue } from './deck-crypto';
import { proofQueue } from './proof-queue.ts';
import { timing } from './diagnostics.ts';
export type DeckWorkerInput = { hand: number; generation?: number; seat: number; context: string; deck: CipherValue[]; key: PointValue };
type Result = { output: CipherValue[]; proof: string; public_inputs: string };
export class DeckWorkerClient {
  private worker?: Worker;
  private closed = false;
  private reject?: (error: Error) => void;
  private readonly lifetime = new AbortController();
  prove(input: DeckWorkerInput, status: (stage: string) => void): Promise<Result> {
    return proofQueue.run(0, async () => {
      if (this.closed) throw new Error('Table session ended');
      // The first visible acknowledgement has an opportunity to paint.
      await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, 50);
        requestAnimationFrame(() => { clearTimeout(timer); setTimeout(resolve, 0); });
      });
      if (this.closed) throw new Error('Table session ended');
      const worker = this.worker ??= new Worker(new URL('./deck-worker.ts', import.meta.url), { type: 'module' });
      return new Promise<Result>((resolve, reject) => {
        this.reject = reject;
        const fail = () => {
          worker.terminate(); this.worker = undefined; this.reject = undefined;
          reject(new Error('Proof worker stopped. Reconnect to try again.'));
        };
        worker.onerror = fail;
        worker.onmessageerror = fail;
        worker.onmessage = ({ data }) => {
          if (this.closed) return;
          if (data.timing) timing(data.timing.event, { hand: input.hand, generation: input.generation, duration: data.timing.duration });
          else if (data.stage) status(data.stage);
          else {
            this.reject = undefined;
            worker.onmessage = null;
            if (data.error) reject(new Error(data.error));
            else resolve(data.result);
          }
        };
        worker.postMessage(input);
      });
    }, this.lifetime.signal);
  }
  close() {
    this.closed = true;
    this.lifetime.abort();
    this.worker?.terminate(); this.worker = undefined;
    this.reject?.(new Error('Table session ended')); this.reject = undefined;
  }
}
