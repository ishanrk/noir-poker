// Opt in locally with sessionStorage.setItem('noir-diagnostics', '1').
// Only fixed names, numeric generations and timings belong here.
export type TimingEvent = 'activation' | 'audio-scheduled' | 'audio-rejected' | 'room-request' | 'room-ready' | 'deck-stage' | 'resources' | 'witness' | 'runtime' | 'proof' | 'verify' | 'opening' | 'first-action';
type Sample = { event: TimingEvent; at: number; hand?: number; generation?: number; duration?: number };
const samples: Sample[] = [];
let sink: ((sample: Sample) => void) | undefined;
export function workerTimingSink(value?: (sample: Sample) => void) { sink = value; }
export function timing(event: TimingEvent, values: Omit<Sample, 'event' | 'at'> = {}) {
  try {
    if (sink) { sink({ event, at: performance.now(), ...values }); return; }
    if (typeof sessionStorage === 'undefined' || sessionStorage.getItem('noir-diagnostics') !== '1') return;
    samples.push({ event, at: performance.now(), ...values });
    if (samples.length > 500) samples.shift();
    Object.assign(window, { noirDiagnosticSamples: diagnosticSamples });
  } catch { /* Diagnostics must never affect play. */ }
}
export function diagnosticSamples() { return samples.map(sample => ({ ...sample })); }
