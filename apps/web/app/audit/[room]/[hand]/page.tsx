import { DealAuditView } from "@/components/deal-audit";

export default async function AuditPage({ params }: { params: Promise<{ room: string; hand: string }> }) {
  const { room, hand } = await params;
  const handNo = Number(hand);
  return <DealAuditView room={room} hand={handNo} />;
}
