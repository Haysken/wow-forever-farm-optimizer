import { SimulatorClient } from "@/components/SimulatorClient";

export default async function SimulatorPage({
  searchParams,
}: {
  searchParams: Promise<{ creatureId?: string; marketId?: string; kph?: string }>;
}) {
  const sp = await searchParams;
  return (
    <SimulatorClient
      initialCreatureId={sp.creatureId ? Number(sp.creatureId) : undefined}
      initialMarketId={sp.marketId ?? "us:110"}
      initialKph={sp.kph ? Number(sp.kph) : 60}
    />
  );
}
