import { z } from "zod";

export interface ParsedAddonItemDrop {
  itemId: number;
  drops: number;
  totalQty: number;
  minQty: number;
  maxQty: number;
}

export interface ParsedAddonSpawn {
  mapId: number;
  x: number;
  y: number;
}

export interface ParsedAddonCreature {
  npcId: number;
  name: string;
  minLevel: number | null;
  maxLevel: number | null;
  kills: number;
  lootedCorpses: number;
  rawCoinCopper: number;
  activeSeconds: number;
  measuredKillsPerHour: number | null;
  items: ParsedAddonItemDrop[];
  spawns: ParsedAddonSpawn[];
}

export interface ParsedSavedVariables {
  schemaVersion: number;
  addonVersion: string | null;
  clientBuild: string | null;
  region: string | null;
  updatedAt: Date;
  creatures: ParsedAddonCreature[];
}

type LuaValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: LuaValue }
  | LuaValue[];

interface Token {
  type: "ident" | "number" | "string" | "punct" | "eof";
  value: string;
}

function tokenizeLua(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = source.length;

  while (i < len) {
    const ch = source[i]!;

    // Whitespace
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Line comments -- ...
    if (ch === "-" && source[i + 1] === "-") {
      i += 2;
      while (i < len && source[i] !== "\n") i++;
      continue;
    }

    // Strings ("..." or '...')
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      let out = "";
      while (i < len && source[i] !== quote) {
        if (source[i] === "\\" && i + 1 < len) {
          const next = source[i + 1]!;
          if (next === "n") out += "\n";
          else if (next === "t") out += "\t";
          else if (next === "r") out += "\r";
          else out += next;
          i += 2;
        } else {
          out += source[i]!;
          i++;
        }
      }
      if (i >= len) throw new Error("Unterminated Lua string literal");
      i++; // closing quote
      tokens.push({ type: "string", value: out });
      continue;
    }

    // Numbers (including negative)
    if (
      /[0-9]/.test(ch) ||
      (ch === "-" && i + 1 < len && /[0-9]/.test(source[i + 1]!))
    ) {
      const start = i;
      if (ch === "-") i++;
      while (i < len && /[0-9.eE+-]/.test(source[i]!)) {
        // stop before unary minus unless after e/E
        if (
          (source[i] === "-" || source[i] === "+") &&
          source[i - 1] !== "e" &&
          source[i - 1] !== "E"
        ) {
          break;
        }
        i++;
      }
      tokens.push({ type: "number", value: source.slice(start, i) });
      continue;
    }

    // Identifiers / booleans / nil
    if (/[A-Za-z_]/.test(ch)) {
      const start = i;
      while (i < len && /[A-Za-z0-9_]/.test(source[i]!)) i++;
      tokens.push({ type: "ident", value: source.slice(start, i) });
      continue;
    }

    // Punctuation
    if ("{}[]=,;".includes(ch)) {
      tokens.push({ type: "punct", value: ch });
      i++;
      continue;
    }

    throw new Error(`Unexpected character '${ch}' in SavedVariables file at offset ${i}`);
  }

  tokens.push({ type: "eof", value: "" });
  return tokens;
}

class LuaParser {
  private pos = 0;

  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.pos] ?? { type: "eof", value: "" };
  }

  private consume(expectedType?: Token["type"], expectedValue?: string): Token {
    const tok = this.peek();
    if (expectedType && tok.type !== expectedType) {
      throw new Error(`Expected ${expectedType} but found ${tok.type} ('${tok.value}')`);
    }
    if (expectedValue !== undefined && tok.value !== expectedValue) {
      throw new Error(`Expected '${expectedValue}' but found '${tok.value}'`);
    }
    this.pos++;
    return tok;
  }

  parseRootAssignment(varName: string): LuaValue {
    while (this.peek().type !== "eof") {
      if (this.peek().type === "ident") {
        const name = this.consume("ident").value;
        this.consume("punct", "=");
        const val = this.parseValue();
        if (this.peek().type === "punct" && this.peek().value === ";") {
          this.consume();
        }
        if (name === varName) {
          return val;
        }
      } else {
        throw new Error(`Unexpected token '${this.peek().value}' at root of SavedVariables`);
      }
    }
    throw new Error(`Variable '${varName}' not found in SavedVariables file`);
  }

  private parseValue(): LuaValue {
    const tok = this.peek();
    if (tok.type === "string") {
      this.consume();
      return tok.value;
    }
    if (tok.type === "number") {
      this.consume();
      const num = Number(tok.value);
      if (!Number.isFinite(num)) {
        throw new Error(`Invalid number '${tok.value}'`);
      }
      return num;
    }
    if (tok.type === "ident") {
      this.consume();
      if (tok.value === "true") return true;
      if (tok.value === "false") return false;
      if (tok.value === "nil") return null;
      throw new Error(`Unexpected identifier '${tok.value}' as value`);
    }
    if (tok.type === "punct" && tok.value === "{") {
      return this.parseTable();
    }
    throw new Error(`Unexpected token '${tok.value}' while parsing value`);
  }

  private parseTable(): LuaValue {
    this.consume("punct", "{");
    const dict: Record<string, LuaValue> = {};
    const list: LuaValue[] = [];
    let hasExplicitKeys = false;
    let arrayIndex = 1;

    while (!(this.peek().type === "punct" && this.peek().value === "}")) {
      if (this.peek().type === "eof") {
        throw new Error("Unexpected EOF inside Lua table");
      }

      if (this.peek().type === "punct" && this.peek().value === "[") {
        hasExplicitKeys = true;
        this.consume("punct", "[");
        const keyVal = this.parseValue();
        this.consume("punct", "]");
        this.consume("punct", "=");
        const val = this.parseValue();
        if (keyVal !== null && typeof keyVal !== "object") {
          dict[String(keyVal)] = val;
        }
      } else if (
        this.peek().type === "ident" &&
        this.tokens[this.pos + 1]?.type === "punct" &&
        this.tokens[this.pos + 1]?.value === "="
      ) {
        hasExplicitKeys = true;
        const key = this.consume("ident").value;
        this.consume("punct", "=");
        dict[key] = this.parseValue();
      } else {
        const val = this.parseValue();
        list.push(val);
        dict[String(arrayIndex++)] = val;
      }

      if (
        this.peek().type === "punct" &&
        (this.peek().value === "," || this.peek().value === ";")
      ) {
        this.consume();
      }
    }

    this.consume("punct", "}");
    if (!hasExplicitKeys && list.length > 0) {
      return list;
    }
    return dict;
  }
}

