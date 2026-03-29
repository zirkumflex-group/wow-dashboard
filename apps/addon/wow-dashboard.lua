local addonName, addon = ...

-- ============================================================
-- WoW Dashboard — Expansion Overview Panel Style
-- ============================================================

local ADDON_PATH   = "Interface\\AddOns\\wow-dashboard"
local FONT_BOLD    = ADDON_PATH .. "\\Fonts\\Lato-Bold.ttf"
local BORDER_TEX   = ADDON_PATH .. "\\Art\\ExpansionLandingPage\\ExpansionBorder_TWW"
local MINIMAP_ICON = ADDON_PATH .. "\\Art\\Logo\\WDIconTransparent"

local BG_R, BG_G, BG_B = 0.067, 0.040, 0.024

-- ============================================================
-- Helpers
-- ============================================================

local function DisableSharpening(tex)
    tex:SetTexelSnappingBias(0)
    tex:SetSnapToPixelGrid(false)
end

local function CreateExpansionThemeFrame(parent, withCloseBtn)
    local f = CreateFrame("Frame", nil, parent)
    f:SetUsingParentLevel(true)
    f:ClearAllPoints()
    f:SetPoint("TOPLEFT",     parent, "TOPLEFT",      30, -30)
    f:SetPoint("BOTTOMRIGHT", parent, "BOTTOMRIGHT", -30,  30)

    local p = {}
    for i = 1, 9 do
        p[i] = f:CreateTexture(nil, "BORDER")
        DisableSharpening(p[i])
        p[i]:ClearAllPoints()
        p[i]:SetTexture(BORDER_TEX)
    end
    f.pieces = p

    local C = 64
    p[1]:SetSize(C, C);  p[3]:SetSize(C, C)
    p[7]:SetSize(C, C);  p[9]:SetSize(C, C)

    p[1]:SetPoint("CENTER", f, "TOPLEFT",     0, 0)
    p[3]:SetPoint("CENTER", f, "TOPRIGHT",    0, 0)
    p[7]:SetPoint("CENTER", f, "BOTTOMLEFT",  0, 0)
    p[9]:SetPoint("CENTER", f, "BOTTOMRIGHT", 0, 0)

    p[2]:SetPoint("TOPLEFT",     p[1], "TOPRIGHT",    0, 0)
    p[2]:SetPoint("BOTTOMRIGHT", p[3], "BOTTOMLEFT",  0, 0)
    p[4]:SetPoint("TOPLEFT",     p[1], "BOTTOMLEFT",  0, 0)
    p[4]:SetPoint("BOTTOMRIGHT", p[7], "TOPRIGHT",    0, 0)
    p[5]:SetPoint("TOPLEFT",     p[1], "BOTTOMRIGHT", 0, 0)
    p[5]:SetPoint("BOTTOMRIGHT", p[9], "TOPLEFT",     0, 0)
    p[6]:SetPoint("TOPLEFT",     p[3], "BOTTOMLEFT",  0, 0)
    p[6]:SetPoint("BOTTOMRIGHT", p[9], "TOPRIGHT",    0, 0)
    p[8]:SetPoint("TOPLEFT",     p[7], "TOPRIGHT",    0, 0)
    p[8]:SetPoint("BOTTOMRIGHT", p[9], "BOTTOMLEFT",  0, 0)

    p[1]:SetTexCoord(  0/1024, 128/1024,   0/1024, 128/1024)
    p[2]:SetTexCoord(128/1024, 384/1024,   0/1024, 128/1024)
    p[3]:SetTexCoord(384/1024, 512/1024,   0/1024, 128/1024)
    p[4]:SetTexCoord(  0/1024, 128/1024, 128/1024, 384/1024)
    p[5]:SetTexCoord(128/1024, 384/1024, 128/1024, 384/1024)
    p[6]:SetTexCoord(384/1024, 512/1024, 128/1024, 384/1024)
    p[7]:SetTexCoord(  0/1024, 128/1024, 384/1024, 512/1024)
    p[8]:SetTexCoord(128/1024, 384/1024, 384/1024, 512/1024)
    p[9]:SetTexCoord(384/1024, 512/1024, 384/1024, 512/1024)

    if withCloseBtn then
        p[3]:SetTexCoord(518/1024, 646/1024, 48/1024, 176/1024)
    end

    local bg = f:CreateTexture(nil, "BACKGROUND")
    f.Background = bg
    bg:SetPoint("TOPLEFT",     p[1], "TOPLEFT",     4, -4)
    bg:SetPoint("BOTTOMRIGHT", p[9], "BOTTOMRIGHT", -4, 4)
    bg:SetColorTexture(BG_R, BG_G, BG_B)

    local closeBtn = CreateFrame("Button", nil, f)
    f.CloseButton = closeBtn
    closeBtn:SetShown(withCloseBtn or false)
    closeBtn:SetSize(32, 32)
    closeBtn:SetPoint("CENTER", p[3], "TOPRIGHT", -20.5, -20.5)
    local btnTex = closeBtn:CreateTexture(nil, "OVERLAY")
    btnTex:SetPoint("CENTER", closeBtn, "CENTER")
    btnTex:SetSize(24, 24)
    btnTex:SetTexture(BORDER_TEX)
    btnTex:SetTexCoord(646/1024, 694/1024, 48/1024, 96/1024)
    local btnHL = closeBtn:CreateTexture(nil, "HIGHLIGHT")
    btnHL:SetPoint("CENTER", closeBtn, "CENTER")
    btnHL:SetSize(24, 24)
    btnHL:SetTexture(BORDER_TEX)
    btnHL:SetTexCoord(646/1024, 694/1024, 48/1024, 96/1024)
    btnHL:SetBlendMode("ADD")
    btnHL:SetAlpha(0.5)

    return f
end

local function BuildSection(parent, width, height, withCloseBtn)
    local s = CreateFrame("Frame", nil, parent)
    s:SetSize(width, height)
    s.NineSlice = CreateExpansionThemeFrame(s, withCloseBtn)
    return s
end

local function CreateMajorDivider(parent)
    local f = CreateFrame("Frame", nil, parent)
    f:SetSize(128, 4)
    f.Left = f:CreateTexture(nil, "OVERLAY")
    f.Left:SetSize(64, 24)
    f.Left:SetPoint("LEFT", f, "LEFT")
    f.Left:SetTexture(BORDER_TEX)
    f.Left:SetTexCoord(0.5, 634/1024, 0, 48/1024)
    f.Right = f:CreateTexture(nil, "OVERLAY")
    f.Right:SetSize(64, 24)
    f.Right:SetPoint("LEFT",  f.Left, "RIGHT")
    f.Right:SetPoint("RIGHT", f,      "RIGHT")
    f.Right:SetTexture(BORDER_TEX)
    f.Right:SetTexCoord(634/1024, 1, 0, 48/1024)
    return f
end

local function BuildCategoryBar(parent, label, yOffset)
    local bar = CreateFrame("Frame", nil, parent)
    bar:SetSize(186, 26)
    bar:SetPoint("TOP", parent, "TOP", 0, -yOffset)
    local strip = bar:CreateTexture(nil, "BACKGROUND")
    strip:SetAllPoints(bar)
    strip:SetColorTexture(0.12, 0.09, 0.05, 0.9)
    local accent = bar:CreateTexture(nil, "BORDER")
    accent:SetSize(3, 20)
    accent:SetPoint("LEFT", bar, "LEFT", 6, 0)
    accent:SetColorTexture(1, 0.82, 0, 0.9)
    local txt = bar:CreateFontString(nil, "OVERLAY")
    txt:SetFont(FONT_BOLD, 11, "")
    txt:SetTextColor(0.804, 0.667, 0.498)
    txt:SetPoint("LEFT", accent, "RIGHT", 6, 0)
    txt:SetText(label)
    return bar
