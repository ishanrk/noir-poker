type WireAction = { type: string; [key: string]: unknown };

type WireView = {
  hand_no: number;
  next_action_seq?: number;
  last_action?: { seq: number };
};

const POKER_ACTIONS = new Set(["fold", "check", "call", "raise_to"]);

export function isLegacySeatRejection(status: number, message: string) {
  return (status === 400 || status === 422) &&
    /unknown field\s+[`'"]request_key[`'"]/.test(message);
}

export function withoutRequestKey(body: object) {
  const legacyBody = { ...body } as Record<string, unknown>;
  delete legacyBody.request_key;
  return legacyBody;
}

export async function postSeatWithCompatibility(
  post: (body: object) => Promise<Response>,
  body: object,
) {
  const response = await post(body);
  if (response.ok) return { response };

  const message = (await response.text()).trim() || "request failed";
  if (!isLegacySeatRejection(response.status, message)) return { response, message };

  // The legacy server rejects this unknown field while parsing, before it can
  // create or join a room. Retrying without only that field cannot duplicate
  // an accepted effect from the rejected request.
  return { response: await post(withoutRequestKey(body)) };
}

export function compatibleActionWire(action: WireAction, view?: WireView) {
  // The first encrypted-deck server accepted direct poker actions and `ready`.
  // A view without next_action_seq identifies that protocol unambiguously.
  if (!view || typeof view.next_action_seq !== "number") return action;

  if (POKER_ACTIONS.has(action.type)) {
    return {
      type: "wager",
      hand_no: view.hand_no,
      seq: view.next_action_seq,
      action,
    };
  }

  if (action.type === "ready") {
    return { ...action, type: "ready_hand", hand_no: view.hand_no };
  }

  return action;
}
