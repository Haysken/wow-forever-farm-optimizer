-- WoW Forever Farm Optimizer — Read-Only Loot & Farm Telemetry Addon
-- 100% Blizzard ToS compliant: uses only official event APIs and SavedVariables.
-- Never performs automation, auto-looting, AH posting, or memory inspection.

local ADDON_NAME = ...
local frame = CreateFrame("Frame")

local seenCorpseGuids = {}
local recentKilledTargets = {} -- guid -> { npcId, name, level, killedAt }
local activeSession = nil -- { startedAt, kills, byNpc = {} }

local function ensureDb()
  if type(WoWForeverFarmOptimizerDB) ~= "table" then
    WoWForeverFarmOptimizerDB = {}
  end
  local db = WoWForeverFarmOptimizerDB
  db.schemaVersion = 1
  db.addonVersion = "0.1.0"
  db.clientBuild = select(1, GetBuildInfo()) .. "." .. select(2, GetBuildInfo())
  db.region = GetCurrentRegionName and GetCurrentRegionName() or "UNKNOWN"
  db.updatedAt = time()
  if type(db.creatures) ~= "table" then
    db.creatures = {}
  end
  if type(db.prices) ~= "table" then
    db.prices = {}
  end
  return db
end

local function parseNpcIdFromGuid(guid)
  if type(guid) ~= "string" then
    return nil
  end
  -- Format: Creature-0-server-instance-zone-npcId-spawnUID
  local unitType, _, _, _, _, npcIdStr = strsplit("-", guid)
  if unitType == "Creature" or unitType == "Vehicle" then
    local npcId = tonumber(npcIdStr)
    if npcId and npcId > 0 then
      return npcId
    end
  end
  return nil
end

local function parseItemIdFromLink(link)
  if type(link) ~= "string" then
    return nil
  end
  local idStr = string.match(link, "item:(%d+)")
  local id = tonumber(idStr)
  if id and id > 0 then
    return id
  end
  return nil
end

local function parseCopperFromCoinText(text)
  if type(text) ~= "string" then
    return 0
  end
  local g = tonumber(string.match(text, "(%d+)%s*[Gg]old")) or 0
  local s = tonumber(string.match(text, "(%d+)%s*[Ss]ilver")) or 0
  local c = tonumber(string.match(text, "(%d+)%s*[Cc]opper")) or 0
  return g * 10000 + s * 100 + c
end

local function getPlayerCoords()
  if not C_Map or not C_Map.GetBestMapForUnit then
    return nil, nil, nil
  end
  local mapId = C_Map.GetBestMapForUnit("player")
  if not mapId then
    return nil, nil, nil
  end
  local pos = C_Map.GetPlayerMapPosition(mapId, "player")
  if not pos then
    return mapId, nil, nil
  end
  local x, y = pos:GetXY()
  if not x or not y then
    return mapId, nil, nil
  end
  return mapId, math.floor(x * 1000 + 0.5) / 10, math.floor(y * 1000 + 0.5) / 10
end

local function getOrCreateCreatureEntry(db, npcId, name, level)
  local entry = db.creatures[npcId]
  if type(entry) ~= "table" then
    entry = {
      id = npcId,
      name = name or ("NPC " .. tostring(npcId)),
      minLevel = level or 0,
      maxLevel = level or 0,
      kills = 0,
      lootedCorpses = 0,
      rawCoinCopper = 0,
      activeSeconds = 0,
      lastKillAt = 0,
      items = {},
      spawns = {},
    }
    db.creatures[npcId] = entry
  else
    if name and name ~= "" then
      entry.name = name
    end
    if level and level > 0 then
      if entry.minLevel == 0 or level < entry.minLevel then
        entry.minLevel = level
      end
      if level > entry.maxLevel then
        entry.maxLevel = level
      end
    end
  end
  return entry
end

local function recordSpawn(entry)
  local mapId, x, y = getPlayerCoords()
  if not mapId or not x or not y then
    return
  end
  -- Quantize to 1.0% map grid to keep SavedVariables compact
  local gx = math.floor(x + 0.5)
  local gy = math.floor(y + 0.5)
  local key = tostring(mapId) .. ":" .. tostring(gx) .. ":" .. tostring(gy)
  if #entry.spawns < 40 then
    for _, sp in ipairs(entry.spawns) do
      if sp.k == key then
        return
      end
    end
    table.insert(entry.spawns, { k = key, map = mapId, x = x, y = y })
  end