end

local function BuildInfoRow(parent, key, value, yOffset)
    local lbl = parent:CreateFontString(nil, "OVERLAY")
    lbl:SetFont(FONT_BOLD, 10, "")
    lbl:SetTextColor(0.55, 0.55, 0.55)
    lbl:SetPoint("TOPLEFT", parent, "TOPLEFT", 14, -yOffset)
    lbl:SetText(key)
    local val = parent:CreateFontString(nil, "OVERLAY")
    val:SetFont(FONT_BOLD, 10, "")
    val:SetTextColor(1, 0.82, 0)
    val:SetPoint("TOPRIGHT", parent, "TOPRIGHT", -14, -yOffset)
    val:SetText(value)
end

-- ============================================================
-- Data Collection
-- ============================================================
-- Every SNAPSHOT_INTERVAL seconds the addon collects character
-- and snapshot fields that mirror the backend Convex schema and
-- appends them to WowDashboardDB.characters[key].snapshots.
--
-- The SavedVariables file written by WoW is located at:
--   WTF/Account/<ACCOUNT>/SavedVariables/wow-dashboard.lua
--
-- Schema (WowDashboardDB):
--   version        number   -- bump when layout changes
--   panelOpen      boolean
--   minimap        table
--     minimapPos   number
--     hide         boolean
--   characters     table    -- keyed by "Name-Realm"
--     name         string
--     realm        string
--     region       string   -- "us" | "eu" | "kr" | "tw"
--     class        string   -- e.g. "WARRIOR"
--     race         string   -- e.g. "Human"
--     faction      string   -- "alliance" | "horde"
--     mythicPlusRuns    array   -- raw addon-side run history probe store
--       fingerprint         string
--       source              string
--       observedAt          number
--       seasonID            number?
--       mapChallengeModeID  number?
--       level               number?
--       completed           boolean?
--       completedInTime     boolean?
--       durationMs          number?
--       runScore            number?
--       startDate           number?
--       completedAt         number?
--       thisWeek            boolean?
--       members             table?
--       raw                 table
--     mythicPlusRunKeys table -- keyed by fingerprint for dedupe
--     mythicPlusDebug   table -- last probe summary for local testing
--     snapshots    array
--       takenAt           number  -- Unix timestamp
--       level             number
--       spec              string
--       role              string  -- "tank" | "healer" | "dps"
--       itemLevel         number
--       gold              number  -- in gold (not copper)
--       playtimeSeconds   number  -- total /played seconds
--       mythicPlusScore   number
--       currencies        table
--         adventurerDawncrest  number
--         veteranDawncrest     number
--         championDawncrest    number
--         heroDawncrest        number
--         mythDawncrest        number
--         radiantSparkDust     number
--       stats             table
--         stamina              number
--         strength             number
--         agility              number
--         intellect            number
--         critPercent          number
--         hastePercent         number
--         masteryPercent       number
--         versatilityPercent   number
-- ============================================================

local DB_VERSION            = 2
local SNAPSHOT_INTERVAL     = 15 * 60  -- seconds
local DEFAULT_MINIMAP_POS   = 225
local MINIMAP_BUTTON_RADIUS = 5
local MPLUS_SYNC_INTERVAL   = 30       -- seconds

-- Midnight S1 currency IDs.
local CURRENCY_IDS = {
    adventurerDawncrest = 3391,  -- Adventurer Dawncrest  (Midnight S1)
    veteranDawncrest    = 3341,  -- Veteran Dawncrest     (Midnight S1)
    championDawncrest   = 3343,  -- Champion Dawncrest    (Midnight S1)
    heroDawncrest       = 3345,  -- Hero Dawncrest        (Midnight S1)
    mythDawncrest       = 3347,  -- Myth Dawncrest        (Midnight S1)
    radiantSparkDust    = 3212,  -- Radiant Spark Dust    (Midnight S1)
}

local pendingSnapshot      = nil
local nextSnapshotAt       = 0      -- GetTime() when next auto-snapshot fires
local snapshotTicker       = nil    -- C_Timer handle, cancelled on force-refresh
local refreshCooldownUntil = 0      -- GetTime() when force-refresh cooldown ends
local lastSnapshotAt       = 0      -- GetTime() when last snapshot was committed
local waitingForPlaytime   = false
local queuedFreshSnapshot  = false
local suppressedTimePlayedFrames = nil
local initialized          = false  -- true after first PLAYER_ENTERING_WORLD
local pendingMPlusSync     = false
local lastMPlusSyncAt      = 0

-- UI widgets — assigned after frames are built; used by the ticker
local timerLabel = nil
local refreshBtn = nil
local minimapToggle = nil
local RefreshLog = nil  -- assigned after Snapshots panel is built
local StartSnapshotTicker = nil

local function GetCharKey()
    local name, realm = UnitFullName("player")
    realm = (realm and realm ~= "") and realm or GetRealmName()
    return name .. "-" .. realm, name, realm
end

local function GetRegion()
    if GetCurrentRegionName then
        return GetCurrentRegionName():lower()
    end
    return "us"
end

local function PrintAddonMessage(message)
    print("|cff00ccff[WoW Dashboard]|r " .. message)
end

local function GetCharacterIdentity()
    local key, name, realm = GetCharKey()
    local _, classFilename = UnitClass("player")
    local _, raceFilename  = UnitRace("player")
    local factionGroup     = UnitFactionGroup("player") or "Alliance"

    return key, name, realm, {
        region  = GetRegion(),
        class   = classFilename or "UNKNOWN",
        race    = raceFilename or "UNKNOWN",
        faction = factionGroup:lower(),
    }
end

local GetRunSortValue
local NormalizeStoredMythicPlusRun

