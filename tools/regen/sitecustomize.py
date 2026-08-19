from __future__ import annotations

import atexit
import re
from pathlib import Path

ROOT = Path.cwd()
MAIN = ROOT / "apps/server/src/main.rs"
DB = ROOT / "apps/server/src/db.rs"
ROOM = ROOT / "apps/server/src/room.rs"
DEAL_CORE = ROOT / "crates/deal-core/src/lib.rs"
DEAL_TS = ROOT / "apps/web/lib/deal.ts"
DEAL_TEST = ROOT / "apps/web/lib/deal.test.ts"
RECEIPT = ROOT / "apps/web/lib/receipt.ts"
CHALLENGE_PROOF = ROOT / "apps/web/lib/challenge-proof.ts"
PROTOCOL_DEMO = ROOT / "apps/web/components/protocol-demo.tsx"
PROTOCOL_PAGE = ROOT / "apps/web/app/protocol/page.tsx"

OLD_SEED = "7ee43ff91db755fb8deb2734d1c484ef9dcdfd0249cdab154ba10c467783db1f"
NEW_SEED = "2804b581997cff7e45e6801f10130d4638188c6c19115f7741273282cbef08bd"
NEW_DECK = [
    38, 18, 43, 22, 5, 11, 33, 35, 47, 24, 32, 25, 23, 2, 6, 46, 48, 27, 4, 3, 44, 42,
    15, 13, 39, 30, 49, 41, 7, 1, 12, 37, 9, 10, 20, 40, 17, 21, 0, 29, 36, 8, 26, 16,
    14, 28, 19, 51, 50, 31, 45, 34,
]


def sub_one(text: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"expected one {label} found {count}")
    return updated


def cfg_test_one(text: str, needle: str, label: str) -> str:
    if text.count(needle) != 1:
        raise RuntimeError(f"expected one {label} found {text.count(needle)}")
    indent = needle[: len(needle) - len(needle.lstrip())]
    return text.replace(needle, f"{indent}#[cfg(test)]\n{needle}", 1)


def remove_rust_item(text: str, needle: str, label: str) -> str:
    if text.count(needle) != 1:
        raise RuntimeError(f"expected one {label} found {text.count(needle)}")
    start = text.rfind("\n", 0, text.index(needle)) + 1
    brace = text.index("{", text.index(needle))
    depth = 0
    end = None
    for index in range(brace, len(text)):
        if text[index] == "{":
            depth += 1
        elif text[index] == "}":
            depth -= 1
            if depth == 0:
                end = index + 1
                break
    if end is None:
        raise RuntimeError(f"unterminated {label}")
    while end < len(text) and text[end] == "\n":
        end += 1
    return text[:start] + text[end:]


def fix_main() -> None:
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
    block, count = re.subn(r"rooms\s*\.lock\(\)\s*\.await", "rooms", block, count=1)
    if count != 1:
        raise RuntimeError(f"expected one fairness rooms lock found {count}")
    text = text[:start] + block + text[end:]

    text = text.replace("    ReadyUpdate, ", "    ", 1)
    text = text.replace("PendingDraw, PendingFairReady, PlayedAction", "PendingDraw, PlayedAction", 1)
    text = cfg_test_one(text, "async fn ready_room(", "legacy ready_room")
    text = remove_rust_item(
        text,
        "fn secure_seed() -> Result<[u8; 32], getrandom::Error>",
        "legacy secure_seed",
    )

    old_reset = "TRUNCATE challenge_assignments, hand_actions, hands, seats, rooms"
    new_reset = (
        "TRUNCATE hand_entropy, hand_ceremonies, challenge_assignments, "
        "hand_actions, hands, seats, rooms"
    )
    reset_count = text.count(old_reset)
    if reset_count == 0:
        raise RuntimeError("database test reset missing")
    text = text.replace(old_reset, new_reset)

    MAIN.write_text(text)