end

local function recordKillForSpeed(db, npcId, name, level)
  local now = time()
  local entry = getOrCreateCreatureEntry(db, npcId, name, level)
  if entry.lastKillAt > 0 then
    local delta = now - entry.lastKillAt
    -- Count contiguous farming intervals (<= 180s between kills)
    if delta > 0 and delta <= 180 then
      entry.activeSeconds = entry.activeSeconds + delta
    end
  end
  entry.lastKillAt = now
  entry.kills = entry.kills + 1
  recordSpawn(entry)

  if activeSession then
    activeSession.kills = activeSession.kills + 1
    activeSession.byNpc[npcId] = (activeSession.byNpc[npcId] or 0) + 1
  end
end

local function handleCombatLog()
  local _, subevent, _, _, _, _, _, destGUID, destName = CombatLogGetCurrentEventInfo()
  if subevent ~= "PARTY_KILL" and subevent ~= "UNIT_DIED" then
    return
  end
  local npcId = parseNpcIdFromGuid(destGUID)
  if not npcId then
    return
  end
  if recentKilledTargets[destGUID] then
    return
  end
  local level = 0
  if UnitGUID("target") == destGUID then
    level = UnitLevel("target") or 0
  end
  recentKilledTargets[destGUID] = {
    npcId = npcId,
    name = destName,
    level = level,
    killedAt = time(),
  }
  -- Only count PARTY_KILL toward kill denominator to avoid counting other players' mobs
  if subevent == "PARTY_KILL" then
    local db = ensureDb()
    recordKillForSpeed(db, npcId, destName, level)
    db.updatedAt = time()
  end
end

local function handleLootReady()
  local db = ensureDb()
  local numSlots = GetNumLootItems()
  local sourcesTouched = {}

  if numSlots == 0 then
    -- Empty corpse opened on target: count corpse without inflating drop rates
    local guid = UnitGUID("target")
    local npcId = parseNpcIdFromGuid(guid)
    if npcId and guid and not seenCorpseGuids[guid] then
      seenCorpseGuids[guid] = true
      local entry = getOrCreateCreatureEntry(db, npcId, UnitName("target"), UnitLevel("target"))
      entry.lootedCorpses = entry.lootedCorpses + 1
      if entry.kills < entry.lootedCorpses then
        entry.kills = entry.lootedCorpses
      end
      recordSpawn(entry)
    end
    return
  end

  local perCorpseItems = {} -- guid -> { npcId, coinCopper, items = { itemId -> qty } }

  for slot = 1, numSlots do
    local slotType = GetLootSlotType(slot)
    local _, slotName, slotQty = GetLootSlotInfo(slot)
    local sources = { GetLootSourceInfo(slot) }

    if #sources >= 2 then
      for i = 1, #sources, 2 do
        local srcGuid = sources[i]
        local srcCount = sources[i + 1] or slotQty or 1
        local npcId = parseNpcIdFromGuid(srcGuid)
        if npcId and srcGuid and not seenCorpseGuids[srcGuid] then
          sourcesTouched[srcGuid] = npcId
          local bucket = perCorpseItems[srcGuid]
          if not bucket then
            bucket = { npcId = npcId, coinCopper = 0, items = {} }
            perCorpseItems[srcGuid] = bucket
          end

          if slotType == Enum.LootSlotType.Money then
            bucket.coinCopper = bucket.coinCopper + parseCopperFromCoinText(slotName)
          elseif slotType == Enum.LootSlotType.Item then
            local link = GetLootSlotLink(slot)
            local itemId = parseItemIdFromLink(link)
            if itemId then
              bucket.items[itemId] = (bucket.items[itemId] or 0) + math.max(1, srcCount)
            end
          end
        end
      end
    end
  end

  for guid, bucket in pairs(perCorpseItems) do
    seenCorpseGuids[guid] = true
    local meta = recentKilledTargets[guid]
    local entry = getOrCreateCreatureEntry(
      db,
      bucket.npcId,
      meta and meta.name or nil,
      meta and meta.level or nil
    )
    entry.lootedCorpses = entry.lootedCorpses + 1
    if entry.kills < entry.lootedCorpses then
      entry.kills = entry.lootedCorpses
    end
    entry.rawCoinCopper = entry.rawCoinCopper + bucket.coinCopper
    recordSpawn(entry)

    for itemId, qty in pairs(bucket.items) do
      local rec = entry.items[itemId]
      if type(rec) ~= "table" then
        rec = { drops = 0, totalQty = 0, minQty = qty, maxQty = qty }
        entry.items[itemId] = rec
      end
      rec.drops = rec.drops + 1
      rec.totalQty = rec.totalQty + qty
      if qty < rec.minQty then rec.minQty = qty end
      if qty > rec.maxQty then rec.maxQty = qty end
    end
  end

  db.updatedAt = time()
