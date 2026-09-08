import { timing } from './diagnostics.ts';
import { ProofQueue } from './proof-queue.ts';
type Api = Awaited<ReturnType<typeof import('@aztec/bb.js')['Barretenberg']['new']>>;
let runtime: Promise<Api> | undefined;
let idle: ReturnType<typeof setTimeout> | undefined;
const queue = new ProofQueue();
// Single owner and serialized access. No witnesses or private inputs retained.
export function withDeckRuntime<T>(task: (api: Api) => Promise<T>): Promise<T> {
  return queue.run(0, async () => {
    clearTimeout(idle);
    const at = performance.now();
    runtime ??= import('@aztec/bb.js').then(({ Barretenberg, BackendType }) =>
      Barretenberg.new({ backend: BackendType.WasmWorker, threads: Math.min(8, globalThis.navigator?.hardwareConcurrency ?? 8) }));
    try {
      const api = await runtime;
      timing('runtime', { duration: performance.now() - at });
      return await task(api);
    } catch (error) {
      const broken = runtime; runtime = undefined;
      await broken?.then(api => api.destroy()).catch(() => undefined);
      throw error;
    } finally {
      idle = setTimeout(() => { void disposeDeckRuntime(); }, 30000);
      if (typeof idle === 'object' && 'unref' in idle) idle.unref();
    }
  });
}
export function disposeDeckRuntime() {
  return queue.run(0, async () => {
    clearTimeout(idle);
    const prior = runtime; runtime = undefined;
    await prior?.then(api => api.destroy()).catch(() => undefined);
  });
}
