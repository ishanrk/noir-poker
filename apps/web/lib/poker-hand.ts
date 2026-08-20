const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"] as const;
const NAMES = [
  "High card",
  "Pair",
  "Two pair",
  "Three of a kind",
  "Straight",
  "Flush",
  "Full house",
  "Four of a kind",
  "Straight flush",
] as const;

type ParsedCard = {
  value: string;
  rank: number;
  suit: string;
};

export type BestHand = {
  name: string;
  cards: string[];
};

function parse(value: string): ParsedCard | undefined {
  const suit = value.slice(-1);
  const rank = RANKS.indexOf(value.slice(0, -1) as (typeof RANKS)[number]);

  if (rank < 0 || !"♣♦♥♠".includes(suit)) return undefined;
  return { value, rank: rank + 2, suit };
}

function straightHigh(ranks: number[]) {
  const set = new Set(ranks);
  if (set.has(14)) set.add(1);

  for (let high = 14; high >= 5; high -= 1) {
    if ([0, 1, 2, 3, 4].every((step) => set.has(high - step))) return high;
  }

  return 0;
}

function score(cards: ParsedCard[]) {
  const count = new Map<number, number>();

  for (const card of cards) count.set(card.rank, (count.get(card.rank) ?? 0) + 1);

  const ranks = cards.map((card) => card.rank).sort((a, b) => b - a);
  const groups = [...count].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const flush = cards.every((card) => card.suit === cards[0].suit);
  const straight = straightHigh(ranks);

  if (flush && straight) return [8, straight];
  if (groups[0][1] === 4) return [7, groups[0][0], groups[1][0]];
  if (groups[0][1] === 3 && groups[1][1] === 2) return [6, groups[0][0], groups[1][0]];
  if (flush) return [5, ...ranks];
  if (straight) return [4, straight];
  if (groups[0][1] === 3) {
    return [3, groups[0][0], ...groups.filter((group) => group[1] === 1).map((group) => group[0])];
  }
  if (groups[0][1] === 2 && groups[1][1] === 2) {
    const pairs = groups.filter((group) => group[1] === 2).map((group) => group[0]).sort((a, b) => b - a);
    const kicker = groups.find((group) => group[1] === 1)?.[0] ?? 0;
    return [2, pairs[0], pairs[1], kicker];
  }
  if (groups[0][1] === 2) {
    return [1, groups[0][0], ...groups.filter((group) => group[1] === 1).map((group) => group[0])];
  }
  return [0, ...ranks];
}

function stronger(left: number[], right: number[]) {
  const n = Math.max(left.length, right.length);

  for (let i = 0; i < n; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }

  return false;
}

export function bestHand(values: string[]): BestHand | undefined {
  const cards = values.map(parse);
  if (cards.length < 5 || cards.some((card) => !card)) return undefined;

  const parsed = cards as ParsedCard[];
  let bestScore: number[] | undefined;
  let bestCards: ParsedCard[] | undefined;

  for (let a = 0; a < parsed.length - 4; a += 1) {
    for (let b = a + 1; b < parsed.length - 3; b += 1) {
      for (let c = b + 1; c < parsed.length - 2; c += 1) {
        for (let d = c + 1; d < parsed.length - 1; d += 1) {
          for (let e = d + 1; e < parsed.length; e += 1) {
            const hand = [parsed[a], parsed[b], parsed[c], parsed[d], parsed[e]];
            const value = score(hand);

            if (!bestScore || stronger(value, bestScore)) {
              bestScore = value;
              bestCards = hand;
            }
          }
        }
      }
    }
  }

  if (!bestScore || !bestCards) return undefined;
  return { name: NAMES[bestScore[0]], cards: bestCards.map((card) => card.value) };
}
