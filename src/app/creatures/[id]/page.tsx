import { notFound } from "next/navigation";
import { CreatureDetailClient } from "@/components/CreatureDetailClient";

export default async function CreatureDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ marketId?: string; kph?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const creatureId = Number(id);
  if (!Number.isInteger(creatureId) || creatureId <= 0) {
    notFound();
  }

  return (
    <CreatureDetailClient
      creatureId={creatureId}
      initialMarketId={sp.marketId ?? "us:110"}
      initialKph={Math.max(1, Number(sp.kph) || 60)}
    />
  );
}
