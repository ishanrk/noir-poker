from __future__ import annotations

import atexit
import re
from pathlib import Path

ROOT = Path.cwd()
MAIN = ROOT / "apps/server/src/main.rs"


def fix_generated_server() -> None:
    if not MAIN.exists():
        return

    text = MAIN.read_text()

    # the transform adds the entropy-aware join but leaves the old join behind
    old_join = re.compile(
        r"\nasync fn join_room\(\n"
        r"    AxumState\(state\): AxumState<AppState>,\n"
        r"    Path\(id\): Path<Uuid>,\n"
        r"\) -> Result<Json<SeatResponse>, HttpError> \{.*?\n\}\n\n"
        r"(?=async fn room_ws\()",
        re.S,
    )
    text, count = old_join.subn("\n", text, count=1)
    if count != 1:
        raise RuntimeError(f"expected one legacy join_room found {count}")

    text = text.replace(
        "let (hand, _, _) = restore_hand(room, stored.config, stored.hand)",
        "let (hand, _) = restore_hand(room, stored.config, stored.hand)",
        1,
    )

    start = text.find("async fn attach_fairness(")
    if start == -1:
        raise RuntimeError("attach_fairness missing")
    end = text.find("\nfn ", start)
    if end == -1:
        end = len(text)
    block = text[start:end]
    block = block.replace(
        "rooms: &Rooms,",
        "rooms: &HashMap<Uuid, Arc<Mutex<Room>>>,",
        1,
    )
    block, count = re.subn(
        r"rooms\s*\.lock\(\)\s*\.await",
        "rooms",
        block,
        count=1,
    )
    if count != 1:
        raise RuntimeError(f"expected one fairness rooms lock found {count}")
    text = text[:start] + block + text[end:]

    text = text.replace("    ReadyUpdate, ", "    ", 1)
    text = text.replace("PendingDraw, PendingFairReady, PlayedAction", "PendingDraw, PlayedAction", 1)

    MAIN.write_text(text)


atexit.register(fix_generated_server)
