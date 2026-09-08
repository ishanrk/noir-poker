# Ownership, retry, and restart policy

The browser socket owns a bounded serial deck inbox and a dedicated proof worker. Replacing or leaving the connection closes both. Freshness is checked after asynchronous work and before sends or visible updates. The JavaScript owner does not retain a completed job's witness, but runtime reuse is not a promise of Wasm memory zeroization. Idle runtime disposal is 30 seconds. Browser refresh still needs the saved seat and hand secret in that tab's session storage.

The global queue within each tab gives mandatory deck work priority 0, optional challenge proving priority 1, and public audits priority 2. Native work already running is not preempted. Separate tabs do not share that queue. The browser runtime caps its thread count at eight or the reported hardware concurrency, whichever is smaller. Main thread preparation and witness execution for mandatory shuffles run in the owned worker.

The server admits at most eight total expensive jobs, with one running. Admission happens before blocking execution. Its permit stays in the blocking closure until native work actually returns, even if the waiting request disappears. This is bounded FIFO scheduling, not preemption. The existing sample proxy has no separate request limiter. A socket accepts messages up to 256 KiB and has at most two pending optional proof submissions. Public internet request rate limiting still requires deployment policy. Queued browser jobs are removed when their owner aborts; a running native call retains capacity until it ends.

## Accepted effects

| Operation | Identity and duplicate behavior |
| --- | --- |
| Create | New clients save a private request key and the exact body before sending. The derived room UUID is unique in PostgreSQL. Retrying returns the same seat credential after comparing persisted effective configuration, name, initial entropy, and token hash. Different payloads conflict. Concurrent requests are serialized by the existing admission lock. Legacy clients without a key retain explicit new request semantics. |
| Join | The saved request credential identifies a seat in the room. A retry checks original name and entropy before returning it. A changed payload conflicts. The room lock and seat constraints prevent an extra accepted seat. |
| Ready | New clients bind readiness to the current completed hand. An older hand is rejected. Existing exact entropy and readiness checks remain. After advancement, reconcile the snapshot rather than resending. |
| Wager | New messages bind hand and next action sequence. A matching previously accepted seat and action returns success without another transition. Different payloads at that sequence conflict. Stale hands are rejected. The room lock and database revision compare protect the accepted transition. Legacy action forms remain for compatibility but do not gain a retry identity. |
| Shuffle and shares | Hand, participant, transcript context, and expected public inputs are checked. Reconnect reads the server's next needed operation. Previously accepted or stale submissions must not be blindly replayed. |
| Challenge | Hand assignment, commitment, nonce, facts, proof public inputs, and unique nullifier remain bound. Pending work is capped per connection. Accepted proofs are persisted before the acknowledgement and can be recovered from server state. |
| Settlement and refund | Existing durable Aztec admission and settlement identities and transitions are retained. Restart stages refunds once. Fixtures cover staging and reconciliation; no live wallet transaction was executed. |

There is no exactly once network delivery claim. A lost acknowledgement can conceal an accepted effect. The client first reconciles server state and never automatically repeats an unversioned wager.

## Restart

The server cannot recover missing browser opening secrets or its in memory encrypted deck state from the existing database. Startup records incomplete encrypted rooms in room_interruptions with a unique room key and a server_restart reason. Repeated startup cannot create another outcome. These rooms are not restored as playable and their incomplete hands are never advertised as verified.

Completed transcripts and proof history remain available directly from the database. The status endpoint lets a returning browser explain the interruption and offer a new room. Ordinary test chip stacks are room scoped, not transferable balances. The interrupted room is retired without fabricating a result or crediting a winner; a new room receives its configured initial test stack. Existing optional Aztec refunds are staged before recording the interruption and remain governed by their unique settlement rows.

Leaving does not replace a participant, promise a refund, or force another machine to finish opening. A disconnected participant can prevent completion. Ordinary rooms retire after 30 minutes without authenticated activity, checked every minute. Retirement is persisted before removing the live room, preserves completed history, and prevents a delayed job from reviving it. New room admission is serialized and capped at 128 live rooms. These are conservative resource policies, not measured host capacity guarantees. Aztec rooms are excluded from automatic expiry because their external accounting requires separate reconciliation. A restart resets the idle clock of recoverable rooms.

## User feedback

Pickup sound means local input received, not server acceptance or payment success. Local validation precedes submit acknowledgement. Error sounds cancel outstanding pickup voices. Buttons schedule playback immediately, while only continuous sliders have an 80 millisecond rate limit. An already playing acknowledgement may finish across client navigation; no delayed playback is queued for the new route. Page exit, unmount, mute, and errors stop owned playback. Preparation uses observed stages, elapsed times, and a slow explanation after a documented 20 second policy threshold. This is not an estimated finish time.

The table never advances betting optimistically. Submission state replaces the old Your turn prompt until the server accepts or rejects. Error responses are followed by authoritative state. Completed receipts remain available while another hand prepares.
