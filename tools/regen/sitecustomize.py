from __future__ import annotations

import atexit
import re
from pathlib import Path

ROOT = Path.cwd()
MAIN = ROOT / "apps/server/src/main.rs"
DB = ROOT / "apps/server/src/db.rs"
ROOM = ROOT / "apps/server/src/room.rs"


def sub_one(text: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"expected one {label} found {count}")
    return updated


def fix_main() -> None:
    if not MAIN.exists():
        return

    text = MAIN.read_text()

    text = sub_one(
        text,
        r"\nasync fn join_room\(\n"
        r"    AxumState\(state\): AxumState<AppState>,\n"
        r"    Path\(id\): Path<Uuid>,\n"
        r"\) -> Result<Json<SeatResponse>, HttpError> \{.*?\n\}\n\n"
        r"(?=async fn room_ws\()",
        "\n",
        "legacy join_room",
    )

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

    text = sub_one(
        text,
        r"\nasync fn ready_room\(.*?\n\}\n\n(?=async fn |fn )",
        "\n",
        "legacy ready_room",
    )
    text = sub_one(
        text,
        r"\nfn secure_seed\(\) -> Result<\[u8; 32\], getrandom::Error> \{.*?\n\}\n",
        "\n",
        "legacy secure_seed",
    )

    MAIN.write_text(text)


def fix_db() -> None:
    if not DB.exists():
        return

    text = DB.read_text()
    text = sub_one(
        text,
        r"\npub struct ReadyUpdate<'a> \{.*?\n\}\n",
        "\n",
        "ReadyUpdate",
    )
    text = sub_one(
        text,
        r"\n    pub async fn create_room\(.*?\n    \}\n\n(?=    pub async fn join_room\()",
        "\n",
        "legacy Db create_room",
    )
    text = sub_one(
        text,
        r"\n    pub async fn join_room\(.*?\n    \}\n\n(?=    pub async fn ready\()",
        "\n",
        "legacy Db join_room",
    )
    text = sub_one(
        text,
        r"\n    pub async fn ready\(.*?\n    \}\n\n(?=    pub async fn commit_challenge\()",
        "\n",
        "legacy Db ready",
    )
    DB.write_text(text)


def fix_room() -> None:
    if not ROOM.exists():
        return

    text = ROOM.read_text()
    text = sub_one(
        text,
        r"\n    pub\(super\) fn commit_join\(.*?\n    \}\n\n(?=    pub\(super\) fn stage_ready\()",
        "\n",
        "legacy Room commit_join",
    )
    ROOM.write_text(text)


def fix_generated_server() -> None:
    fix_main()
    fix_db()
    fix_room()


atexit.register(fix_generated_server)
