import { hasDatabaseUrl } from "@/db";

export default function HomePage() {
  const dbConfigured = hasDatabaseUrl();

  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <header className="border-b border-amber-500/20 pb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-amber-400">
          World of Warcraft: Forever — Economy Analytics
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-zinc-50">
          WoW Forever Farm Optimizer
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          Phase 2 Data Foundation initialized. Configure PostgreSQL and run
          catalog, loot, and market sync workers before Phase 3 (Profitability
          Engine) and Phase 4 (Dashboard UI).
        </p>
      </header>

      <section className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-5">
          <h2 className="text-sm font-semibold text-amber-300">
            Database Connection
          </h2>
          <p className="mt-2 text-sm text-zinc-300">
            Status:{" "}
            <span
              className={
                dbConfigured
                  ? "font-medium text-emerald-400"
                  : "font-medium text-amber-400"
              }
            >
              {dbConfigured ? "DATABASE_URL configured" : "DATABASE_URL not set"}
            </span>
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Health endpoint: <code>/api/v1/health</code>
          </p>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-5">
          <h2 className="text-sm font-semibold text-amber-300">
            Active Data Adapters
          </h2>
          <ul className="mt-2 space-y-1 text-xs text-zinc-300">
            <li>Catalog: EverlookDB (WoW Forever 1.60.1.x)</li>
            <li>Observed Loot: Everloot (CC BY-SA 4.0) + EverlookDB</li>
            <li>Markets: Forever AH (Alliance / Horde / Blackwater)</li>
            <li>Canonical AH: Blizzard Battle.net API (OAuth2 ready)</li>
          </ul>
        </div>
      </section>
    </main>
  );
}
