"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { View } from "../components/table";
import { contribution, loadParticipant, observeDeal, pinDeal } from "./participant";
import { authenticationError, parseServerMessage, type BetAction, type ClientAction, type Waiting } from "./room-protocol";
import { loadSeat, roomSocket, type RoomSeat } from "./server";
import { useChallengeSession } from "./use-challenge-session";

type Connection = "connecting" | "connected" | "disconnected" | "auth_error";
const MAX_RETRIES = 3;

function closeSocket(socket: WebSocket) {
  socket.onopen = null;
  socket.onmessage = null;
  socket.onerror = null;
  socket.onclose = null;
  if (socket.readyState < WebSocket.CLOSING) socket.close();
}

export function useRoomSession(room: string) {
  const challenge = useChallengeSession(room);
  const challengeRef = useRef(challenge);
  const socket = useRef<WebSocket | undefined>(undefined);
  const auth = useRef<RoomSeat | undefined>(undefined);
  const rev = useRef(-1);
  const generation = useRef(0);
  const dealing = useRef<string | undefined>(undefined);
  const evidenceError = useRef<string | undefined>(undefined);
  const latest = useRef<View | undefined>(undefined);
  const retries = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const authTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [seat, setSeat] = useState<number | null>();
  const [waiting, setWaiting] = useState<Waiting>();
  const [view, setView] = useState<View>();
  const [error, setError] = useState<string>();
  const [connection, setConnection] = useState<Connection>("connecting");
  const [pending, setPending] = useState(false);
  const [evidenceUnavailable, setEvidenceUnavailable] = useState(false);
  const [raiseTo, setRaiseTo] = useState(0);

  useEffect(() => { challengeRef.current = challenge; });

  const connect = useCallback(function open(manual = true) {
    const current = auth.current;
    if (!current) return;
    if (manual) retries.current = 0;
    clearTimeout(retryTimer.current);
    clearTimeout(authTimer.current);
    if (socket.current) closeSocket(socket.current);
    socket.current = undefined;
    const connectionGeneration = ++generation.current;
    challengeRef.current.reset();
    dealing.current = undefined;
    evidenceError.current = undefined;
    setConnection("connecting");
    setPending(false);
    setError(undefined);

    let next: WebSocket;
    const live = () => generation.current === connectionGeneration;
    const disconnected = (message: string) => {
      if (!live()) return;
      generation.current += 1;
      clearTimeout(authTimer.current);
      if (socket.current) closeSocket(socket.current);
      socket.current = undefined;
      dealing.current = undefined;
      challengeRef.current.reset();
      setConnection("disconnected");
      setPending(false);
      setError(message);
      if (retries.current < MAX_RETRIES) {
        retries.current += 1;
        retryTimer.current = setTimeout(() => open(false), 500 * 2 ** (retries.current - 1));
      }
    };
    try { next = new WebSocket(roomSocket(room)); }
    catch { disconnected("Connection failed"); return; }
    socket.current = next;
    authTimer.current = setTimeout(() => disconnected("Authentication response timed out"), 15000);
    next.onopen = () => { if (live()) next.send(JSON.stringify({ type: "auth", token: current.token })); };
    next.onmessage = (event) => {
      if (!live() || socket.current !== next || typeof event.data !== "string") return;
      let message;
      try { message = parseServerMessage(event.data); }
      catch { disconnected("Invalid server message"); return; }
      if (message.type === "error") {
        if (authenticationError(message)) {
          generation.current += 1;
          clearTimeout(authTimer.current);
          clearTimeout(retryTimer.current);
          closeSocket(next);
          socket.current = undefined;
          challengeRef.current.reset();
          setConnection("auth_error");
        } else {
          challengeRef.current.fail();
          dealing.current = undefined;
        }
        setPending(false);
        setError(message.message);
        return;
      }
      clearTimeout(authTimer.current);
      setConnection("connected");
      if (message.type === "waiting" || message.type === "waiting_fair") {
        if (message.type === "waiting_fair") {
          if (message.rev < rev.current) return;
          rev.current = message.rev;
        }
        setWaiting({ joined: message.joined, players: message.players, mode: message.mode, deal: message.type === "waiting_fair" ? message.deal : undefined });
        setView(undefined);
        latest.current = undefined;
        setPending(false);
        setError(evidenceError.current);
        if (message.type === "waiting_fair") {
          try {
            const deal = message.deal;
            if (deal.mine) {
              const existing = loadParticipant(room, deal.hand_no, current.seat);
              if (existing) pinDeal(room, current.seat, deal);
              setEvidenceUnavailable(!existing);
              dealing.current = undefined;
            } else {
              pinDeal(room, current.seat, deal);
              const ceremony = `${deal.hand_no}:${deal.commitment}`;
              if (dealing.current !== ceremony && !evidenceError.current) {
                const entropy = contribution(room, current.seat, deal);
                setEvidenceUnavailable(false);
                dealing.current = ceremony;
                setPending(true);
                next.send(JSON.stringify({ type: "deal_entropy", hand_no: deal.hand_no, commitment: deal.commitment, entropy } satisfies ClientAction));
              }
            }
          } catch (failure) {
            evidenceError.current = failure instanceof Error ? failure.message : "Participant evidence could not be saved";
            setError(evidenceError.current);
            setPending(false);
          }
        }
        return;
      }
      if (message.rev < rev.current) return;
      rev.current = message.rev;
      dealing.current = undefined;
      try {
        setEvidenceUnavailable(!message.view.deal || !observeDeal(room, current.seat, message.view.deal, message.view.hole, message.view.board));
        if (message.view.next_deal && (!message.view.next_deal.mine || loadParticipant(room, message.view.next_deal.hand_no, current.seat))) pinDeal(room, current.seat, message.view.next_deal);
      } catch (failure) {
        evidenceError.current = failure instanceof Error ? failure.message : "Participant evidence could not be saved";
      }
      challengeRef.current.restore(message.view, current.seat);
      latest.current = message.view;
      setWaiting(undefined);
      setView(message.view);
      setRaiseTo(message.view.actions?.raise?.min_to ?? 0);
      setPending(false);
      setError(evidenceError.current);
    };
    next.onerror = () => disconnected("Connection failed");
    next.onclose = () => disconnected("Disconnected");
  }, [room]);

  useEffect(() => {
    let live = true;
    queueMicrotask(() => {
      if (!live) return;
      try {
        const current = loadSeat(room);
        if (!current) { setSeat(null); return; }
        auth.current = current;
        setSeat(current.seat);
        connect();
      } catch {
        setSeat(null);
        setError("Seat storage unavailable in this browser");
      }
    });
    return () => {
      live = false;
      generation.current += 1;
      auth.current = undefined;
      rev.current = -1;
      latest.current = undefined;
      challengeRef.current.invalidate();
      clearTimeout(retryTimer.current);
      clearTimeout(authTimer.current);
      if (socket.current) closeSocket(socket.current);
      socket.current = undefined;
    };
  }, [connect, room]);

  function send(action: ClientAction, proof = false) {
    const current = socket.current;
    if (!current || current.readyState !== WebSocket.OPEN || connection !== "connected" || evidenceError.current || (!proof && (pending || challenge.pending()))) return false;
    setPending(true);
    setError(undefined);
    current.send(JSON.stringify(action));
    return true;
  }

  function bet(action: BetAction) {
    const current = latest.current;
    if (!current) return;
    send({ ...action, hand_no: current.hand_no, rev: rev.current, request_id: crypto.randomUUID() });
  }

  function ready() {
    const deal = latest.current?.next_deal;
    if (!deal || typeof seat !== "number" || pending || challenge.pending() || connection !== "connected") return;
    try {
      const entropy = contribution(room, seat, deal);
      send({ type: "ready", hand_no: deal.hand_no, commitment: deal.commitment, entropy });
    } catch (failure) {
      evidenceError.current = failure instanceof Error ? failure.message : "Participant evidence could not be saved";
      setError(evidenceError.current);
    }
  }

  function prove(kind: "draw" | "claim") {
    if (pending || challenge.pending() || connection !== "connected" || evidenceError.current) return;
    const expected = generation.current;
    void challenge.prove(kind, (message) => generation.current === expected && send(message, true));
  }

  return {
    seat, waiting, view, error, connection, evidenceUnavailable, connect: () => connect(), raiseTo, setRaiseTo,
    disabled: pending || challenge.pending() || connection !== "connected" || !!evidenceError.current,
    bet, ready, commit: () => challenge.commit(send), prove, contract: view ? challenge.contract(view) : undefined,
  };
}
