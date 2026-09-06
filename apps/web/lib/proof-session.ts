export type ProofOperation = {
  room: string;
  generation: number;
  hand_no: number;
  kind: "draw" | "claim";
};

export class ProofSession {
  generation = 0;
  operation: ProofOperation | undefined;

  reset() {
    this.generation += 1;
    this.operation = undefined;
  }

  start(room: string, hand_no: number, kind: ProofOperation["kind"]): ProofOperation {
    const operation = { room, hand_no, kind, generation: this.generation };
    this.operation = operation;
    return operation;
  }

  current(operation: ProofOperation) {
    return this.operation === operation && operation.generation === this.generation;
  }

  reconcile(draw: { hand_no: number; draw_verified: boolean } | undefined, claim: { hand_no: number; status: string } | undefined) {
    const operation = this.operation;
    if (!operation) return;
    const target = operation.kind === "draw" ? draw : claim;
    if (!target || target.hand_no !== operation.hand_no ||
      (operation.kind === "draw" ? draw?.draw_verified : claim?.status === "claimed")) {
      this.operation = undefined;
    }
  }
}
