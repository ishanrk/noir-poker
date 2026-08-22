import { notFound } from "next/navigation";

import { PublishedProofPage } from "@/components/published-proof";
import type { ProofKind } from "@/lib/server";

export default async function ProofPage({ params }: {
  params: Promise<{ room: string; hand: string; seat: string; kind: string }>;
}) {
  const value = await params;
  const hand = Number(value.hand);
  const seat = Number(value.seat);

  if (!Number.isInteger(hand) || hand < 0 || !Number.isInteger(seat) || seat < 0 || seat > 5) notFound();
  if (value.kind !== "draw" && value.kind !== "completion") notFound();

  return <PublishedProofPage room={value.room} hand={hand} seat={seat} kind={value.kind as ProofKind} />;
}
