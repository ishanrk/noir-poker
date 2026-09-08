"use client";

import { useEffect } from "react";

const ERROR = "/sounds/button-error.wav";

let error: HTMLAudioElement | undefined;

function play(audio: HTMLAudioElement) {
  audio.currentTime = 0;
  void audio.play().catch(() => undefined);
}

export function playErrorSound() {
  error ??= new Audio(ERROR);
  play(error);
}

export function UiSounds() {
  useEffect(() => {
    error = new Audio(ERROR);
    error.preload = "auto";
  }, []);

  return null;
}
