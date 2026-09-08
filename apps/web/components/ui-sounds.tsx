"use client";

import { useEffect, useSyncExternalStore } from 'react';
import { isMuted, subscribeMute, playPickupSound, prepareSounds, setMuted, stopSounds } from '@/lib/ui-audio';
export { playErrorSound, playPickupSound } from '@/lib/ui-audio';

export function SoundToggle() {
  const muted = useSyncExternalStore(subscribeMute, isMuted, () => false);
  return <button type="button" aria-pressed={muted} onClick={() => {
    setMuted(!muted);
  }}>{muted ? 'Enable sound' : 'Mute sound'}</button>;
}

export function UiSounds() {
  // Let an accepted navigation's short acknowledgement finish. There are no
  // delayed pickups to replay on the next route; pagehide and unmount stop audio.
  useEffect(() => {
    const release = prepareSounds();
    let lastSlider = -Infinity;
    function onClick(event: MouseEvent) {
      if (window.location.pathname !== '/' || event.defaultPrevented) return;
      const node = event.target instanceof Element ? event.target : null;
      // Submissions acknowledge themselves after local validation.
      const control = node?.closest('.home-actions a:first-child');
      if (control && !control.matches('[aria-disabled="true"]')) playPickupSound();
    }
    function onInput(event: Event) {
      if (window.location.pathname !== '/') return;
      const node = event.target instanceof HTMLInputElement ? event.target : null;
      if (!node || node.disabled || !['range', 'radio'].includes(node.type)) return;
      if (node.type === 'range') {
        const now = performance.now();
        if (now - lastSlider < 80) return;
        lastSlider = now;
      }
      playPickupSound();
    }
    document.addEventListener('click', onClick);
    document.addEventListener('input', onInput);
    window.addEventListener('pagehide', stopSounds);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('input', onInput);
      window.removeEventListener('pagehide', stopSounds);
      release();
    };
  }, []);
  return null;
}
