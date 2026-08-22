import { HandHistory } from "@/components/hand-history";

export default async function HandsPage({ params }: { params: Promise<{ room: string }> }) {
  const { room } = await params;
  return <HandHistory room={room} />;
}