end

local function formatCopper(copper)
  local g = math.floor(copper / 10000)
  local s = math.floor((copper % 10000) / 100)
  local c = copper % 100
  if g > 0 then
    return string.format("%dg %ds %dc", g, s, c)
  elseif s > 0 then
    return string.format("%ds %dc", s, c)
  end
  return string.format("%dc", c)
end

-- Optional in-game tooltip overlay when companion sync writes db.prices[itemId]
local function attachTooltipPrice(tooltip)
  if type(WoWForeverFarmOptimizerDB) ~= "table" or type(WoWForeverFarmOptimizerDB.prices) ~= "table" then
    return
  end
  local _, link = tooltip:GetItem()
  local itemId = parseItemIdFromLink(link)
  if not itemId then
    return
  end
  local p = WoWForeverFarmOptimizerDB.prices[itemId]
  if type(p) == "table" and p.clearing and p.clearing > 0 then
    tooltip:AddDoubleLine(
      "|cffd4a94bFarm Optimizer AH:|r",
      formatCopper(p.clearing) .. (p.house and (" (" .. p.house .. ")") or ""),
      1, 0.85, 0.4,
      1, 1, 1
    )
  end
end

if GameTooltip and GameTooltip.HookScript then
  GameTooltip:HookScript("OnTooltipSetItem", attachTooltipPrice)
end

-- Slash commands: /wffo stats | start | stop | reset
SLASH_WFFO1 = "/wffo"
SlashCmdList["WFFO"] = function(msg)
  local cmd = strtrim(string.lower(msg or ""))
  local db = ensureDb()

  if cmd == "start" then
    activeSession = { startedAt = time(), kills = 0, byNpc = {} }
    print("|cffd4a94b[Farm Optimizer]|r Farming session started. Kill mobs normally; type /wffo stop when done.")
  elseif cmd == "stop" then
    if not activeSession then
      print("|cffd4a94b[Farm Optimizer]|r No active session.")
      return
    end
    local elapsed = math.max(1, time() - activeSession.startedAt)
    local kph = math.floor((activeSession.kills / elapsed) * 3600 + 0.5)
    print(string.format("|cffd4a94b[Farm Optimizer]|r Session ended: %d kills in %ds (~%d kills/hr). Type /reload to save to disk.", activeSession.kills, elapsed, kph))
    activeSession = nil
  elseif cmd == "reset" then
    db.creatures = {}
    seenCorpseGuids = {}
    recentKilledTargets = {}
    print("|cffd4a94b[Farm Optimizer]|r Local observation log cleared.")
  else
    local npcCount, totalKills, dropTypes = 0, 0, 0
    for _, c in pairs(db.creatures) do
      npcCount = npcCount + 1
      totalKills = totalKills + (c.kills or 0)
      for _ in pairs(c.items or {}) do
        dropTypes = dropTypes + 1
      end
    end
    print(string.format("|cffd4a94b[Farm Optimizer]|r Tracked %d creatures, %d kills, %d distinct item drops. /reload then upload SavedVariables/WoWForeverFarmOptimizer.lua at /import.", npcCount, totalKills, dropTypes))
  end
end

frame:RegisterEvent("ADDON_LOADED")
frame:RegisterEvent("COMBAT_LOG_EVENT_UNFILTERED")
frame:RegisterEvent("LOOT_READY")
frame:SetScript("OnEvent", function(_, event, arg1)
  if event == "ADDON_LOADED" and arg1 == ADDON_NAME then
    ensureDb()
  elseif event == "COMBAT_LOG_EVENT_UNFILTERED" then
    handleCombatLog()
  elseif event == "LOOT_READY" then
    handleLootReady()
  end
end)
