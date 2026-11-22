import { notFound } from "next/navigation";
import { ItemVariantDetailClient } from "@/components/ItemVariantDetailClient";

export default async function ItemVariantDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; suffixId: string }>;
  searchParams: Promise<{ marketId?: string }>;
}) {
  const { id, suffixId } = await params;
  const sp = await searchParams;
  const itemId = Number(id);
  const parsedSuffix = Number(suffixId);
  if (
    !Number.isInteger(itemId) ||
    itemId <= 0 ||
    !Number.isInteger(parsedSuffix) ||
    parsedSuffix <= 0
  ) {
    notFound();
  }

  return (
    <ItemVariantDetailClient
      itemId={itemId}
      suffixId={parsedSuffix}
      initialMarketId={sp.marketId ?? "us:0"}
    />
  );
}
