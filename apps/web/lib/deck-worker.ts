import { shuffleDeck } from './deck-crypto';
import { proveShuffle } from './deck-proof';
import type { DeckWorkerInput } from './deck-worker-client';
import { workerTimingSink } from './diagnostics';
workerTimingSink(sample => self.postMessage({ timing: sample }));
self.onmessage = async (event: MessageEvent<DeckWorkerInput>) => {
  const input = event.data;
  try {
    self.postMessage({ stage: 'preparing local shuffle' });
    const shuffled = await shuffleDeck(input.deck, input.key);
    const proof = await proveShuffle({ ...input, input: input.deck, ...shuffled }, stage => self.postMessage({ stage }));
    self.postMessage({ result: { output: shuffled.output, ...proof } });
  } catch {
    // Never serialize native error objects or private witness contents.
    self.postMessage({ error: 'Your browser could not prove this shuffle. Reconnect to try again.' });
  }
};
