import { timing } from './diagnostics.ts';

let voices: { pickup: HTMLAudioElement[]; error: HTMLAudioElement[] } | undefined;
let owners = 0;
let cursor = 0;
let muted = false;
const muteListeners = new Set<() => void>();
export function subscribeMute(listener: () => void) {
  muteListeners.add(listener);
  return () => { muteListeners.delete(listener); };
}
export function isMuted() { return muted; }
export function setMuted(value: boolean) {
  muted = value;
  try { localStorage.setItem('noir-muted', String(value)); } catch { /* Memory preference still works. */ }
  if (value) stopSounds();
  for (const listener of muteListeners) listener();
}
export function stopSounds() {
  for (const pool of Object.values(voices ?? {})) for (const audio of pool) {
    audio.pause(); audio.currentTime = 0;
  }
}
export function prepareSounds() {
  owners++;
  if (!voices) {
    try { muted = localStorage.getItem('noir-muted') === 'true'; } catch { /* Default enabled. */ }
    const pool = (path: string, count: number) => Array.from({ length: count }, () => {
      const audio = new Audio(path);
      audio.preload = 'auto'; audio.load();
      return audio;
    });
    voices = { pickup: pool('/sounds/item-pickup.wav', 4), error: pool('/sounds/button-error.wav', 1) };
    for (const listener of muteListeners) listener();
  }
  return () => {
    if (--owners > 0) return;
    stopSounds();
    for (const pool of Object.values(voices ?? {})) for (const audio of pool) {
      audio.removeAttribute('src'); audio.load();
    }
    voices = undefined;
  };
}
export function playPickupSound() { play('pickup'); }
export function playErrorSound() { stopSounds(); play('error'); }
function play(kind: 'pickup' | 'error') {
  if (muted || !voices) return;
  const audio = voices[kind][kind === 'pickup' ? cursor++ % voices.pickup.length : 0];
  audio.currentTime = 0;
  timing('audio-scheduled');
  void audio.play().catch(() => timing('audio-rejected'));
}
