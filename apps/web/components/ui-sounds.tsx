"use client";

import { useEffect } from "react";

const PICKUP = "/sounds/item-pickup.wav";
const ERROR = "/sounds/button-error.wav";

let pickup: HTMLAudioElement | undefined;
let error: HTMLAudioElement | undefined;
let pickupTimer: ReturnType<typeof setTimeout> | undefined;

function play(audio: HTMLAudioElement) {
  audio.currentTime = 0;
  void audio.play().catch(() => undefined);
}

export function playErrorSound() {
  if (pickupTimer) clearTimeout(pickupTimer);
  pickupTimer = undefined;
  if (pickup) {
    pickup.pause();
    pickup.currentTime = 0;
  }
  error ??= new Audio(ERROR);
  play(error);
}

export function UiSounds() {
  useEffect(() => {
    pickup = new Audio(PICKUP);
    error = new Audio(ERROR);
    pickup.preload = "auto";
    error.preload = "auto";
    let last = 0;

    function playPickup(delay = 0) {
      function run() {
        pickupTimer = undefined;
        const now = performance.now();
        if (now - last < 80 || !pickup) return;
        last = now;
        play(pickup);
      }

      if (!delay) {
        run();
        return;
      }

      if (pickupTimer) clearTimeout(pickupTimer);
      pickupTimer = setTimeout(run, delay);
    }

    function onClick(event: MouseEvent) {
      const node = event.target instanceof Element ? event.target : null;
      const control = node?.closest(
        "button, .mode-switch label, .key-choice, .home-actions a:first-child",
      );
      if (!control || control.matches(":disabled, [aria-disabled='true']")) return;

      playPickup(140);
    }

    function onInput(event: Event) {
      const node = event.target instanceof HTMLInputElement ? event.target : null;
      if (!node || node.type !== "range" || node.disabled) return;

      playPickup();
    }

    document.addEventListener("click", onClick);
    document.addEventListener("input", onInput);
    return () => {
      if (pickupTimer) clearTimeout(pickupTimer);
      pickupTimer = undefined;
      document.removeEventListener("click", onClick);
      document.removeEventListener("input", onInput);
    };
  }, []);

  return null;
}
