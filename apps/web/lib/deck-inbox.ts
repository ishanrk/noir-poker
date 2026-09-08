// Connection owned inbox. Protocol ordering must never depend on animation.
export class DeckInbox<T extends { hand_no: number; type: string }> {
  private queue: T[] = [];
  private running = false;
  private closed = false;
  private hand = -1;
  private observed = -1;
  constructor(private readonly consume: (message: T, current: () => boolean) => Promise<void>, private readonly fail: () => void) {}
  push(message: T) {
    if (this.closed || message.hand_no < this.observed) return;
    if (!Number.isSafeInteger(message.hand_no) || message.hand_no < 0 || this.queue.length >= 32) {
      this.close(); this.fail(); return;
    }
    this.observed = Math.max(this.observed, message.hand_no);
    // Same wire request can be rebroadcast while another job is running.
    if (!this.queue.some(item => JSON.stringify(item) === JSON.stringify(message))) this.queue.push(message);
    void this.drain();
  }
  advance(hand: number) { this.hand = Math.max(this.hand, hand); this.observed = Math.max(this.observed, hand); }
  close() { this.closed = true; this.queue = []; }
  private async drain() {
    if (this.running || this.closed) return;
    this.running = true;
    try {
      while (!this.closed && this.queue.length) {
        const message = this.queue.shift()!;
        if (message.hand_no < this.observed) continue;
        if (this.hand >= 0 && message.hand_no > this.hand + 1) throw new Error('Invalid hand sequence');
        this.hand = message.hand_no;
        await this.consume(message, () => !this.closed && message.hand_no === this.observed);
      }
    } catch { if (!this.closed) this.fail(); this.close(); }
    finally { this.running = false; }
  }
}
