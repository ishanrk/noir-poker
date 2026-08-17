import { ProofReceiptView } from "@/components/proof-receipt";

export default async function ProofPage({
  params,
}: {
  params: Promise<{ nullifier: string }>;
}) {
  const { nullifier } = await params;

  return <ProofReceiptView nullifier={nullifier} />;
}