def fix_db() -> None:
    text = DB.read_text()
    text = remove_rust_item(text, "pub struct ReadyUpdate<'a>", "ReadyUpdate")
    text = cfg_test_one(text, "    pub async fn create_room(", "legacy Db create_room")
    text = cfg_test_one(text, "    pub async fn join_room(", "legacy Db join_room")
    text = remove_rust_item(
        text,
        "    pub async fn ready(&self, ready: ReadyUpdate<'_>)",
        "legacy Db ready",
    )
    DB.write_text(text)


def fix_room() -> None:
    text = ROOM.read_text()
    text = cfg_test_one(text, "    pub(super) fn commit_join(", "legacy Room commit_join")
    ROOM.write_text(text)


def fix_deal_vectors() -> None:
    rust = DEAL_CORE.read_text().replace(OLD_SEED, NEW_SEED)
    rust_deck = "    const EXPECTED_DECK: [u8; 52] = [\n"
    for offset in range(0, len(NEW_DECK), 12):
        rust_deck += "        " + ", ".join(map(str, NEW_DECK[offset : offset + 12])) + ",\n"
    rust_deck += "    ];"
    rust = sub_one(
        rust,
        r"    const EXPECTED_DECK: \[u8; 52\] = \[.*?    \];",
        rust_deck,
        "Rust deal vector",
    )
    DEAL_CORE.write_text(rust)

    test = DEAL_TEST.read_text().replace(OLD_SEED, NEW_SEED)
    ts_deck = "assert.deepEqual(deck, [\n"
    for offset in range(0, len(NEW_DECK), 12):
        ts_deck += "  " + ", ".join(map(str, NEW_DECK[offset : offset + 12])) + ",\n"
    ts_deck += "]);"
    test = sub_one(test, r"assert\.deepEqual\(deck, \[.*?\]\);", ts_deck, "TypeScript deal vector")
    test = sub_one(
        test,
        r"assert\.deepEqual\(dealLayout\(deck, 3, 1\), \{.*?\}\);",
        "assert.deepEqual(dealLayout(deck, 3, 1), {\n"
        "  hole: [[18, 5], [43, 11], [38, 22]],\n"
        "  burns: [33, 32, 23],\n"
        "  board: [35, 47, 24, 25, 2],\n"
        "});",
        "TypeScript deal layout",
    )
    test = sub_one(
        test,
        r"assert\.deepEqual\(deck\.slice\(0, 5\)\.map\(cardValue\), \[.*?\]\);",
        'assert.deepEqual(deck.slice(0, 5).map(cardValue), ["A♥", "7♦", "6♠", "J♦", "7♣"]);',
        "TypeScript card vector",
    )
    DEAL_TEST.write_text(test)


def fix_web() -> None:
    proof = CHALLENGE_PROOF.read_text().replace(
        'import circuit from "@/zk/challenge_v2.json";',
        'import circuit from "../zk/challenge_v2.json" with { type: "json" };',
        1,
    )
    CHALLENGE_PROOF.write_text(proof)

    receipt = RECEIPT.read_text()
    receipt = receipt.replace('from "@/lib/challenge-proof";', 'from "./challenge-proof.ts";', 1)
    receipt = receipt.replace('from "@/lib/challenge";', 'from "./challenge.ts";', 1)
    receipt = receipt.replace('from "@/lib/deal";', 'from "./deal.ts";', 1)
    receipt = receipt.replace('from "@/lib/server";', 'from "./server.ts";', 1)
    RECEIPT.write_text(receipt)

    page = PROTOCOL_PAGE.read_text()
    page = page.replace('SHA256("NPDEAL01" ||', 'SHA256(&quot;NPDEAL01&quot; ||', 1)
    page = page.replace('SHA256("NPSEED01" ||', 'SHA256(&quot;NPSEED01&quot; ||', 1)
    PROTOCOL_PAGE.write_text(page)

    for path in (DEAL_TS, DEAL_TEST, PROTOCOL_DEMO):
        text = re.sub(r"\b(\d+)n\b", r"BigInt(\1)", path.read_text())
        path.write_text(text)


def fix_generated_source() -> None:
    fix_main()
    fix_db()
    fix_room()
    fix_deal_vectors()
    fix_web()


atexit.register(fix_generated_source)
