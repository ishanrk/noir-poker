import { ProofHistory } from "@/components/proof-history";

export default async function ProofsPage({ params }: { params: Promise<{ room: string }> }) {
  const { room } = await params;
  return <ProofHistory room={room} />;
}