const rawItemDropSchema = z.object({
  drops: z.number().int().positive(),
  totalQty: z.number().int().positive(),
  minQty: z.number().int().positive().optional(),
  maxQty: z.number().int().positive().optional(),
});

const rawSpawnSchema = z.object({
  map: z.number().int().positive(),
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
});

const rawCreatureSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().optional(),
  minLevel: z.number().int().nonnegative().optional(),
  maxLevel: z.number().int().nonnegative().optional(),
  kills: z.number().int().nonnegative().default(0),
  lootedCorpses: z.number().int().nonnegative().default(0),
  rawCoinCopper: z.number().int().nonnegative().default(0),
  activeSeconds: z.number().int().nonnegative().default(0),
  items: z.union([z.record(rawItemDropSchema), z.array(z.unknown())]).optional(),
  spawns: z.union([z.array(rawSpawnSchema), z.record(rawSpawnSchema)]).optional(),
});

const rootDbSchema = z.object({
  schemaVersion: z.number().int().positive().default(1),
  addonVersion: z.string().nullable().optional(),
  clientBuild: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  updatedAt: z.number().int().positive().optional(),
  creatures: z.union([z.record(rawCreatureSchema), z.array(z.unknown())]).default({}),
});

/**
 * Safely parses a WoW Forever Farm Optimizer `SavedVariables/WoWForeverFarmOptimizer.lua`
 * file without executing arbitrary code, returning strictly validated creature observations.
 */
export function parseSavedVariablesLua(luaContent: string): ParsedSavedVariables {
  if (!luaContent || luaContent.trim().length === 0) {
    throw new Error("SavedVariables file is empty");
  }
  if (luaContent.length > 10 * 1024 * 1024) {
    throw new Error("SavedVariables file exceeds 10 MB limit");
  }

  const tokens = tokenizeLua(luaContent);
  const parser = new LuaParser(tokens);
  const rootRaw = parser.parseRootAssignment("WoWForeverFarmOptimizerDB");
  const parsed = rootDbSchema.parse(rootRaw);

  const creatures: ParsedAddonCreature[] = [];
  const creaturesRecord = Array.isArray(parsed.creatures) ? {} : parsed.creatures;

  for (const [npcKey, raw] of Object.entries(creaturesRecord)) {
    const npcId = raw.id ?? Number(npcKey);
    if (!Number.isInteger(npcId) || npcId <= 0) continue;

    const kills = Math.max(raw.kills, raw.lootedCorpses);
    if (kills <= 0) continue;

    const itemsRecord =
      raw.items && !Array.isArray(raw.items) ? raw.items : {};
    const items: ParsedAddonItemDrop[] = [];

    for (const [itemKey, drop] of Object.entries(itemsRecord)) {
      const itemId = Number(itemKey);
      if (!Number.isInteger(itemId) || itemId <= 0) continue;
      if (drop.drops > kills) continue; // Reject inconsistent observation
      items.push({
        itemId,
        drops: drop.drops,
        totalQty: Math.max(drop.drops, drop.totalQty),
        minQty: drop.minQty ?? 1,
        maxQty: drop.maxQty ?? Math.max(1, Math.ceil(drop.totalQty / drop.drops)),
      });
    }

    const rawSpawns = raw.spawns
      ? Array.isArray(raw.spawns)
        ? raw.spawns
        : Object.values(raw.spawns)
      : [];
    const spawns: ParsedAddonSpawn[] = rawSpawns.map((s) => ({
      mapId: s.map,
      x: s.x,
      y: s.y,
    }));

    const measuredKillsPerHour =
      raw.activeSeconds >= 120 && raw.kills >= 5
        ? Math.round((raw.kills / raw.activeSeconds) * 3600)
        : null;

    creatures.push({
      npcId,
      name: raw.name && raw.name.length > 0 ? raw.name : `NPC ${npcId}`,
      minLevel: raw.minLevel && raw.minLevel > 0 ? raw.minLevel : null,
      maxLevel: raw.maxLevel && raw.maxLevel > 0 ? raw.maxLevel : null,
      kills,
      lootedCorpses: raw.lootedCorpses,
      rawCoinCopper: raw.rawCoinCopper,
      activeSeconds: raw.activeSeconds,
      measuredKillsPerHour,
      items,
      spawns,
    });
  }

  return {
    schemaVersion: parsed.schemaVersion,
    addonVersion: parsed.addonVersion ?? null,
    clientBuild: parsed.clientBuild ?? null,
    region: parsed.region ?? null,
    updatedAt: parsed.updatedAt ? new Date(parsed.updatedAt * 1000) : new Date(),
    creatures,
  };
}
