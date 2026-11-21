"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Activity,
  Bookmark,
  Coins,
  Dice5,
  Search,
  TrendingUp,
} from "lucide-react";
import { getRarityMeta } from "@/lib/wow-ui";

interface SearchResultPayload {
  items: Array<{
    id: number;
    name: string;
    quality: number;
    itemClass: string | null;
    iconUrl: string | null;
  }>;
  creatures: Array<{
    id: number;
    name: string;
    minLevel: number | null;
    maxLevel: number | null;
    primaryZoneName: string | null;
    classification: string;
  }>;
  zones: Array<{
    id: number;
    name: string;
    continent: string | null;
  }>;
}

const NAV_ITEMS = [
  { href: "/", label: "Farm Rankings", icon: Coins },
  { href: "/simulator", label: "Simulator", icon: Dice5 },
  { href: "/watchlist", label: "Watchlist", icon: Bookmark },
  { href: "/opportunities", label: "Opportunities", icon: TrendingUp },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResultPayload | null>(null);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/v1/search?q=${encodeURIComponent(trimmed)}`
        );
        if (res.ok) {
          const data: SearchResultPayload = await res.json();
          setResults(data);
          setOpen(true);
        }
      } catch {
        // ignore transient search errors
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="min-h-screen bg-[#0b0d11] text-zinc-100 flex flex-col">
      <header className="sticky top-0 z-40 border-b border-amber-500/20 bg-[#0e1117]/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2.5 group">
              <div className="flex h-8 w-8 items-center justify-center rounded border border-amber-500/40 bg-gradient-to-br from-amber-500/20 to-amber-900/20 text-amber-300">
                <Coins className="h-4 w-4" />
              </div>
              <div className="leading-tight">
                <div className="text-sm font-bold tracking-wide text-amber-100 group-hover:text-amber-300 transition-colors">
                  WoW Forever
                </div>
                <div className="text-[11px] font-medium uppercase tracking-widest text-amber-400/80">
                  Farm Optimizer
                </div>
              </div>
            </Link>

            <nav className="flex items-center gap-1">
              {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
                const active =
                  href === "/" ? pathname === "/" : pathname.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      active
                        ? "border border-amber-500/35 bg-amber-500/15 text-amber-200"
                        : "text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-100"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span>{label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>

          <div ref={boxRef} className="relative w-full sm:w-80">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-500" />
              <input
                type="text"
                value={query}
                onFocus={() => results && setOpen(true)}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search creature, item, or item ID..."
                className="w-full rounded-md border border-zinc-800 bg-[#141821] py-1.5 pl-8 pr-3 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500/50 focus:outline-none"
              />
            </div>

            {open && results && (
              <div className="absolute right-0 mt-1.5 max-h-96 w-full overflow-y-auto rounded-lg border border-amber-500/25 bg-[#12161f] p-2 shadow-2xl">
                {results.items.length === 0 && results.creatures.length === 0 ? (
                  <p className="px-2 py-3 text-center text-xs text-zinc-500">
                    No matching items or creatures found.
                  </p>
                ) : (
                  <>
                    {results.items.length > 0 && (
                      <div className="mb-2">
                        <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-400/80">
                          Items
                        </div>
                        {results.items.slice(0, 6).map((item) => {
                          const rarity = getRarityMeta(item.quality);
                          return (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => {
                                setOpen(false);
                                setQuery("");
                                router.push(`/items/${item.id}`);
                              }}
                              className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs hover:bg-zinc-800/80"
                            >
                              <span className={`font-medium ${rarity.textClass}`}>
                                {item.name}
                              </span>
                              <span className="text-[10px] text-zinc-500">
                                #{item.id}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {results.creatures.length > 0 && (
                      <div>
                        <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-400/80">
                          Creatures
                        </div>
                        {results.creatures.slice(0, 6).map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => {
                              setOpen(false);
                              setQuery("");
                              router.push(`/creatures/${c.id}`);
                            }}
                            className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs hover:bg-zinc-800/80"
                          >
                            <span className="font-medium text-zinc-200">
                              {c.name}
                            </span>
                            <span className="text-[10px] text-zinc-500">
                              {c.primaryZoneName ?? "Unknown zone"}
                              {c.minLevel ? ` · Lv ${c.minLevel}` : ""}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        {children}
      </main>

      <footer className="border-t border-zinc-800/80 bg-[#0d1016] py-5 text-xs text-zinc-500">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-2">
            <Activity className="h-3.5 w-3.5 text-amber-400/70" />
            <span>
              Market data: Forever AH &amp; Blizzard Battle.net API · Observed
              drops: Everloot (CC BY-SA 4.0) · Catalog &amp; Classic 1.12
              estimates: EverlookDB / CMaNGOS (GPL-3.0)
            </span>
          </div>
          <div className="text-zinc-600">
            Independent community analytics tool — not affiliated with Blizzard
            Entertainment.
          </div>
        </div>
      </footer>
    </div>
  );
}
