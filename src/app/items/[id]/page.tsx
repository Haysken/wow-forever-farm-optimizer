import { notFound } from "next/navigation";
import { ItemDetailClient } from "@/components/ItemDetailClient";

export default async function ItemDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ marketId?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const itemId = Number(id);
  if (!Number.isInteger(itemId) || itemId <= 0) {
    notFound();
  }

  return (
    <ItemDetailClient
      itemId={itemId}
      initialMarketId={sp.marketId ?? "us:0"}
    />
  );
}