local function EnsureCharacterEntry(key, name, realm, charInfo)
    local db = WowDashboardDB
    if not db.characters then
        db.characters = {}
    end

    local entry = db.characters[key]
    if not entry then
        entry = {
            name              = name,
            realm             = realm,
            region            = charInfo.region,
            class             = charInfo.class,
            race              = charInfo.race,
            faction           = charInfo.faction,
            snapshots         = {},
            mythicPlusRuns    = {},
            mythicPlusRunKeys = {},
            mythicPlusDebug   = {},
        }
        db.characters[key] = entry
    else
        entry.region  = charInfo.region
        entry.class   = charInfo.class
        entry.race    = charInfo.race
        entry.faction = charInfo.faction
        if type(entry.snapshots) ~= "table" then
            entry.snapshots = {}
        end
        if type(entry.mythicPlusRuns) ~= "table" then
            entry.mythicPlusRuns = {}
        end
        if type(entry.mythicPlusRunKeys) ~= "table" then
            entry.mythicPlusRunKeys = {}
        end
        if type(entry.mythicPlusDebug) ~= "table" then
            entry.mythicPlusDebug = {}
        end
    end

    local normalizedRuns = {}
    local normalizedKeys = {}
    for _, run in ipairs(entry.mythicPlusRuns) do
        local normalized = NormalizeStoredMythicPlusRun(run)
        if normalized and normalized.fingerprint and not normalizedKeys[normalized.fingerprint] then
            normalizedKeys[normalized.fingerprint] = true
            normalizedRuns[#normalizedRuns + 1] = normalized
        end
    end
    table.sort(normalizedRuns, function(a, b)
        return GetRunSortValue(a) > GetRunSortValue(b)
    end)
    entry.mythicPlusRuns = normalizedRuns
    entry.mythicPlusRunKeys = normalizedKeys

    return entry
end

local function IsSequentialArray(value)
    if type(value) ~= "table" then
        return false
    end

    local count = 0
    local maxIndex = 0
    for key in pairs(value) do
        if type(key) ~= "number" or key < 1 or math.floor(key) ~= key then
            return false
        end
        count = count + 1
        if key > maxIndex then
            maxIndex = key
        end
    end

    return maxIndex == count
end

local function CopySavedVarValue(value, depth, seen)
    local valueType = type(value)
    if valueType == "nil" or valueType == "number" or valueType == "string" or valueType == "boolean" then
        return value
    end
    if valueType ~= "table" or depth <= 0 then
        return nil
    end
    if seen[value] then
        return nil
    end

    seen[value] = true
    local out = {}

    if IsSequentialArray(value) then
        for i = 1, #value do
            out[#out + 1] = CopySavedVarValue(value[i], depth - 1, seen)
        end
    else
        local keys = {}
        for key in pairs(value) do
            if type(key) == "string" or type(key) == "number" then
                keys[#keys + 1] = key
            end
        end
        table.sort(keys, function(a, b)
            if type(a) == type(b) then
                return a < b
            end
            return tostring(a) < tostring(b)
        end)

        for _, key in ipairs(keys) do
            local child = CopySavedVarValue(value[key], depth - 1, seen)
            if child ~= nil then
                out[key] = child
            end
        end
    end

    seen[value] = nil
    return out
end

local function StableSerialize(value)
    local valueType = type(value)
    if valueType == "nil" then
        return "nil"
    end
    if valueType == "number" then
        return string.format("%.17g", value)
    end
    if valueType == "boolean" then
        return value and "true" or "false"
    end
    if valueType == "string" then
        return string.format("%q", value)
    end
    if valueType ~= "table" then
        return string.format("%q", "<" .. valueType .. ">")
    end

    local parts = {}
    if IsSequentialArray(value) then
        for i = 1, #value do
            parts[#parts + 1] = StableSerialize(value[i])
        end
        return "[" .. table.concat(parts, ",") .. "]"
    end

    local keys = {}
    for key in pairs(value) do
        keys[#keys + 1] = key
    end
    table.sort(keys, function(a, b)
        if type(a) == type(b) then
            return a < b
        end
        return tostring(a) < tostring(b)
    end)

    for _, key in ipairs(keys) do
        parts[#parts + 1] = StableSerialize(key) .. ":" .. StableSerialize(value[key])
    end
    return "{" .. table.concat(parts, ",") .. "}"
end

local function GetFirstField(record, fieldNames)
    if type(record) ~= "table" then
        return nil
    end

    for _, fieldName in ipairs(fieldNames) do
        local value = record[fieldName]
        if value ~= nil then
            return value
        end
    end

    return nil
end

GetRunSortValue = function(run)
    return tonumber(run.completedAt)
        or tonumber(run.completionDate)
        or tonumber(run.startDate)
        or tonumber(run.observedAt)
        or 0
end

local function ToFingerprintToken(value)
    if value == nil then
        return ""
    end
    if type(value) == "boolean" then
        return value and "1" or "0"
    end
    if type(value) == "number" then
        return string.format("%.17g", value)
    end
    return tostring(value)
end

local function BuildRunFingerprint(run)
    return table.concat({
        ToFingerprintToken(run.seasonID),
        ToFingerprintToken(run.mapChallengeModeID),
        ToFingerprintToken(run.level),
        ToFingerprintToken(run.completed),
        ToFingerprintToken(run.completedInTime),
        ToFingerprintToken(run.durationMs),
        ToFingerprintToken(run.runScore),
        ToFingerprintToken(run.completedAt),
        ToFingerprintToken(run.startDate),
    }, "|")
end

NormalizeStoredMythicPlusRun = function(run)
    if type(run) ~= "table" then
        return nil
    end

    if run.durationMs == nil then
        local durationSeconds = GetFirstField(run, {
            "durationSec",
            "durationSeconds",
            "time",
            "runDuration",
        })
        if type(durationSeconds) == "number" then
            run.durationMs = math.floor(durationSeconds * 1000 + 0.5)
        end
    end

    if run.completedAt == nil then
        run.completedAt = GetFirstField(run, {
            "completionDate",
            "completedDate",
            "endTime",
            "startDate",
        })
    end

    if run.mapChallengeModeID == nil then
        run.mapChallengeModeID = GetFirstField(run, { "challengeModeID", "mapID" })
    end

    if run.level == nil then
        run.level = GetFirstField(run, { "keystoneLevel" })
    end

    if run.completed == nil then
        run.completed = GetFirstField(run, { "finishedSuccess", "isCompleted" })
    end

    if run.completedInTime == nil then
        run.completedInTime = GetFirstField(run, { "intime", "onTime" })
    end

    if run.runScore == nil then
        run.runScore = GetFirstField(run, { "score", "mythicRating" })
    end

    run.fingerprint = BuildRunFingerprint(run)
    return run
end

local function CaptureApiCall(label, apiFunc, ...)
    local call = {
        label        = label,
        args         = { ... },
        ok           = false,
        returnCount  = 0,
        returnTypes  = {},
        arrayResults = {},
        scalarValues = {},
    }

    if type(apiFunc) ~= "function" then
        call.error = "unavailable"
        return call
    end

    local packed = { pcall(apiFunc, ...) }
    call.ok = table.remove(packed, 1)
    if not call.ok then
        call.error = tostring(packed[1])
        return call
    end

    call.rawResults = packed
    call.returnCount = #packed

    for index, value in ipairs(packed) do
        local valueType = type(value)
        if valueType == "table" and IsSequentialArray(value) then
            local sample = nil
            if type(value[1]) == "table" then
                sample = CopySavedVarValue(value[1], 3, {})
            else
                sample = CopySavedVarValue(value[1], 2, {}) or value[1]
            end
            call.returnTypes[index] = "array(" .. tostring(#value) .. ")"
            call.arrayResults[#call.arrayResults + 1] = {
                index = index,
                count = #value,
                sample = sample,
            }
        else
            call.returnTypes[index] = valueType
            call.scalarValues[index] = CopySavedVarValue(value, 2, {}) or value
        end
    end

    return call
end

local function BuildCallDebugRecord(call)
    return {
        label        = call.label,
        args         = call.args,
        ok           = call.ok,
        error        = call.error,
        returnCount  = call.returnCount,
        returnTypes  = call.returnTypes,
        arrayResults = call.arrayResults,
        scalarValues = call.scalarValues,
    }
end

local function NormalizeMythicPlusRun(rawRun, sourceLabel, seasonID)
    if type(rawRun) ~= "table" then
        return nil
    end

    local raw = CopySavedVarValue(rawRun, 4, {}) or {}
    local durationMs = GetFirstField(raw, {
        "durationMs",
        "completionMilliseconds",
        "mapChallengeModeDuration",
        "runDurationMs",
    })
    if durationMs == nil then
        local durationSeconds = GetFirstField(raw, {
            "durationSec",
            "durationSeconds",
            "time",
            "runDuration",
        })
        if type(durationSeconds) == "number" then
            durationMs = math.floor(durationSeconds * 1000 + 0.5)
        end
    end

    local completedAt = GetFirstField(raw, {
        "completedAt",
        "completionDate",
        "completedDate",
        "endTime",
        "startDate",
    })

    local run = {
        source              = sourceLabel,
        observedAt          = time(),
        seasonID            = seasonID,
        mapChallengeModeID  = GetFirstField(raw, { "mapChallengeModeID", "challengeModeID", "mapID" }),
        level               = GetFirstField(raw, { "level", "keystoneLevel" }),
        completed           = GetFirstField(raw, { "completed", "finishedSuccess", "isCompleted" }),
        completedInTime     = GetFirstField(raw, { "completedInTime", "intime", "onTime" }),
        durationMs          = durationMs,
        runScore            = GetFirstField(raw, { "runScore", "score", "mythicRating" }),
        startDate           = GetFirstField(raw, { "startDate", "startedAt" }),
        completedAt         = completedAt,
        thisWeek            = GetFirstField(raw, { "thisWeek", "isThisWeek" }),
        members             = GetFirstField(raw, { "members", "partyMembers" }),
        raw                 = raw,
    }

    run.fingerprint = BuildRunFingerprint(run)

    return run
end

local function SelectBestRunHistoryCall(calls)
    local bestCall = nil
    local bestRuns = nil
    local bestIndex = nil
    local bestCount = -1

    for _, call in ipairs(calls) do
        if call.ok and type(call.rawResults) == "table" then
            for index, value in ipairs(call.rawResults) do
                if type(value) == "table" and IsSequentialArray(value) then
                    local count = #value
                    local firstValue = value[1]
                    if count == 0 or type(firstValue) == "table" then
                        if count > bestCount then
                            bestCall = call
                            bestRuns = value
                            bestIndex = index
                            bestCount = count
                        end
                    end
                end
            end
        end
    end

    return bestCall, bestRuns or {}, bestIndex
end

local function CollectMythicPlusHistory(reason)
    local calls = {}
    local debugCalls = {}

    local function AddCall(label, apiFunc, ...)
        local call = CaptureApiCall(label, apiFunc, ...)
        calls[#calls + 1] = call
        debugCalls[#debugCalls + 1] = BuildCallDebugRecord(call)
    end

    local score = 0
    if C_ChallengeMode and C_ChallengeMode.GetOverallDungeonScore then
        score = C_ChallengeMode.GetOverallDungeonScore() or 0
    end

    local seasonID = nil
    if C_MythicPlus and type(C_MythicPlus.GetCurrentSeason) == "function" then
        local ok, result = pcall(C_MythicPlus.GetCurrentSeason)
        if ok then
            seasonID = result
        end
    end

    AddCall("C_MythicPlus.GetRunHistory()", C_MythicPlus and C_MythicPlus.GetRunHistory)
    AddCall("C_MythicPlus.GetRunHistory(false, false)", C_MythicPlus and C_MythicPlus.GetRunHistory, false, false)
    AddCall("C_MythicPlus.GetRunHistory(true, false)", C_MythicPlus and C_MythicPlus.GetRunHistory, true, false)
    AddCall("C_MythicPlus.GetRunHistory(false, true)", C_MythicPlus and C_MythicPlus.GetRunHistory, false, true)
    AddCall("C_MythicPlus.GetRunHistory(true, true)", C_MythicPlus and C_MythicPlus.GetRunHistory, true, true)
    AddCall("C_MythicPlus.GetCurrentSeason()", C_MythicPlus and C_MythicPlus.GetCurrentSeason)
    AddCall("C_MythicPlus.GetCurrentSeasonValues()", C_MythicPlus and C_MythicPlus.GetCurrentSeasonValues)
    AddCall("C_ChallengeMode.GetMapTable()", C_ChallengeMode and C_ChallengeMode.GetMapTable)
    AddCall("C_ChallengeMode.GetOverallDungeonScore()", C_ChallengeMode and C_ChallengeMode.GetOverallDungeonScore)

    local selectedCall, rawRuns, selectedIndex = SelectBestRunHistoryCall(calls)
    local normalizedRuns = {}
    for _, rawRun in ipairs(rawRuns) do
        local normalized = NormalizeMythicPlusRun(rawRun, selectedCall and selectedCall.label or "unknown", seasonID)
        if normalized then
            normalizedRuns[#normalizedRuns + 1] = normalized
        end
    end

    return normalizedRuns, {
        takenAt             = time(),
        reason              = reason,
        score               = score,
        seasonID            = seasonID,
        selectedSource      = selectedCall and selectedCall.label or nil,
        selectedReturnIndex = selectedIndex,
        selectedRunCount    = #normalizedRuns,
        selectedRunSample   = normalizedRuns[1] and CopySavedVarValue(normalizedRuns[1], 3, {}) or nil,
        calls               = debugCalls,
    }
end

local function PrintMythicPlusProbe(debugInfo)
    if not debugInfo then
        PrintAddonMessage("No Mythic+ probe data captured yet.")
        return
    end

    PrintAddonMessage(string.format(
        "Mythic+ probe: score=%s season=%s source=%s runs=%d",
        tostring(debugInfo.score or "nil"),
        tostring(debugInfo.seasonID or "nil"),
        tostring(debugInfo.selectedSource or "none"),
        tonumber(debugInfo.selectedRunCount or 0)
    ))

    for _, call in ipairs(debugInfo.calls or {}) do
        if call.ok then
            PrintAddonMessage(string.format(
                "%s -> %s",
                call.label,
                table.concat(call.returnTypes or {}, ", ")
            ))
        else
            PrintAddonMessage(string.format("%s -> error: %s", call.label, tostring(call.error)))
        end
    end
end

local function SyncMythicPlusHistory(reason, options)
    options = options or {}
    if not IsLoggedIn() then
        return false
    end

    local key, name, realm, charInfo = GetCharacterIdentity()
    local entry = EnsureCharacterEntry(key, name, realm, charInfo)
    local beforeCount = #entry.mythicPlusRuns
    local runs, debugInfo = CollectMythicPlusHistory(reason)
    local added = 0

    for _, run in ipairs(runs) do
        if run.fingerprint and not entry.mythicPlusRunKeys[run.fingerprint] then
            entry.mythicPlusRunKeys[run.fingerprint] = true
            entry.mythicPlusRuns[#entry.mythicPlusRuns + 1] = run
            added = added + 1
        end
    end

    if added > 0 then
        table.sort(entry.mythicPlusRuns, function(a, b)
            return GetRunSortValue(a) > GetRunSortValue(b)
        end)
    end

    entry.mythicPlusDebug.lastProbe = debugInfo
    entry.mythicPlusDebug.lastSyncAt = debugInfo.takenAt
    entry.mythicPlusDebug.lastSyncReason = reason
    entry.mythicPlusDebug.lastAdded = added
    entry.mythicPlusDebug.totalStoredRuns = #entry.mythicPlusRuns
    lastMPlusSyncAt = GetTime()

    if options.verbose or added > 0 then
        PrintAddonMessage(string.format(
            "Mythic+ history sync complete: +%d new runs, %d total stored.",
            added,
            #entry.mythicPlusRuns
        ))
    end
    if options.printProbe then
        PrintMythicPlusProbe(debugInfo)
    end

    return added > 0 or beforeCount ~= #entry.mythicPlusRuns
end

local function ScheduleMythicPlusHistorySync(reason, delaySeconds, options)
    options = options or {}
    delaySeconds = delaySeconds or 0

    if pendingMPlusSync and not options.force then
        return
    end
    if not options.force and lastMPlusSyncAt > 0 and (GetTime() - lastMPlusSyncAt) < MPLUS_SYNC_INTERVAL then
        return
    end

    pendingMPlusSync = true
    C_Timer.After(delaySeconds, function()
        pendingMPlusSync = false
        SyncMythicPlusHistory(reason, options)
    end)
end

local function DumpStoredMythicPlusRuns(limit)
    if not IsLoggedIn() then
        PrintAddonMessage("You must be logged in to inspect Mythic+ history.")
        return
    end

    limit = math.max(1, math.floor(tonumber(limit) or 5))

    local key, name, realm, charInfo = GetCharacterIdentity()
    local entry = EnsureCharacterEntry(key, name, realm, charInfo)
    local runs = entry.mythicPlusRuns or {}
    if #runs == 0 then
        PrintAddonMessage("No stored Mythic+ runs for this character yet.")
        return
    end

    PrintAddonMessage(string.format("Showing %d of %d stored Mythic+ runs for %s.", math.min(limit, #runs), #runs, key))
    for i = 1, math.min(limit, #runs) do
        local run = runs[i]
        PrintAddonMessage(string.format(
            "#%d map=%s key=%s completed=%s intime=%s score=%s durationMs=%s source=%s",
            i,
            tostring(run.mapChallengeModeID or "nil"),
            tostring(run.level or "nil"),
            tostring(run.completed),
            tostring(run.completedInTime),
            tostring(run.runScore or "nil"),
            tostring(run.durationMs or "nil"),
            tostring(run.source or "unknown")
        ))
    end
end

local function BuildPendingSnapshot()
    local key, name, realm, charInfo = GetCharacterIdentity()

    local specIndex      = GetSpecialization()
    if not specIndex or specIndex <= 0 then return nil end
    local _, sName, _, _, sRole = GetSpecializationInfo(specIndex)
    if not sName then return nil end
    local specName = sName
    local role     = "dps"
    if     sRole == "TANK"   then role = "tank"
    elseif sRole == "HEALER" then role = "healer"
    end

    local _, equippedIlvl = GetAverageItemLevel()

    local currencies = {}
    for fieldName, currencyID in pairs(CURRENCY_IDS) do
        local info            = C_CurrencyInfo.GetCurrencyInfo(currencyID)
        currencies[fieldName] = info and info.quantity or 0
    end

    local stats = {
        stamina            = UnitStat("player", LE_UNIT_STAT_STAMINA)   or 0,
        strength           = UnitStat("player", LE_UNIT_STAT_STRENGTH)  or 0,
        agility            = UnitStat("player", LE_UNIT_STAT_AGILITY)   or 0,
        intellect          = UnitStat("player", LE_UNIT_STAT_INTELLECT) or 0,
        critPercent        = GetCritChance()    or 0,
        hastePercent       = GetMeleeHaste()    or 0,
        masteryPercent     = GetMasteryEffect() or 0,
        versatilityPercent = GetCombatRatingBonus(CR_VERSATILITY_DAMAGE_DONE) or 0,
    }

    local mplusScore = 0
    if C_ChallengeMode and C_ChallengeMode.GetOverallDungeonScore then
        mplusScore = C_ChallengeMode.GetOverallDungeonScore() or 0
    end

    return {
        key      = key,
        name     = name,
        realm    = realm,
        charInfo = charInfo,
        snap = {
            takenAt         = time(),
            level           = UnitLevel("player"),
            spec            = specName,
            role            = role,
            itemLevel       = math.floor((equippedIlvl or 0) * 100 + 0.5) / 100,
            gold            = GetMoney() / 10000,
            playtimeSeconds = 0,
            mythicPlusScore = mplusScore,
            currencies      = currencies,
            stats           = stats,
        },
    }
end

local function SuppressTimePlayedMessages()
    if suppressedTimePlayedFrames then
        return
    end

    suppressedTimePlayedFrames = {}
    for i = 1, NUM_CHAT_WINDOWS do
        local frame = _G["ChatFrame" .. i]
        if frame and frame:IsEventRegistered("TIME_PLAYED_MSG") then
            suppressedTimePlayedFrames[#suppressedTimePlayedFrames + 1] = frame
            frame:UnregisterEvent("TIME_PLAYED_MSG")
        end
    end
end

local function RestoreTimePlayedMessages()
    if not suppressedTimePlayedFrames then
        return
    end

    for _, frame in ipairs(suppressedTimePlayedFrames) do
        if frame then
            frame:RegisterEvent("TIME_PLAYED_MSG")
        end
    end
    suppressedTimePlayedFrames = nil
end

local function CommitSnapshot(totalSeconds)
    if not pendingSnapshot then return end
    local p         = pendingSnapshot
    pendingSnapshot = nil
    p.snap.playtimeSeconds = totalSeconds or 0

    local db = WowDashboardDB
    local entry = EnsureCharacterEntry(p.key, p.name, p.realm, p.charInfo)

    table.insert(entry.snapshots, p.snap)
    lastSnapshotAt = GetTime()
    if RefreshLog then
        RefreshLog()
    end
end

local function CollectSnapshot(forceFresh)
    if not IsLoggedIn() then return false end
    if waitingForPlaytime then
        if forceFresh then
            queuedFreshSnapshot = true
            return true
        end
        return false
    end
    if pendingSnapshot and not forceFresh then return false end

    local snapshot = BuildPendingSnapshot()
    if not snapshot then return false end
    pendingSnapshot = snapshot

    -- Suppress the default chat output by temporarily unregistering
    -- all chat frames from TIME_PLAYED_MSG before requesting.
    SuppressTimePlayedMessages()
    waitingForPlaytime = true
    RequestTimePlayed()
    return true
end

local function RequestFreshSnapshot()
    local requested = CollectSnapshot(true)
    if requested then
        StartSnapshotTicker()
    end
    return requested
end

StartSnapshotTicker = function()
    if snapshotTicker then snapshotTicker:Cancel() end
    nextSnapshotAt = GetTime() + SNAPSHOT_INTERVAL
    snapshotTicker = C_Timer.NewTicker(SNAPSHOT_INTERVAL, function()
        CollectSnapshot()
        nextSnapshotAt = GetTime() + SNAPSHOT_INTERVAL
    end)
end

-- ============================================================
-- Main Window
-- ============================================================

local LEFT_W, RIGHT_W, HEIGHT = 206, 500, 450

local MainFrame = CreateFrame("Frame", "WowDashboardFrame", UIParent)
MainFrame:SetSize(LEFT_W + RIGHT_W, HEIGHT)
MainFrame:SetPoint("CENTER")
MainFrame:SetMovable(true)
MainFrame:EnableMouse(true)
MainFrame:RegisterForDrag("LeftButton")
MainFrame:SetScript("OnDragStart", MainFrame.StartMoving)
MainFrame:SetScript("OnDragStop",  MainFrame.StopMovingOrSizing)
MainFrame:SetClampedToScreen(true)
MainFrame:Hide()

table.insert(UISpecialFrames, "WowDashboardFrame")

MainFrame:SetScript("OnShow", function()
    if WowDashboardDB then
        WowDashboardDB.panelOpen = true
    end
end)

MainFrame:SetScript("OnHide", function()
    if WowDashboardDB then
        WowDashboardDB.panelOpen = false
    end
end)

local function SetDashboardShown(shown)
    MainFrame:SetShown(shown)
end

local function ToggleDashboard()
    SetDashboardShown(not MainFrame:IsShown())
end

-- ============================================================
-- Minimap Button
-- ============================================================

local minimapShapes = {
    ["ROUND"] = { true, true, true, true },
    ["SQUARE"] = { false, false, false, false },
    ["CORNER-TOPLEFT"] = { false, false, false, true },
    ["CORNER-TOPRIGHT"] = { false, false, true, false },
    ["CORNER-BOTTOMLEFT"] = { false, true, false, false },
    ["CORNER-BOTTOMRIGHT"] = { true, false, false, false },
    ["SIDE-LEFT"] = { false, true, false, true },
    ["SIDE-RIGHT"] = { true, false, true, false },
    ["SIDE-TOP"] = { false, false, true, true },
    ["SIDE-BOTTOM"] = { true, true, false, false },
    ["TRICORNER-TOPLEFT"] = { false, true, true, true },
    ["TRICORNER-TOPRIGHT"] = { true, false, true, true },
    ["TRICORNER-BOTTOMLEFT"] = { true, true, false, true },
    ["TRICORNER-BOTTOMRIGHT"] = { true, true, true, false },
}

local MinimapButton = nil

local function EnsureMinimapSettings()
    if type(WowDashboardDB.minimap) ~= "table" then
        WowDashboardDB.minimap = {}
    end
    if WowDashboardDB.minimap.minimapPos == nil then
        WowDashboardDB.minimap.minimapPos = DEFAULT_MINIMAP_POS
    end
    if WowDashboardDB.minimap.hide == nil then
        WowDashboardDB.minimap.hide = false
    end
end

local function UpdateMinimapButtonPosition(position)
    if not MinimapButton then return end

    local angle = math.rad(position or DEFAULT_MINIMAP_POS)
    local x, y = math.cos(angle), math.sin(angle)
    local quadrant = 1

    if x < 0 then quadrant = quadrant + 1 end
    if y > 0 then quadrant = quadrant + 2 end

    local minimapShape = GetMinimapShape and GetMinimapShape() or "ROUND"
    local quadrantInfo = minimapShapes[minimapShape] or minimapShapes["ROUND"]
    local w = (Minimap:GetWidth() / 2) + MINIMAP_BUTTON_RADIUS
    local h = (Minimap:GetHeight() / 2) + MINIMAP_BUTTON_RADIUS

    if quadrantInfo[quadrant] then
        x, y = x * w, y * h
    else
        local diagRadiusW = math.sqrt(2 * (w ^ 2)) - 10
        local diagRadiusH = math.sqrt(2 * (h ^ 2)) - 10
        x = math.max(-w, math.min(x * diagRadiusW, w))
        y = math.max(-h, math.min(y * diagRadiusH, h))
    end

    MinimapButton:ClearAllPoints()
    MinimapButton:SetPoint("CENTER", Minimap, "CENTER", x, y)
end

local function RefreshMinimapButton()
    if not MinimapButton or not WowDashboardDB or not WowDashboardDB.minimap then return end

    UpdateMinimapButtonPosition(WowDashboardDB.minimap.minimapPos)
    MinimapButton:SetShown(not WowDashboardDB.minimap.hide)

    if minimapToggle then
        minimapToggle:SetChecked(not WowDashboardDB.minimap.hide)
    end
end

local function UpdateDraggedMinimapButtonPosition()
    local mx, my = Minimap:GetCenter()
    local px, py = GetCursorPosition()
    local scale = Minimap:GetEffectiveScale()

    px, py = px / scale, py / scale

    local position = math.deg(math.atan2(py - my, px - mx)) % 360
    WowDashboardDB.minimap.minimapPos = position
    UpdateMinimapButtonPosition(position)
end

local function CreateMinimapButton()
    if MinimapButton then return MinimapButton end

    local button = CreateFrame("Button", "WowDashboardMinimapButton", Minimap)
    button:SetFrameStrata("MEDIUM")
    button:SetFrameLevel(8)
    button:SetSize(31, 31)
    button:RegisterForClicks("AnyUp")
    button:RegisterForDrag("LeftButton")
    button:SetHighlightTexture(136477)

    local overlay = button:CreateTexture(nil, "OVERLAY")
    overlay:SetSize(50, 50)
    overlay:SetTexture(136430)
    overlay:SetPoint("TOPLEFT", button, "TOPLEFT")

    local background = button:CreateTexture(nil, "BACKGROUND")
    background:SetSize(24, 24)
    background:SetTexture(136467)
    background:SetPoint("CENTER", button, "CENTER")

    local icon = button:CreateTexture(nil, "ARTWORK")
    icon:SetSize(18, 18)
    icon:SetTexture(MINIMAP_ICON)
    icon:SetPoint("CENTER", button, "CENTER")

    button:SetScript("OnClick", function(_, mouseButton)
        if mouseButton == "RightButton" then
            ReloadUI()
            return
        end

        if mouseButton == "MiddleButton" then
            RequestFreshSnapshot()
            return
        end

        ToggleDashboard()
    end)

    button:SetScript("OnEnter", function(self)
        GameTooltip:SetOwner(self, "ANCHOR_LEFT")
        GameTooltip:SetText("WoW Dashboard", 1, 1, 1)
        GameTooltip:AddLine("|cff00ff00Left click|r to open WoW Dashboard.", NORMAL_FONT_COLOR.r, NORMAL_FONT_COLOR.g, NORMAL_FONT_COLOR.b)
        GameTooltip:AddLine("|cff00ff00Middle click|r to save a fresh snapshot.", NORMAL_FONT_COLOR.r, NORMAL_FONT_COLOR.g, NORMAL_FONT_COLOR.b)
        GameTooltip:AddLine("|cff00ff00Right click|r to reload and flush SavedVariables to disk.", NORMAL_FONT_COLOR.r, NORMAL_FONT_COLOR.g, NORMAL_FONT_COLOR.b)
        GameTooltip:Show()
    end)
    button:SetScript("OnLeave", GameTooltip_Hide)
    button:SetScript("OnDragStart", function(self)
        self:LockHighlight()
        self:SetScript("OnUpdate", UpdateDraggedMinimapButtonPosition)
        GameTooltip:Hide()
    end)
    button:SetScript("OnDragStop", function(self)
        self:SetScript("OnUpdate", nil)
        self:UnlockHighlight()
    end)
    button:Hide()

    MinimapButton = button
    return button
end

-- ============================================================
-- Left Section
-- ============================================================

local LeftSection = BuildSection(MainFrame, LEFT_W, HEIGHT, false)
LeftSection:SetPoint("TOPLEFT", MainFrame, "TOPLEFT")

BuildCategoryBar(LeftSection, "Information", 38)
BuildInfoRow(LeftSection, "Version",    "1.0.0",         78)
BuildInfoRow(LeftSection, "Author",     "wow-dashboard", 96)
BuildInfoRow(LeftSection, "Interface",  "120001",       114)
BuildInfoRow(LeftSection, "Expansion",  "TWW",          132)

BuildCategoryBar(LeftSection, "Commands", 158)
BuildInfoRow(LeftSection, "/wowdashboard", "open/help", 198)
BuildInfoRow(LeftSection, "/wd mplus",     "probe",     216)

-- ============================================================
-- Right Section
-- ============================================================

local RightSection = BuildSection(MainFrame, RIGHT_W, HEIGHT, true)
RightSection:SetPoint("TOPLEFT", LeftSection, "TOPRIGHT")

local twwBG = RightSection.NineSlice.Background
twwBG:SetAtlas("thewarwithin-landingpage-background", false)
twwBG:SetVertexColor(0.25, 0.25, 0.25)

RightSection.NineSlice.CloseButton:SetScript("OnClick", function()
    SetDashboardShown(false)
end)

-- Header title
local headerTitle = RightSection:CreateFontString(nil, "OVERLAY")
headerTitle:SetFont(FONT_BOLD, 18, "")
headerTitle:SetTextColor(1, 0.82, 0)
headerTitle:SetPoint("TOPLEFT", RightSection, "TOPLEFT", 36, -36)
headerTitle:SetText("WoW Dashboard")

-- Divider below header
-- Divider frame is 4px tall, anchored at y=-66 → bottom edge at y=-68
local div = CreateMajorDivider(RightSection)
div:SetPoint("LEFT",  RightSection, "LEFT",  36, -66)
div:SetPoint("RIGHT", RightSection, "RIGHT", -36, -66)

-- ============================================================
-- Tab Bar  (positioned 8px below divider bottom → y=-78 from top)
-- Tabs are 26px tall, so content area starts at y=-108
-- ============================================================

-- Content panels share the same anchor (one shown at a time)
local overviewPanel = CreateFrame("Frame", nil, RightSection)
overviewPanel:SetPoint("TOPLEFT",     RightSection, "TOPLEFT",     36, -108)
overviewPanel:SetPoint("BOTTOMRIGHT", RightSection, "BOTTOMRIGHT", -36, 30)

local snapshotsPanel = CreateFrame("Frame", nil, RightSection)
snapshotsPanel:SetPoint("TOPLEFT",     RightSection, "TOPLEFT",     36, -108)
snapshotsPanel:SetPoint("BOTTOMRIGHT", RightSection, "BOTTOMRIGHT", -36, 30)
snapshotsPanel:Hide()

-- Tab state
local currentTab = "overview"

local tabBtnOverview  = CreateFrame("Button", nil, RightSection)
local tabBtnSnapshots = CreateFrame("Button", nil, RightSection)

local function UpdateTabVisuals()
    if currentTab == "overview" then
        tabBtnOverview.lbl:SetTextColor(1, 1, 1)
        tabBtnOverview.bar:Show()
        tabBtnSnapshots.lbl:SetTextColor(1, 0.82, 0)
        tabBtnSnapshots.bar:Hide()
    else
        tabBtnOverview.lbl:SetTextColor(1, 0.82, 0)
        tabBtnOverview.bar:Hide()
        tabBtnSnapshots.lbl:SetTextColor(1, 1, 1)
        tabBtnSnapshots.bar:Show()
    end
end

local function SelectTab(which)
    currentTab = which
    UpdateTabVisuals()
    overviewPanel:SetShown(which == "overview")
    snapshotsPanel:SetShown(which == "snapshots")
    if which == "snapshots" and RefreshLog then RefreshLog() end
end

local function SetupTabButton(btn, label, xOffset)
    btn:SetSize(110, 26)
    btn:SetPoint("TOPLEFT", RightSection, "TOPLEFT", xOffset, -78)

    btn.lbl = btn:CreateFontString(nil, "OVERLAY")
    btn.lbl:SetFont(FONT_BOLD, 12, "")
    btn.lbl:SetTextColor(1, 0.82, 0)
    btn.lbl:SetPoint("CENTER", btn, "CENTER", 0, 1)
    btn.lbl:SetText(label)

    -- Active-tab underline bar
    btn.bar = btn:CreateTexture(nil, "BORDER")
    btn.bar:SetSize(90, 2)
    btn.bar:SetPoint("BOTTOM", btn, "BOTTOM", 0, 2)
    btn.bar:SetColorTexture(1, 1, 1, 0.85)
    btn.bar:Hide()

    btn:SetScript("OnEnter", function(self) self.lbl:SetTextColor(1, 1, 1) end)
    btn:SetScript("OnLeave", function() UpdateTabVisuals() end)
end

SetupTabButton(tabBtnOverview,  "Overview",  36)
SetupTabButton(tabBtnSnapshots, "Snapshots", 148)
tabBtnOverview:SetScript("OnClick",  function() SelectTab("overview")   end)
tabBtnSnapshots:SetScript("OnClick", function() SelectTab("snapshots")  end)
UpdateTabVisuals()

-- ============================================================
-- Overview Panel — existing content + timer + force-refresh
-- ============================================================

-- Timer countdown
timerLabel = overviewPanel:CreateFontString(nil, "OVERLAY")
timerLabel:SetFont(FONT_BOLD, 13, "")
timerLabel:SetTextColor(0.804, 0.667, 0.498)
timerLabel:SetPoint("CENTER", overviewPanel, "CENTER", 0, 16)
timerLabel:SetText("Next snapshot in  --:--")

-- Force-snapshot button (15-second cooldown)
refreshBtn = CreateFrame("Button", nil, overviewPanel, "UIPanelButtonTemplate")
refreshBtn:SetSize(160, 30)
refreshBtn:SetPoint("TOP", timerLabel, "BOTTOM", 0, -14)
refreshBtn:SetText("Force Snapshot")
refreshBtn:GetFontString():SetFont(FONT_BOLD, 11, "")
refreshBtn:SetFrameLevel(overviewPanel:GetFrameLevel() + 2)
refreshBtn:SetScript("OnClick", function()
    if GetTime() < refreshCooldownUntil then return end
    refreshCooldownUntil = GetTime() + 15
    RequestFreshSnapshot()
end)

-- Manual snapshot button
local uploadBtn = CreateFrame("Button", nil, overviewPanel, "UIPanelButtonTemplate")
uploadBtn:SetSize(160, 30)
uploadBtn:SetPoint("TOP", refreshBtn, "BOTTOM", 0, -10)
uploadBtn:SetText("Save Snapshot")
uploadBtn:GetFontString():SetFont(FONT_BOLD, 11, "")
uploadBtn:SetFrameLevel(overviewPanel:GetFrameLevel() + 2)
uploadBtn:SetScript("OnClick", function()
    RequestFreshSnapshot()
end)

minimapToggle = CreateFrame("CheckButton", nil, overviewPanel, "UICheckButtonTemplate")
minimapToggle:SetPoint("TOPLEFT", uploadBtn, "BOTTOMLEFT", 0, -18)
minimapToggle:SetSize(24, 24)
minimapToggle.Label = overviewPanel:CreateFontString(nil, "OVERLAY")
minimapToggle.Label:SetFont(FONT_BOLD, 11, "")
minimapToggle.Label:SetTextColor(0.80, 0.80, 0.80)
minimapToggle.Label:SetPoint("LEFT", minimapToggle, "RIGHT", 4, 0)
minimapToggle.Label:SetText("Show minimap icon")
minimapToggle:SetScript("OnClick", function(self)
    if not WowDashboardDB or not WowDashboardDB.minimap then return end

    WowDashboardDB.minimap.hide = not self:GetChecked()
    RefreshMinimapButton()
end)

-- ============================================================
-- Snapshots Panel — scrollable log of saved snapshots
-- ============================================================

local LOG_ROW_H     = 20
local LOG_ROW_GAP   = 2
-- Content panel dimensions: RIGHT_W(500) - 72 margin = 428; height = 450 - 108 - 30 = 312
local SCROLL_W      = RIGHT_W - 72 - 8   -- 420, leaves 4px each side inside panel
local COL_CHAR_W    = 138
local COL_TIME_W    = 88

local scrollFrame = CreateFrame("ScrollFrame", nil, snapshotsPanel)
scrollFrame:SetPoint("TOPLEFT",     snapshotsPanel, "TOPLEFT",     4, -4)
scrollFrame:SetPoint("BOTTOMRIGHT", snapshotsPanel, "BOTTOMRIGHT", -4, 4)
scrollFrame:EnableMouseWheel(true)
scrollFrame:SetScript("OnMouseWheel", function(self, delta)
    local cur = self:GetVerticalScroll()
    local max = self:GetVerticalScrollRange()
    self:SetVerticalScroll(math.min(math.max(cur - delta * 20, 0), max))
end)

local scrollChild = CreateFrame("Frame", nil, scrollFrame)
scrollChild:SetWidth(SCROLL_W)
scrollChild:SetHeight(1)
scrollFrame:SetScrollChild(scrollChild)

-- Column header
local logHeader = scrollChild:CreateFontString(nil, "OVERLAY")
logHeader:SetFont(FONT_BOLD, 9, "")
logHeader:SetTextColor(0.6, 0.5, 0.3)
logHeader:SetJustifyH("LEFT")
logHeader:SetPoint("TOPLEFT", scrollChild, "TOPLEFT", 4, -3)
logHeader:SetText("CHARACTER              DATE/TIME        LV   ILVL    GOLD    M+")

-- Row pool
local rowPool  = {}
local rowCount = 0

local function GetRow(i)
    if rowPool[i] then return rowPool[i] end

    local row = CreateFrame("Frame", nil, scrollChild)
    local rowW = SCROLL_W - 8
    row:SetSize(rowW, LOG_ROW_H)
    row:SetPoint("TOPLEFT", scrollChild, "TOPLEFT", 4, -(14 + (i - 1) * (LOG_ROW_H + LOG_ROW_GAP)))

    local bg = row:CreateTexture(nil, "BACKGROUND")
    bg:SetAllPoints(row)
    if i % 2 == 0 then
        bg:SetColorTexture(0.10, 0.07, 0.04, 0.35)
    else
        bg:SetColorTexture(0.06, 0.04, 0.02, 0.15)
    end

    row.charText = row:CreateFontString(nil, "OVERLAY")
    row.charText:SetFont(FONT_BOLD, 10, "")
    row.charText:SetTextColor(1, 0.82, 0)
    row.charText:SetWidth(COL_CHAR_W)
    row.charText:SetJustifyH("LEFT")
    row.charText:SetPoint("LEFT", row, "LEFT", 4, 0)

    row.timeText = row:CreateFontString(nil, "OVERLAY")
    row.timeText:SetFont(FONT_BOLD, 10, "")
    row.timeText:SetTextColor(0.55, 0.55, 0.55)
    row.timeText:SetWidth(COL_TIME_W)
    row.timeText:SetJustifyH("LEFT")
    row.timeText:SetPoint("LEFT", row, "LEFT", COL_CHAR_W + 8, 0)

    row.statsText = row:CreateFontString(nil, "OVERLAY")
    row.statsText:SetFont(FONT_BOLD, 10, "")
    row.statsText:SetTextColor(0.80, 0.80, 0.80)
    row.statsText:SetJustifyH("RIGHT")
    row.statsText:SetPoint("RIGHT", row, "RIGHT", -4, 0)

    rowPool[i] = row
    return row
end

RefreshLog = function()
    if not WowDashboardDB or not WowDashboardDB.characters then return end

    -- Gather all snapshots across all characters, newest first
    local all = {}
    for key, charData in pairs(WowDashboardDB.characters) do
        for _, snap in ipairs(charData.snapshots or {}) do
            all[#all + 1] = { key = key, snap = snap }
        end
    end
    table.sort(all, function(a, b) return a.snap.takenAt > b.snap.takenAt end)

    local n = #all

    -- Hide rows no longer needed
    for i = n + 1, rowCount do
        rowPool[i]:Hide()
    end
    rowCount = n

    for i, entry in ipairs(all) do
        local row  = GetRow(i)
        local snap = entry.snap
        row.charText:SetText(entry.key)
        row.timeText:SetText(date("%m/%d %H:%M", snap.takenAt))
        row.statsText:SetFormattedText("Lv%d  %d  %dg  %dM+",
            snap.level, math.floor(snap.itemLevel),
            math.floor(snap.gold), snap.mythicPlusScore)
        row:Show()
    end

    scrollChild:SetHeight(math.max(14 + n * (LOG_ROW_H + LOG_ROW_GAP), 1))
end

-- ============================================================
-- 1-Second UI Ticker  (timer label + cooldown display)
-- ============================================================

local function OnSecondTick()
    if timerLabel then
        if pendingSnapshot then
            timerLabel:SetText("Collecting snapshot...")
        else
            local remaining = math.max(0, math.ceil(nextSnapshotAt - GetTime()))
            local mm = math.floor(remaining / 60)
            local ss = remaining % 60
            timerLabel:SetFormattedText("Next snapshot in  |cffffffff%d:%02d|r", mm, ss)
        end
    end

    if refreshBtn then
        local now = GetTime()
        if now < refreshCooldownUntil then
            refreshBtn:SetText(string.format("Wait  %ds", math.ceil(refreshCooldownUntil - now)))
            refreshBtn:Disable()
        else
            if refreshBtn:IsEnabled() == 0 then
                refreshBtn:SetText("Force Snapshot")
                refreshBtn:Enable()
            end
        end
    end
end

-- ============================================================
-- Slash Commands & Events
-- ============================================================

SLASH_WOWDASHBOARD1 = "/wd"
SLASH_WOWDASHBOARD2 = "/wowdashboard"
local function PrintSlashHelp()
    PrintAddonMessage("Commands: /wd, /wd help, /wd open, /wd mplus probe, /wd mplus sync, /wd mplus dump [count]")
end

local function HandleMythicPlusSlash(rawArgs)
    local args = rawArgs and rawArgs:match("^%s*(.-)%s*$") or ""
    local subcommand, rest = args:match("^(%S+)%s*(.-)$")
    subcommand = subcommand and subcommand:lower() or "help"

    if subcommand == "" or subcommand == "help" then
        PrintAddonMessage("Mythic+ commands: probe, sync, dump [count]")
        return
    end

    if subcommand == "probe" then
        SyncMythicPlusHistory("slash:probe", { force = true, verbose = true, printProbe = true })
        return
    end

    if subcommand == "sync" then
        SyncMythicPlusHistory("slash:sync", { force = true, verbose = true })
        return
    end

    if subcommand == "dump" then
        DumpStoredMythicPlusRuns(rest)
        return
    end

    PrintAddonMessage("Unknown Mythic+ subcommand: " .. tostring(subcommand))
end

SlashCmdList["WOWDASHBOARD"] = function(msg)
    local input = msg and msg:match("^%s*(.-)%s*$") or ""
    if input == "" then
        ToggleDashboard()
        return
    end

    local command, rest = input:match("^(%S+)%s*(.-)$")
    command = command and command:lower() or ""

    if command == "open" then
        SetDashboardShown(true)
        return
    end

    if command == "help" then
        PrintSlashHelp()
        return
    end

    if command == "mplus" then
        HandleMythicPlusSlash(rest)
        return
    end

    PrintSlashHelp()
end

local eventFrame = CreateFrame("Frame")
eventFrame:RegisterEvent("ADDON_LOADED")
eventFrame:RegisterEvent("PLAYER_ENTERING_WORLD")
eventFrame:RegisterEvent("ZONE_CHANGED_NEW_AREA")
eventFrame:RegisterEvent("CHALLENGE_MODE_COMPLETED")
eventFrame:RegisterEvent("TIME_PLAYED_MSG")
eventFrame:SetScript("OnEvent", function(self, event, ...)
    if event == "ADDON_LOADED" and ... == addonName then
        if not WowDashboardDB then
            WowDashboardDB = {
                version = DB_VERSION,
                characters = {},
                panelOpen = false,
                minimap = {
                    minimapPos = DEFAULT_MINIMAP_POS,
                    hide = false,
                },
            }
        end
        if not WowDashboardDB.version    then WowDashboardDB.version    = DB_VERSION end
        if not WowDashboardDB.characters then WowDashboardDB.characters = {} end
        if WowDashboardDB.panelOpen == nil then WowDashboardDB.panelOpen = false end
        EnsureMinimapSettings()
        if minimapToggle then
            minimapToggle:SetChecked(not WowDashboardDB.minimap.hide)
        end
        CreateMinimapButton()

    elseif event == "PLAYER_ENTERING_WORLD" then
        RefreshMinimapButton()
        if not initialized then
            initialized = true
            print("|cff00ccff[WoW Dashboard]|r Loaded — type |cffffffff/wowdashboard|r to open.")
            SetDashboardShown(WowDashboardDB.panelOpen == true)
            C_Timer.NewTicker(1, OnSecondTick)
            -- First snapshot in 5 s, then every 15 min
            nextSnapshotAt = GetTime() + 5
            C_Timer.After(5, function()
                CollectSnapshot()
                StartSnapshotTicker()
            end)
            ScheduleMythicPlusHistorySync("initial_login", 8)
        else
            -- Re-entering world (dungeon entry/exit, zone transfer)
            if GetTime() - lastSnapshotAt > 60 then
                C_Timer.After(2, CollectSnapshot)
            end
            ScheduleMythicPlusHistorySync("player_entering_world", 4)
        end

    elseif event == "ZONE_CHANGED_NEW_AREA" then
        if GetTime() - lastSnapshotAt > 60 then
            C_Timer.After(2, CollectSnapshot)
        end

    elseif event == "CHALLENGE_MODE_COMPLETED" then
        ScheduleMythicPlusHistorySync("challenge_mode_completed", 5, { verbose = true })

    elseif event == "TIME_PLAYED_MSG" then
        local totalSeconds = ...
        if waitingForPlaytime then
            waitingForPlaytime = false
            RestoreTimePlayedMessages()
        end
        CommitSnapshot(totalSeconds)
        if queuedFreshSnapshot then
            queuedFreshSnapshot = false
            CollectSnapshot(true)
        end
    end
end)
