import { notFound } from "next/navigation";

import { ProofHistory } from "@/components/proof-history";

export default async function PlayerProofsPage({ params }: {
  params: Promise<{ room: string; seat: string }>;
}) {
  const value = await params;
  const seat = Number(value.seat);

  if (!Number.isInteger(seat) || seat < 0 || seat > 5) notFound();

  return <ProofHistory room={value.room} seat={seat} />;
}
