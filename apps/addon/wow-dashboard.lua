local addonName, addon = ...
addon = addon or {}

-- ============================================================
-- WoW Dashboard — Expansion Overview Panel Style
-- ============================================================

local ADDON_PATH   = "Interface\\AddOns\\wow-dashboard"
local FONT_BOLD    = ADDON_PATH .. "\\Fonts\\Lato-Bold.ttf"
local BORDER_TEX   = ADDON_PATH .. "\\Art\\ExpansionLandingPage\\ExpansionBorder_TWW"
local MINIMAP_ICON = ADDON_PATH .. "\\Art\\Logo\\WDIconTransparent"

local function GetAddonMetadata(fieldName, fallback)
    local value = nil
    if type(C_AddOns) == "table" and type(C_AddOns.GetAddOnMetadata) == "function" then
        value = C_AddOns.GetAddOnMetadata(addonName, fieldName)
    end

    if value ~= nil and value ~= "" then
        return tostring(value)
    end

    return fallback
end

local ADDON_VERSION   = GetAddonMetadata("Version", "unknown")
local ADDON_INTERFACE = GetAddonMetadata("Interface", "120007")
local ADDON_EXPANSION = GetAddonMetadata("X-Expansion", "Midnight")

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

addon.uiHelpers = {
    BuildSection = BuildSection,
    CreateMajorDivider = CreateMajorDivider,
    BuildCategoryBar = BuildCategoryBar,
    BuildInfoRow = BuildInfoRow,
}

-- ============================================================
-- Data Collection
-- ============================================================
-- Every SNAPSHOT_INTERVAL seconds the addon collects character
-- and snapshot fields that mirror the backend addon ingest schema and
-- appends them to WowDashboardDB.characters[key].snapshots.
--
-- The SavedVariables file written by WoW is located at:
--   WTF/Account/<ACCOUNT>/SavedVariables/wow-dashboard.lua
--
-- Schema (WowDashboardDB):
--   version        number   -- bump when layout changes
--   panelOpen      boolean
--   settings       table
--     syncPlaytimeOnLogin boolean
--   signing        table    -- local tamper-evidence only; not an auth secret
--     algorithm    string   -- "wd-djb2-32-v1"
--     installId    string
--     secret       string
--     createdAt    number
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
--     mythicPlusRuns    array
--       fingerprint         string
--       attemptId           string?
--       observedAt          number
--       seasonID            number?
--       mapChallengeModeID  number?
--       mapName             string?
--       level               number?
--       status              string? -- "active" | "completed" | "abandoned"
--       completed           boolean?
--       completedInTime     boolean?
--       durationMs          number?
--       runScore            number?
--       startDate           number?
--       completedAt         number?
--       endedAt             number?
--       abandonedAt         number?
--       abandonReason       string?
--       thisWeek            boolean?
--       addonSignature     table?
--         algorithm        string
--         installId        string
--         payloadHash      string
--         signature        string
--         signedAt         number
--       members            array?
--         name             string
--         realm            string?
--         classTag         string?
--         role             string?  -- "tank" | "healer" | "dps"
--     mythicPlusStorageVersion number -- lazy normalization/index migration marker
--     snapshots    array
--       takenAt           number  -- Unix timestamp
--       level             number
--       spec              string
--       role              string  -- "tank" | "healer" | "dps"
--       itemLevel         number
--       gold              number  -- in gold (not copper)
--       playtimeSeconds   number  -- total /played seconds
--       playtimeThisLevelSeconds number  -- /played seconds on current level
--       mythicPlusScore   number
--       seasonID          number?
--       ownedKeystone     table?
--         level               number
--         mapChallengeModeID  number?
--         mapName             string?
--       currencies        table
--         adventurerDawncrest  number
--         veteranDawncrest     number
--         championDawncrest    number
--         heroDawncrest        number
--         mythDawncrest        number
--         radiantSparkDust     number
--       currencyDetails   table? -- keyed like currencies; includes caps and weekly earned values
--       stats             table
--         stamina              number
--         strength             number
--         agility              number
--         intellect            number
--         critRating           number
--         critPercent          number
--         hasteRating          number
--         hastePercent         number
--         masteryRating        number
--         masteryPercent       number
--         versatilityRating    number
--         versatilityPercent   number
--         speedRating          number
--         speedPercent         number
--         leechRating          number
--         leechPercent         number
--         avoidanceRating      number
--         avoidancePercent     number
--       equipment         table? -- keyed by equipment slot
--       weeklyRewards     table?
--       majorFactions     table?
--       clientInfo        table?
--       addonSignature    table?
--         algorithm       string
--         installId       string
--         payloadHash     string
--         signature       string
--         signedAt        number
--   pendingMythicPlusMembers table -- keyed by "Name-Realm"
--     capturedAt    number
--     members       array
--   pendingMythicPlusScoreBackfill table -- keyed by "Name-Realm"
--     startedAt     number
--     retryIndex    number
--     lastScheduledAt number?
--     missingCount  number?
--   activeMythicPlusMembers table -- keyed by "Name-Realm"
--     startedAt     number
--     updatedAt     number
--     mapChallengeModeID number?
--     level         number?
--     members       array
--     source        string?
--   mythicPlusDebug table -- keyed by "Name-Realm"
--     lastCompletionEventAt     number?
--     lastCompletionEventGroupType string?
--     lastCompletionEventGroupSize number?
--     lastChallengeStartAt      number?
--     lastChallengeStartMapID   number?
--     lastActiveCacheAt         number?
--     lastActiveCacheCount      number?
--     lastActiveCacheSource     string?
--     lastActiveCacheMapID      number?
--     lastActiveCacheLevel      number?
--     lastCaptureAt             number?
--     lastCaptureSource         string?
--     lastCaptureCount          number?
--     lastCompletionApiName     string?
--     lastCompletionApiMemberCount number?
--     lastLiveRosterCount       number?
--     lastPendingAt             number?
--     lastPendingCount          number?
--     lastPendingSource         string?
--     lastAttachAt              number?
--     lastAttachStatus          string?
--     lastAttachDiffSeconds     number?
--     lastAttachMapName         string?
--     lastAttachLevel           number?
--     lastSyncAt                number?
--     lastSyncReason            string?
--     lastSyncChanged           boolean?
--     events                    array
-- ============================================================

local DB_VERSION            = 4
local STORAGE_POLICY = {
    mythicPlusVersion = 1,
    snapshotEventMinInterval = 5 * 60,
    mythicPlusDebugRetention = 30 * 24 * 60 * 60,
}
local ADDON_SIGNATURE_ALGORITHM = "wd-djb2-32-v1"
local ADDON_SIGNATURE_SEPARATOR = "\31"
local SNAPSHOT_INTERVAL     = 15 * 60  -- seconds
local DEFAULT_MINIMAP_POS   = 225
local MINIMAP_BUTTON_RADIUS = 5
local MPLUS_SYNC_INTERVAL   = 30       -- seconds
local PENDING_RUN_MEMBER_RETENTION = 30 * 60
local PENDING_RUN_MEMBER_MATCH_WINDOW = 5 * 60
local PENDING_RUN_MEMBER_RETRY_DELAYS = { 5, 45, 120 }
local ACTIVE_RUN_MEMBER_RETENTION = 4 * 60 * 60
local ACTIVE_ATTEMPT_RECONCILE_GRACE = 8
local ACTIVE_ATTEMPT_STALE_ACTIVE_RETRY_DELAY = 4
local ACTIVE_ATTEMPT_STALE_ACTIVE_MAX_RETRIES = 6
local RECENT_COMPLETION_EVENT_GRACE = 20
local STALE_ATTEMPT_RECOVERY_SECONDS = 10 * 60
local COMPLETED_RUN_DERIVED_START_TOLERANCE_SECONDS = 2 * 60
local MPLUS_SCORE_BACKFILL_WINDOW = 48 * 60 * 60
local MPLUS_SCORE_BACKFILL_RETRY_DELAYS = { 5, 45, 120, 300, 900 }
local MPLUS_SCORE_BACKFILL_PERIODIC_DELAY = 15 * 60
local MAX_REASONABLE_MYTHIC_PLUS_DURATION_MS = 4 * 60 * 60 * 1000
local MYTHIC_PLUS_DEBUG_EVENT_LIMIT = 30
local MAX_SNAPSHOTS_PER_CHARACTER = 256
local MAX_MYTHIC_PLUS_RUNS_PER_CHARACTER = 1000
local MAX_MYTHIC_PLUS_RUN_MEMBERS = 5
local MAX_LOG_ENTRIES = 200

addon.constants = {
    ADDON_PATH = ADDON_PATH,
    FONT_BOLD = FONT_BOLD,
    BORDER_TEX = BORDER_TEX,
    MINIMAP_ICON = MINIMAP_ICON,
    ADDON_VERSION = ADDON_VERSION,
    ADDON_INTERFACE = ADDON_INTERFACE,
    ADDON_EXPANSION = ADDON_EXPANSION,
    DEFAULT_MINIMAP_POS = DEFAULT_MINIMAP_POS,
    MINIMAP_BUTTON_RADIUS = MINIMAP_BUTTON_RADIUS,
    MAX_LOG_ENTRIES = MAX_LOG_ENTRIES,
}

-- Midnight S1 currency IDs.
local CURRENCY_IDS = {
    adventurerDawncrest = 3383,  -- Adventurer Dawncrest  (Midnight S1)
    veteranDawncrest    = 3341,  -- Veteran Dawncrest     (Midnight S1)
    championDawncrest   = 3343,  -- Champion Dawncrest    (Midnight S1)
    heroDawncrest       = 3345,  -- Hero Dawncrest        (Midnight S1)
    mythDawncrest       = 3347,  -- Myth Dawncrest        (Midnight S1)
    radiantSparkDust    = 3212,  -- Radiant Spark Dust    (Midnight S1)
}

addon.SNAPSHOT_EQUIPMENT_SLOTS = {
    { key = "head",      slotName = "HeadSlot" },
    { key = "neck",      slotName = "NeckSlot" },
    { key = "shoulders", slotName = "ShoulderSlot" },
    { key = "back",      slotName = "BackSlot" },
    { key = "chest",     slotName = "ChestSlot" },
    { key = "wrist",     slotName = "WristSlot" },
    { key = "hands",     slotName = "HandsSlot" },
    { key = "waist",     slotName = "WaistSlot" },
    { key = "legs",      slotName = "LegsSlot" },
    { key = "feet",      slotName = "FeetSlot" },
    { key = "finger1",   slotName = "Finger0Slot" },
    { key = "finger2",   slotName = "Finger1Slot" },
    { key = "trinket1",  slotName = "Trinket0Slot" },
    { key = "trinket2",  slotName = "Trinket1Slot" },
    { key = "mainHand",  slotName = "MainHandSlot" },
    { key = "offHand",   slotName = "SecondaryHandSlot" },
}

local pendingSnapshot      = nil
local nextSnapshotAt       = 0      -- GetTime() when next auto-snapshot fires
local snapshotTicker       = nil    -- C_Timer handle, cancelled on force-refresh
local refreshCooldownUntil = 0      -- GetTime() when force-refresh cooldown ends
local lastSnapshotAt       = 0      -- GetTime() when last snapshot was committed
local initialized          = false  -- true after first PLAYER_ENTERING_WORLD
local loginPlaytimeSyncRequested = false
local pendingMPlusSync     = false
local lastMPlusSyncAt      = 0
local pendingCompletedRunMembers = nil
local pendingActiveAttemptReconcile = false
local pendingMPlusScoreBackfillSync = false
local runtimeState = {
    snapshotDeferredForCombat = false,
    mythicPlusMapInfoRequested = false,
    cachedCurrentMythicPlusSeasonID = nil,
    challengeModeMapNameCache = {},
}

local StartSnapshotTicker = nil
local ScheduleNextMythicPlusScoreBackfill = nil

local function IsSecretValue(value)
    if type(issecretvalue) ~= "function" then
        return false
    end

    local ok, secret = pcall(issecretvalue, value)
    return ok and secret == true
end

local function ToSafeNumber(value)
    if IsSecretValue(value) or value == nil then
        return nil
    end

    local ok, numeric = pcall(tonumber, value)
    if not ok or numeric == nil or numeric ~= numeric or numeric == math.huge or numeric == -math.huge then
        return nil
    end

    return numeric
end

local function ToSafeText(value)
    if IsSecretValue(value) or value == nil then
        return nil
    end

    local ok, result = pcall(tostring, value)
    if not ok or result == "" then
        return nil
    end
    return result
end

local function CallSafeNumber(apiFunc, ...)
    if type(apiFunc) ~= "function" then
        return nil
    end

    local ok, value = pcall(apiFunc, ...)
    if not ok then
        return nil
    end

    return ToSafeNumber(value)
end

local function GetCharKey()
    local name, realm = UnitFullName("player")
    realm = (realm and realm ~= "") and realm or GetRealmName()
    return name .. "-" .. realm, name, realm
end

local function GetRegion()
    if addon.cachedRegion then
        return addon.cachedRegion
    end

    local regionByID = {
        [1] = "us",
        [2] = "kr",
        [3] = "eu",
        [4] = "tw",
    }
    local regionID = CallSafeNumber(GetCurrentRegion)
    local region = regionID and regionByID[regionID] or nil

    if region == nil and type(GetLocale) == "function" then
        local ok, locale = pcall(GetLocale)
        if ok then
            if locale == "koKR" then
                region = "kr"
            elseif locale == "zhTW" then
                region = "tw"
            elseif locale == "enGB"
                or locale == "deDE"
                or locale == "frFR"
                or locale == "itIT"
                or locale == "ruRU"
            then
                region = "eu"
            end
        end
    end

    addon.cachedRegion = region or "us"
    return addon.cachedRegion
end
addon.GetRegion = GetRegion

local function PrintAddonMessage(message)
    print("|cff00ccff[WoW Dashboard]|r " .. message)
end

local function Hex32(value)
    local n = math.floor(tonumber(value) or 0) % 4294967296
    local hex = "0123456789abcdef"
    local chars = {}
    for index = 8, 1, -1 do
        local digit = n % 16
        chars[index] = string.sub(hex, digit + 1, digit + 1)
        n = math.floor(n / 16)
    end
    return table.concat(chars)
end

local function DashboardHash(value)
    local input = tostring(value or "")
    local hash = 5381
    for index = 1, #input do
        hash = ((hash * 33) + string.byte(input, index)) % 4294967296
    end
    return Hex32(hash)
end

local function GenerateSigningToken(prefix)
    local entropy = table.concat({
        tostring(prefix or "wd"),
        tostring(time and time() or 0),
        tostring(GetTime and GetTime() or 0),
        tostring(UnitGUID and UnitGUID("player") or ""),
        tostring({}),
        tostring(math.random(1, 1000000000)),
    }, "|")

    return DashboardHash(entropy)
        .. DashboardHash(entropy .. "|1")
        .. DashboardHash(entropy .. "|2")
        .. DashboardHash(entropy .. "|3")
end

local function EnsureAddonSigning()
    if not WowDashboardDB then
        return nil
    end

    local signing = WowDashboardDB.signing
    if type(signing) ~= "table" then
        signing = {}
        WowDashboardDB.signing = signing
    end

    if signing.algorithm ~= ADDON_SIGNATURE_ALGORITHM then
        signing.algorithm = ADDON_SIGNATURE_ALGORITHM
    end
    if type(signing.installId) ~= "string" or signing.installId == "" then
        signing.installId = GenerateSigningToken("install")
    end
    if type(signing.secret) ~= "string" or signing.secret == "" then
        signing.secret = GenerateSigningToken("secret")
    end
    if tonumber(signing.createdAt) == nil then
        signing.createdAt = time()
    end

    return signing
end

local function CanonicalText(value)
    if IsSecretValue(value) or value == nil then
        return ""
    end

    local text = tostring(value)
    text = string.gsub(text, "\\", "\\\\")
    text = string.gsub(text, "|", "\\p")
    text = string.gsub(text, "=", "\\e")
    return text
end

local function CanonicalNumber(value)
    local n = ToSafeNumber(value)
    if n == nil then
        return ""
    end

    if math.floor(n) == n then
        return tostring(math.floor(n))
    end

    local formatted = string.format("%.4f", n)
    formatted = string.gsub(formatted, "0+$", "")
    formatted = string.gsub(formatted, "%.$", "")
    return formatted
end

local function CanonicalBool(value)
    if IsSecretValue(value) then
        return ""
    end
    if value == true then
        return "true"
    end
    if value == false then
        return "false"
    end
    return ""
end

local function BuildCanonicalPayload(fields)
    local parts = {}
    for _, field in ipairs(fields) do
        local kind = field[3]
        local value = field[2]
        if kind == "number" then
            value = CanonicalNumber(value)
        elseif kind == "boolean" then
            value = CanonicalBool(value)
        else
            value = CanonicalText(value)
        end
        parts[#parts + 1] = CanonicalText(field[1]) .. "=" .. value
    end

    return table.concat(parts, "|")
end

local function SignCanonicalPayload(record, canonicalPayload)
    if type(record) ~= "table" then
        return
    end

    local signing = EnsureAddonSigning()
    if type(signing) ~= "table" then
        return
    end

    record.addonSignature = {
        algorithm = ADDON_SIGNATURE_ALGORITHM,
        installId = signing.installId,
        payloadHash = DashboardHash(canonicalPayload),
        signature = DashboardHash(tostring(signing.secret) .. ADDON_SIGNATURE_SEPARATOR .. canonicalPayload),
        signedAt = time(),
    }
end

local function SignSnapshotPayload(entry, snapshot)
    if type(entry) ~= "table" or type(snapshot) ~= "table" then
        return
    end

    local payload = BuildCanonicalPayload({
        { "kind", "snapshot" },
        { "region", entry.region },
        { "name", entry.name },
        { "realm", entry.realm },
        { "takenAt", snapshot.takenAt, "number" },
        { "level", snapshot.level, "number" },
        { "spec", snapshot.spec },
        { "role", snapshot.role },
        { "itemLevel", snapshot.itemLevel, "number" },
        { "gold", snapshot.gold, "number" },
        { "playtimeSeconds", snapshot.playtimeSeconds, "number" },
        { "playtimeThisLevelSeconds", snapshot.playtimeThisLevelSeconds, "number" },
        { "mythicPlusScore", snapshot.mythicPlusScore, "number" },
        { "seasonID", snapshot.seasonID, "number" },
    })
    SignCanonicalPayload(snapshot, payload)
end

local function SignMythicPlusRunPayload(entry, run)
    if type(entry) ~= "table" or type(run) ~= "table" then
        return
    end

    local payload = BuildCanonicalPayload({
        { "kind", "mythicPlusRun" },
        { "region", entry.region },
        { "name", entry.name },
        { "realm", entry.realm },
        { "fingerprint", run.fingerprint },
        { "attemptId", run.attemptId },
        { "observedAt", run.observedAt, "number" },
        { "seasonID", run.seasonID, "number" },
        { "mapChallengeModeID", run.mapChallengeModeID, "number" },
        { "mapName", run.mapName },
        { "level", run.level, "number" },
        { "status", run.status },
        { "completed", run.completed, "boolean" },
        { "completedInTime", run.completedInTime, "boolean" },
        { "durationMs", run.durationMs, "number" },
        { "runScore", run.runScore, "number" },
        { "startDate", run.startDate, "number" },
        { "completedAt", run.completedAt, "number" },
        { "endedAt", run.endedAt, "number" },
        { "abandonedAt", run.abandonedAt, "number" },
        { "abandonReason", run.abandonReason },
        { "thisWeek", run.thisWeek, "boolean" },
    })
    SignCanonicalPayload(run, payload)
end

function addon.EnsureAddonSettings()
    if not WowDashboardDB then
        return
    end

    if type(WowDashboardDB.settings) ~= "table" then
        WowDashboardDB.settings = {}
    end
    if WowDashboardDB.settings.syncPlaytimeOnLogin == nil then
        WowDashboardDB.settings.syncPlaytimeOnLogin = true
    end
end

function addon.ShouldSyncPlaytimeOnLogin()
    if not WowDashboardDB then
        return true
    end

    addon.EnsureAddonSettings()
    return WowDashboardDB.settings.syncPlaytimeOnLogin ~= false
end

function addon.SetSyncPlaytimeOnLogin(enabled)
    if not WowDashboardDB then
        return
    end

    addon.EnsureAddonSettings()
    WowDashboardDB.settings.syncPlaytimeOnLogin = enabled == true
end

local function TrimArrayToNewest(items, maxItems)
    if type(items) ~= "table" or type(maxItems) ~= "number" or #items <= maxItems then
        return items
    end

    local writeIndex = 1
    for readIndex = #items - maxItems + 1, #items do
        items[writeIndex] = items[readIndex]
        writeIndex = writeIndex + 1
    end
    for index = writeIndex, #items do
        items[index] = nil
    end

    return items
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

local function EnsurePendingMythicPlusMemberStore()
    if type(WowDashboardDB.pendingMythicPlusMembers) ~= "table" then
        WowDashboardDB.pendingMythicPlusMembers = {}
    end

    return WowDashboardDB.pendingMythicPlusMembers
end

local function EnsurePendingMythicPlusScoreBackfillStore()
    if type(WowDashboardDB.pendingMythicPlusScoreBackfill) ~= "table" then
        WowDashboardDB.pendingMythicPlusScoreBackfill = {}
    end

    return WowDashboardDB.pendingMythicPlusScoreBackfill
end

local function EnsureActiveMythicPlusMemberStore()
    if type(WowDashboardDB.activeMythicPlusMembers) ~= "table" then
        WowDashboardDB.activeMythicPlusMembers = {}
    end

    return WowDashboardDB.activeMythicPlusMembers
end

local function EnsureMythicPlusDebugStore()
    if type(WowDashboardDB.mythicPlusDebug) ~= "table" then
        WowDashboardDB.mythicPlusDebug = {}
    end

    return WowDashboardDB.mythicPlusDebug
end

local function IsExpiredTimestamp(timestamp, retentionSeconds, nowTimestamp)
    local normalized = ToSafeNumber(timestamp)
    if normalized == nil or normalized > nowTimestamp then
        return normalized == nil
    end

    return (nowTimestamp - normalized) > retentionSeconds
end

local function CleanupTransientStores()
    if type(WowDashboardDB) ~= "table" then
        return
    end

    local nowTimestamp = time()
    local pendingMembers = EnsurePendingMythicPlusMemberStore()
    for characterKey, pending in pairs(pendingMembers) do
        if type(pending) ~= "table"
            or IsExpiredTimestamp(pending.capturedAt, PENDING_RUN_MEMBER_RETENTION, nowTimestamp)
        then
            pendingMembers[characterKey] = nil
        end
    end

    local activeMembers = EnsureActiveMythicPlusMemberStore()
    for characterKey, active in pairs(activeMembers) do
        local updatedAt = type(active) == "table" and (active.updatedAt or active.startedAt) or nil
        if type(active) ~= "table"
            or IsExpiredTimestamp(updatedAt, ACTIVE_RUN_MEMBER_RETENTION, nowTimestamp)
        then
            activeMembers[characterKey] = nil
        end
    end

    local scoreBackfills = EnsurePendingMythicPlusScoreBackfillStore()
    for characterKey, state in pairs(scoreBackfills) do
        if type(state) ~= "table"
            or IsExpiredTimestamp(state.startedAt, MPLUS_SCORE_BACKFILL_WINDOW, nowTimestamp)
        then
            scoreBackfills[characterKey] = nil
        end
    end

    local debugStore = EnsureMythicPlusDebugStore()
    for characterKey, state in pairs(debugStore) do
        local updatedAt = type(state) == "table"
            and (state.lastEventAt or state.lastSyncAt or state.lastCaptureAt)
            or nil
        if type(state) ~= "table"
            or IsExpiredTimestamp(updatedAt, STORAGE_POLICY.mythicPlusDebugRetention, nowTimestamp)
        then
            debugStore[characterKey] = nil
        else
            if type(state.events) ~= "table" then
                state.events = {}
            end
            TrimArrayToNewest(state.events, MYTHIC_PLUS_DEBUG_EVENT_LIMIT)
        end
    end
end

local function GetMythicPlusDebugState(characterKey, create)
    if type(characterKey) ~= "string" or characterKey == "" then
        return nil
    end

    local store = EnsureMythicPlusDebugStore()
    local state = store[characterKey]
    if state == nil and create ~= false then
        state = { events = {} }
        store[characterKey] = state
    end

    if type(state) ~= "table" then
        return nil
    end
    if type(state.events) ~= "table" then
        state.events = {}
    end

    return state
end

local function UpdateMythicPlusDebugState(characterKey, updates)
    local state = GetMythicPlusDebugState(characterKey)
    if not state or type(updates) ~= "table" then
        return state
    end

    for fieldName, value in pairs(updates) do
        state[fieldName] = value
    end

    return state
end

local function ClearMythicPlusDebugFields(characterKey, fieldNames)
    local state = GetMythicPlusDebugState(characterKey)
    if not state or type(fieldNames) ~= "table" then
        return state
    end

    for _, fieldName in ipairs(fieldNames) do
        state[fieldName] = nil
    end

    return state
end

local function AppendMythicPlusDebugEvent(characterKey, kind, details)
    local state = GetMythicPlusDebugState(characterKey)
    if not state then
        return nil
    end

    local event = {
        at = time(),
        kind = kind,
    }
    if type(details) == "table" then
        for fieldName, value in pairs(details) do
            event[fieldName] = value
        end
    end

    local events = state.events
    events[#events + 1] = event
    while #events > MYTHIC_PLUS_DEBUG_EVENT_LIMIT do
        table.remove(events, 1)
    end

    state.lastEvent = kind
    state.lastEventAt = event.at
    return event
end

local function BuildMythicPlusMemberSummary(members)
    if type(members) ~= "table" or #members == 0 then
        return nil
    end

    local names = {}
    for index, member in ipairs(members) do
        local label = member.name
        if type(label) ~= "string" or label == "" then
            label = "?"
        end
        if type(member.realm) == "string" and member.realm ~= "" then
            label = label .. "-" .. member.realm
        end
        names[#names + 1] = label
        if index >= 5 then
            break
        end
    end

    return table.concat(names, ", ")
end

local function FormatDebugTimestamp(timestamp)
    if type(timestamp) ~= "number" then
        return "n/a"
    end

    return date("%d.%m %H:%M:%S", timestamp)
end

local function FormatDebugValue(value)
    if value == nil then
        return "n/a"
    end
    if type(value) == "boolean" then
        return value and "yes" or "no"
    end

    return tostring(value)
end

local GetPendingCompletedRunMembers

local function PrintMythicPlusDebug()
    local characterKey = GetCharKey()
    local state = GetMythicPlusDebugState(characterKey, false)
    local pending = GetPendingCompletedRunMembers(characterKey)
    local active = EnsureActiveMythicPlusMemberStore()[characterKey]

    if type(state) ~= "table" then
        PrintAddonMessage("No Mythic+ debug data recorded yet.")
        return
    end

    PrintAddonMessage("Mythic+ debug for " .. characterKey)
    PrintAddonMessage("  Start: " .. FormatDebugTimestamp(state.lastChallengeStartAt)
        .. "  map " .. FormatDebugValue(state.lastChallengeStartMapID))
    PrintAddonMessage("  Completion event: " .. FormatDebugTimestamp(state.lastCompletionEventAt)
        .. "  " .. FormatDebugValue(state.lastCompletionEventGroupType)
        .. "  size " .. FormatDebugValue(state.lastCompletionEventGroupSize))
    PrintAddonMessage("  Capture: " .. FormatDebugTimestamp(state.lastCaptureAt)
        .. "  source " .. FormatDebugValue(state.lastCaptureSource)
        .. "  count " .. FormatDebugValue(state.lastCaptureCount))
    PrintAddonMessage("  Completion API: " .. FormatDebugValue(state.lastCompletionApiName)
        .. "  members " .. FormatDebugValue(state.lastCompletionApiMemberCount)
        .. "  live roster " .. FormatDebugValue(state.lastLiveRosterCount))
    PrintAddonMessage("  Active cache: " .. FormatDebugValue(state.lastActiveCacheSource)
        .. "  at " .. FormatDebugTimestamp(state.lastActiveCacheAt)
        .. "  count " .. FormatDebugValue(state.lastActiveCacheCount)
        .. "  map " .. FormatDebugValue(state.lastActiveCacheMapID)
        .. "  +" .. FormatDebugValue(state.lastActiveCacheLevel)
        .. "  active " .. FormatDebugValue(type(active) == "table"))
    PrintAddonMessage("  Pending: " .. FormatDebugValue(state.lastPendingSource)
        .. "  at " .. FormatDebugTimestamp(state.lastPendingAt)
        .. "  count " .. FormatDebugValue(state.lastPendingCount)
        .. "  active " .. FormatDebugValue(type(pending) == "table"))
    PrintAddonMessage("  Attach: " .. FormatDebugValue(state.lastAttachStatus)
        .. "  at " .. FormatDebugTimestamp(state.lastAttachAt)
        .. "  diff " .. FormatDebugValue(state.lastAttachDiffSeconds)
        .. "s  " .. FormatDebugValue(state.lastAttachMapName)
        .. " +" .. FormatDebugValue(state.lastAttachLevel))
    PrintAddonMessage("  Sync: " .. FormatDebugTimestamp(state.lastSyncAt)
        .. "  reason " .. FormatDebugValue(state.lastSyncReason)
        .. "  changed " .. FormatDebugValue(state.lastSyncChanged))

    local events = state.events
    if type(events) == "table" and #events > 0 then
        local startIndex = math.max(1, #events - 4)
        for index = startIndex, #events do
            local event = events[index]
            PrintAddonMessage("    "
                .. FormatDebugTimestamp(event.at)
                .. "  "
                .. FormatDebugValue(event.kind)
                .. "  "
                .. FormatDebugValue(event.summary))
        end
    end
end

local function SetPendingCompletedRunMembers(characterKey, pending, options)
    options = options or {}
    if type(characterKey) ~= "string" or characterKey == "" then
        return
    end

    pendingCompletedRunMembers = pending

    local store = EnsurePendingMythicPlusMemberStore()
    if type(pending) == "table" then
        store[characterKey] = pending
        local memberCount = type(pending.members) == "table" and #pending.members or 0
        UpdateMythicPlusDebugState(characterKey, {
            lastPendingAt = tonumber(pending.capturedAt) or time(),
            lastPendingCount = memberCount,
            lastPendingSource = options.reason or pending.source or "set",
            lastPendingSummary = BuildMythicPlusMemberSummary(pending.members),
        })
        AppendMythicPlusDebugEvent(characterKey, "pending_members_set", {
            summary = (options.reason or pending.source or "set") .. " (" .. tostring(memberCount) .. ")",
            memberCount = memberCount,
            source = options.reason or pending.source,
            mapChallengeModeID = pending.mapChallengeModeID,
            level = pending.level,
        })
    else
        store[characterKey] = nil
        ClearMythicPlusDebugFields(characterKey, {
            "lastPendingAt",
            "lastPendingSource",
            "lastPendingSummary",
        })
        UpdateMythicPlusDebugState(characterKey, {
            lastPendingCount = 0,
        })
        AppendMythicPlusDebugEvent(characterKey, "pending_members_cleared", {
            summary = options.reason or "cleared",
            reason = options.reason,
        })
    end
end

GetPendingCompletedRunMembers = function(characterKey)
    if type(characterKey) ~= "string" or characterKey == "" then
        return nil
    end

    if type(pendingCompletedRunMembers) == "table" and pendingCompletedRunMembers.characterKey == characterKey then
        return pendingCompletedRunMembers
    end

    local store = EnsurePendingMythicPlusMemberStore()
    local pending = store[characterKey]
    if type(pending) == "table" then
        pending.characterKey = characterKey
        pendingCompletedRunMembers = pending
        return pending
    end

    return nil
end

local NormalizeMythicPlusDate
local NormalizeOptionalBoolean
local GetRunSortValue
local GetRunDedupKey
local GetRunStatus
local NormalizeStoredMythicPlusRun
local MergeStoredMythicPlusRun
local ShouldReplaceStoredRun

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
            mythicPlusStorageVersion = STORAGE_POLICY.mythicPlusVersion,
        }
        db.characters[key] = entry
    else
        entry.name    = name
        entry.realm   = realm
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
    end
    entry.mythicPlusRunKeys = nil
    entry.mythicPlusDebug = nil

    -- Trim legacy oversized snapshot lists down to the cap (keeps newest)
    TrimArrayToNewest(entry.snapshots, MAX_SNAPSHOTS_PER_CHARACTER)

    return entry
end

local function NormalizeAndDeduplicateRuns(entry, force)
    if type(entry) ~= "table" then
        return false
    end
    if not force and entry.mythicPlusStorageVersion == STORAGE_POLICY.mythicPlusVersion then
        return false
    end

    local normalizedRuns = {}
    local normalizedRunsByDedupKey = {}
    for _, run in ipairs(entry.mythicPlusRuns) do
        local normalized = NormalizeStoredMythicPlusRun(run)
        if normalized then
            local dedupKey = GetRunDedupKey(normalized)
            if dedupKey then
                local current = normalizedRunsByDedupKey[dedupKey]
                normalizedRunsByDedupKey[dedupKey] = MergeStoredMythicPlusRun(current, normalized)
            end
        end
    end

    for _, run in pairs(normalizedRunsByDedupKey) do
        normalizedRuns[#normalizedRuns + 1] = run
    end
    table.sort(normalizedRuns, function(a, b)
        return GetRunSortValue(a) > GetRunSortValue(b)
    end)
    while #normalizedRuns > MAX_MYTHIC_PLUS_RUNS_PER_CHARACTER do
        normalizedRuns[#normalizedRuns] = nil
    end

    for _, run in ipairs(normalizedRuns) do
        SignMythicPlusRunPayload(entry, run)
    end

    entry.mythicPlusRuns = normalizedRuns
    entry.mythicPlusRunKeys = nil
    entry.mythicPlusStorageVersion = STORAGE_POLICY.mythicPlusVersion
    return true
end

local function MigrateDatabase()
    if type(WowDashboardDB) ~= "table" then
        return
    end

    local previousVersion = ToSafeNumber(WowDashboardDB.version) or 0
    local currentRegion = GetRegion()
    if type(WowDashboardDB.characters) ~= "table" then
        WowDashboardDB.characters = {}
    end

    for _, entry in pairs(WowDashboardDB.characters) do
        if type(entry) == "table" then
            local regionChanged = entry.region ~= currentRegion
            entry.region = currentRegion
            -- This legacy index duplicated every run fingerprint in SavedVariables
            -- but was never read. Runtime lookups now build a compact ephemeral index.
            entry.mythicPlusRunKeys = nil

            if type(entry.snapshots) ~= "table" then
                entry.snapshots = {}
            end
            TrimArrayToNewest(entry.snapshots, MAX_SNAPSHOTS_PER_CHARACTER)
            if regionChanged then
                for _, snapshot in ipairs(entry.snapshots) do
                    SignSnapshotPayload(entry, snapshot)
                end
            end

            if type(entry.mythicPlusRuns) ~= "table" then
                entry.mythicPlusRuns = {}
            end
            while #entry.mythicPlusRuns > MAX_MYTHIC_PLUS_RUNS_PER_CHARACTER do
                entry.mythicPlusRuns[#entry.mythicPlusRuns] = nil
            end
            if previousVersion < 4 then
                entry.mythicPlusStorageVersion = nil
            end
            NormalizeAndDeduplicateRuns(entry, previousVersion < 4 or regionChanged)
        end
    end

    -- Never lower a schema marker when an older addon is loaded after a
    -- newer build. The current migration only performs backward-compatible
    -- cleanup, so preserving the higher marker is the safest downgrade path.
    WowDashboardDB.version = math.max(previousVersion, DB_VERSION)
    CleanupTransientStores()
end

local function GetFirstField(record, fieldNames)
    if type(record) ~= "table" then
        return nil
    end

    for _, fieldName in ipairs(fieldNames) do
        local value = record[fieldName]
        if not IsSecretValue(value) and value ~= nil then
            return value
        end
    end

    return nil
end

local function NormalizePartyRole(value)
    if IsSecretValue(value) or type(value) ~= "string" then
        return nil
    end

    local normalized = string.upper(strtrim(value))
    if normalized == "TANK" then
        return "tank"
    end
    if normalized == "HEALER" then
        return "healer"
    end
    if normalized == "DAMAGER" or normalized == "DAMAGE" or normalized == "DPS" then
        return "dps"
    end

    return nil
end

local function NormalizeClassTag(value, classID)
    if not IsSecretValue(value) and type(value) == "string" then
        local normalized = strtrim(value)
        if normalized ~= "" then
            return string.upper(string.gsub(normalized, "[%s%-_]", ""))
        end
    end

    if type(classID) == "number" and type(GetClassInfo) == "function" then
        local ok, _, classTag = pcall(GetClassInfo, classID)
        if ok and type(classTag) == "string" and classTag ~= "" then
            return classTag
        end
    end

    if type(classID) == "number"
        and type(C_CreatureInfo) == "table"
        and type(C_CreatureInfo.GetClassInfo) == "function" then
        local ok, classInfo = pcall(C_CreatureInfo.GetClassInfo, classID)
        if ok and type(classInfo) == "table" then
            local classTag = classInfo.classFile or classInfo.classTag
            if type(classTag) == "string" and classTag ~= "" then
                return string.upper(classTag)
            end
        end
    end

    return nil
end

local function NormalizeMemberIdentity(name, realm)
    name = ToSafeText(name)
    realm = ToSafeText(realm)
    if type(name) ~= "string" then
        return nil, nil
    end

    local normalizedName = strtrim(name)
    if normalizedName == "" then
        return nil, nil
    end

    local normalizedRealm = type(realm) == "string" and strtrim(realm) or nil
    if normalizedRealm == "" then
        normalizedRealm = nil
    end

    if normalizedRealm == nil then
        local splitName, splitRealm = string.match(normalizedName, "^([^%-]+)%-(.+)$")
        if splitName and splitRealm then
            normalizedName = splitName
            normalizedRealm = splitRealm
        end
    end

    return normalizedName, normalizedRealm
end

local function NormalizeMythicPlusMember(member)
    if type(member) ~= "table" then
        return nil
    end

    local name, realm = NormalizeMemberIdentity(
        GetFirstField(member, { "name", "playerName", "fullName", "unitName" }),
        GetFirstField(member, { "realm", "realmName", "server", "realmSlug" })
    )
    if name == nil then
        return nil
    end

    local role = NormalizePartyRole(GetFirstField(member, { "role", "assignedRole", "combatRole" }))
    if role == nil then
        local specID = tonumber(GetFirstField(member, { "specID", "specId", "specializationID" }))
        if specID and type(GetSpecializationRoleByID) == "function" then
            local ok, specRole = pcall(GetSpecializationRoleByID, specID)
            if ok then
                role = NormalizePartyRole(specRole)
            end
        end
    end

    local classTag = NormalizeClassTag(
        GetFirstField(member, { "classTag", "classFile", "classFilename", "class", "englishClass" }),
        tonumber(GetFirstField(member, { "classID", "classId" }))
    )

    local normalized = { name = name }
    if realm ~= nil then
        normalized.realm = realm
    end
    if classTag ~= nil then
        normalized.classTag = classTag
    end
    if role ~= nil then
        normalized.role = role
    end

    return normalized
end

local function NormalizeMythicPlusMembers(members)
    if type(members) ~= "table" then
        return nil
    end

    local normalizedMembers = {}
    local seenMembers = {}

    for _, member in ipairs(members) do
        local normalized = NormalizeMythicPlusMember(member)
        if normalized then
            local memberKey = string.lower(normalized.name .. "|" .. (normalized.realm or ""))
            if not seenMembers[memberKey] then
                seenMembers[memberKey] = true
                normalizedMembers[#normalizedMembers + 1] = normalized
                if #normalizedMembers >= MAX_MYTHIC_PLUS_RUN_MEMBERS then
                    break
                end
            end
        end
    end

    if #normalizedMembers == 0 then
        return nil
    end

    return normalizedMembers
end

local function GetMythicPlusMemberKey(member)
    if type(member) ~= "table" or type(member.name) ~= "string" or member.name == "" then
        return nil
    end

    return string.lower(member.name .. "|" .. (member.realm or ""))
end

local function GetNormalizedMythicPlusMemberName(member)
    if type(member) ~= "table" or type(member.name) ~= "string" then
        return ""
    end

    return string.lower(strtrim(member.name))
end

local function GetNormalizedMythicPlusMemberRealm(member)
    if type(member) ~= "table" or type(member.realm) ~= "string" then
        return ""
    end

    return string.lower(strtrim(member.realm))
end

local function FindMergeableMythicPlusMemberIndex(members, candidateMember)
    local candidateName = GetNormalizedMythicPlusMemberName(candidateMember)
    local candidateRealm = GetNormalizedMythicPlusMemberRealm(candidateMember)
    local exactIndex = nil
    local unresolvedIndex = nil
    local unresolvedCount = 0
    local sameNameIndex = nil
    local sameNameCount = 0

    for index, currentMember in ipairs(members) do
        if GetNormalizedMythicPlusMemberName(currentMember) == candidateName then
            sameNameCount = sameNameCount + 1
            if sameNameIndex == nil then
                sameNameIndex = index
            end

            local currentRealm = GetNormalizedMythicPlusMemberRealm(currentMember)
            if currentRealm == candidateRealm then
                exactIndex = index
                break
            end
            if currentRealm == "" then
                unresolvedIndex = index
                unresolvedCount = unresolvedCount + 1
            end
        end
    end

    if exactIndex ~= nil then
        return exactIndex
    end
    if candidateRealm == "" then
        if sameNameCount == 1 then
            return unresolvedIndex or sameNameIndex
        end
        return nil
    end

    if unresolvedCount == 1 then
        return unresolvedIndex
    end

    return nil
end

local function MergeMythicPlusMember(currentMember, candidateMember)
    if type(candidateMember) ~= "table" then
        return currentMember
    end
    if type(currentMember) ~= "table" then
        return candidateMember
    end

    local merged = {
        name = candidateMember.name or currentMember.name,
    }
    if type(candidateMember.realm) == "string" and candidateMember.realm ~= "" then
        merged.realm = candidateMember.realm
    elseif type(currentMember.realm) == "string" and currentMember.realm ~= "" then
        merged.realm = currentMember.realm
    end
    if type(candidateMember.classTag) == "string" and candidateMember.classTag ~= "" then
        merged.classTag = candidateMember.classTag
    elseif type(currentMember.classTag) == "string" and currentMember.classTag ~= "" then
        merged.classTag = currentMember.classTag
    end
    if type(candidateMember.role) == "string" and candidateMember.role ~= "" then
        merged.role = candidateMember.role
    elseif type(currentMember.role) == "string" and currentMember.role ~= "" then
        merged.role = currentMember.role
    end

    return merged
end

local function MergeMythicPlusMemberLists(...)
    local mergedMembers = {}

    for sourceIndex = 1, select("#", ...) do
        local members = select(sourceIndex, ...)
        if type(members) == "table" then
            for _, member in ipairs(members) do
                local normalized = NormalizeMythicPlusMember(member)
                if normalized ~= nil then
                    local mergedIndex = FindMergeableMythicPlusMemberIndex(mergedMembers, normalized)
                    if mergedIndex == nil then
                        if #mergedMembers < MAX_MYTHIC_PLUS_RUN_MEMBERS then
                            mergedMembers[#mergedMembers + 1] = normalized
                        end
                    else
                        mergedMembers[mergedIndex] = MergeMythicPlusMember(mergedMembers[mergedIndex], normalized)
                    end
                end
            end
        end
    end

    if #mergedMembers == 0 then
        return nil
    end

    return mergedMembers
end

local function GetMythicPlusMemberListCompletenessScore(members)
    if type(members) ~= "table" then
        return 0
    end

    local score = 0
    for _, member in ipairs(members) do
        if type(member) == "table" then
            if type(member.name) == "string" and member.name ~= "" then score = score + 1 end
            if type(member.realm) == "string" and member.realm ~= "" then score = score + 1 end
            if type(member.classTag) == "string" and member.classTag ~= "" then score = score + 2 end
            if type(member.role) == "string" and member.role ~= "" then score = score + 2 end
        end
    end

    return score
end

local function GetImprovedMythicPlusMembers(currentMembers, candidateMembers)
    local mergedMembers = MergeMythicPlusMemberLists(candidateMembers, currentMembers)
    if type(mergedMembers) ~= "table" or #mergedMembers == 0 then
        return nil
    end

    local currentCount = type(currentMembers) == "table" and #currentMembers or 0
    if #mergedMembers > currentCount then
        return mergedMembers
    end

    return GetMythicPlusMemberListCompletenessScore(mergedMembers)
        > GetMythicPlusMemberListCompletenessScore(currentMembers)
        and mergedMembers
        or nil
end

local function AreMythicPlusMemberListsEqual(leftMembers, rightMembers)
    local function BuildComparableTokens(members)
        if type(members) ~= "table" or #members == 0 then
            return nil
        end

        local tokens = {}
        for _, member in ipairs(members) do
            local normalized = NormalizeMythicPlusMember(member)
            if normalized ~= nil then
                tokens[#tokens + 1] = table.concat({
                    string.lower(normalized.name or ""),
                    string.lower(normalized.realm or ""),
                    normalized.classTag or "",
                    normalized.role or "",
                }, "|")
            end
        end

        if #tokens == 0 then
            return nil
        end

        table.sort(tokens)
        return tokens
    end

    local leftTokens = BuildComparableTokens(leftMembers)
    local rightTokens = BuildComparableTokens(rightMembers)

    if leftTokens == nil then
        return rightTokens == nil
    end
    if rightTokens == nil or #leftTokens ~= #rightTokens then
        return false
    end

    for index = 1, #leftTokens do
        if leftTokens[index] ~= rightTokens[index] then
            return false
        end
    end

    return true
end

local function BuildMythicPlusMemberFromUnit(unit)
    if type(unit) ~= "string" then
        return nil
    end

    local okExists, exists = pcall(UnitExists, unit)
    local okPlayer, isPlayer = pcall(UnitIsPlayer, unit)
    if not okExists or exists ~= true or not okPlayer or isPlayer ~= true then
        return nil
    end

    local okName, rawName, rawRealm = pcall(UnitFullName, unit)
    if not okName then
        return nil
    end

    local name, realm = NormalizeMemberIdentity(ToSafeText(rawName), ToSafeText(rawRealm))
    if name == nil then
        return nil
    end

    local classTag = nil
    if type(UnitClassBase) == "function" then
        local okClass, rawClassTag = pcall(UnitClassBase, unit)
        classTag = okClass and ToSafeText(rawClassTag) or nil
    elseif type(UnitClass) == "function" then
        local okClass, _, rawClassTag = pcall(UnitClass, unit)
        classTag = okClass and ToSafeText(rawClassTag) or nil
    end
    classTag = NormalizeClassTag(classTag)

    local role = nil
    if type(UnitGroupRolesAssigned) == "function" then
        local okRole, rawRole = pcall(UnitGroupRolesAssigned, unit)
        role = okRole and NormalizePartyRole(ToSafeText(rawRole)) or nil
    end
    if role == nil and unit == "player" then
        local specIndex = CallSafeNumber(GetSpecialization)
        if specIndex and specIndex > 0 then
            local okSpec, _, _, _, _, specRole = pcall(GetSpecializationInfo, specIndex)
            role = okSpec and NormalizePartyRole(ToSafeText(specRole)) or nil
        end
    end

    local member = { name = name }
    if realm ~= nil then
        member.realm = realm
    end
    if classTag ~= nil then
        member.classTag = classTag
    end
    if role ~= nil then
        member.role = role
    end

    return member
end

local function CaptureLiveGroupMembers()
    local members = {}
    local seenMembers = {}
    local groupType = "solo"

    local function AddUnit(unit)
        local member = BuildMythicPlusMemberFromUnit(unit)
        if not member then
            return
        end

        local memberKey = string.lower(member.name .. "|" .. (member.realm or ""))
        if seenMembers[memberKey] then
            return
        end

        seenMembers[memberKey] = true
        members[#members + 1] = member
    end

    AddUnit("player")
    if IsInRaid() then
        groupType = "raid"
        for index = 1, GetNumGroupMembers() do
            AddUnit("raid" .. index)
        end
    elseif IsInGroup() then
        groupType = "party"
        for index = 1, GetNumSubgroupMembers() do
            AddUnit("party" .. index)
        end
    end

    return members, {
        groupType = groupType,
        groupSize = #members,
    }
end

local function GetCurrentActiveMythicPlusRunContext(options)
    options = options or {}

    local mapChallengeModeID = nil
    if type(C_ChallengeMode) == "table" and type(C_ChallengeMode.GetActiveChallengeMapID) == "function" then
        local ok, result = pcall(C_ChallengeMode.GetActiveChallengeMapID)
        if ok then
            mapChallengeModeID = tonumber(result)
        end
    end
    if mapChallengeModeID == nil then
        mapChallengeModeID = tonumber(options.mapChallengeModeID)
    end
    if mapChallengeModeID == nil or mapChallengeModeID <= 0 then
        return nil
    end

    local level = nil
    if type(C_ChallengeMode) == "table" and type(C_ChallengeMode.GetActiveKeystoneInfo) == "function" then
        local ok, activeLevel = pcall(C_ChallengeMode.GetActiveKeystoneInfo)
        if ok then
            level = tonumber(activeLevel)
        end
    end
    if level == nil then
        level = tonumber(options.level)
    end

    return {
        mapChallengeModeID = mapChallengeModeID,
        level = level,
    }
end

local function IsInsideMythicPlusDungeonInstance()
    if type(GetInstanceInfo) ~= "function" then
        return false
    end
    local ok, _, _, difficultyID = pcall(GetInstanceInfo)
    return ok and ToSafeNumber(difficultyID) == 8
end

local function ClearActiveMythicPlusMemberCache(characterKey, reason)
    if type(characterKey) ~= "string" or characterKey == "" then
        return
    end

    EnsureActiveMythicPlusMemberStore()[characterKey] = nil
    ClearMythicPlusDebugFields(characterKey, {
        "lastActiveCacheAt",
        "lastActiveCacheSource",
        "lastActiveCacheMapID",
        "lastActiveCacheLevel",
    })
    UpdateMythicPlusDebugState(characterKey, {
        lastActiveCacheCount = 0,
    })
    AppendMythicPlusDebugEvent(characterKey, "active_cache_cleared", {
        summary = reason or "cleared",
        reason = reason,
    })
end

local function GetActiveMythicPlusMemberCache(characterKey)
    if type(characterKey) ~= "string" or characterKey == "" then
        return nil
    end

    local active = EnsureActiveMythicPlusMemberStore()[characterKey]
    if type(active) ~= "table" then
        return nil
    end

    local updatedAt = tonumber(active.updatedAt) or tonumber(active.startedAt)
    if updatedAt == nil or math.abs(time() - updatedAt) > ACTIVE_RUN_MEMBER_RETENTION then
        ClearActiveMythicPlusMemberCache(characterKey, "active_cache_expired")
        return nil
    end

    return active
end

local function RefreshActiveMythicPlusMemberCache(reason, options)
    options = options or {}

    local characterKey = GetCharKey()
    local context = GetCurrentActiveMythicPlusRunContext(options)
    if context == nil then
        if options.clearWhenInactive ~= false then
            ClearActiveMythicPlusMemberCache(characterKey, reason or "inactive")
        end
        return nil
    end

    local members = options.members
    local liveInfo = options.liveInfo
    if type(members) ~= "table" then
        members, liveInfo = CaptureLiveGroupMembers()
    end

    local existing = GetActiveMythicPlusMemberCache(characterKey)
    if type(members) ~= "table" or #members == 0 then
        AppendMythicPlusDebugEvent(characterKey, "active_cache_refresh_empty", {
            summary = tostring(reason or "refresh") .. " (0)",
            reason = reason,
        })
        return existing
    end

    local storedMembers = members
    local startedAt = time()
    local liveCount = #members
    if type(existing) == "table"
        and tonumber(existing.mapChallengeModeID) == context.mapChallengeModeID
        and (tonumber(existing.level) or -1) == (tonumber(context.level) or -1) then
        startedAt = tonumber(existing.startedAt) or startedAt
        storedMembers = MergeMythicPlusMemberLists(members, existing.members) or storedMembers
    end

    local active = {
        characterKey = characterKey,
        startedAt = startedAt,
        updatedAt = time(),
        mapChallengeModeID = context.mapChallengeModeID,
        level = context.level,
        members = storedMembers,
        source = reason or "refresh",
    }
    EnsureActiveMythicPlusMemberStore()[characterKey] = active

    UpdateMythicPlusDebugState(characterKey, {
        lastActiveCacheAt = active.updatedAt,
        lastActiveCacheCount = #storedMembers,
        lastActiveCacheSource = active.source,
        lastActiveCacheMapID = active.mapChallengeModeID,
        lastActiveCacheLevel = active.level,
    })
    AppendMythicPlusDebugEvent(characterKey, "active_cache_updated", {
        summary = tostring(reason or "refresh")
            .. " (live " .. tostring(liveCount)
            .. ", stored " .. tostring(#storedMembers) .. ")",
        reason = reason,
        liveCount = liveCount,
        storedCount = #storedMembers,
        mapChallengeModeID = active.mapChallengeModeID,
        level = active.level,
        groupType = liveInfo and liveInfo.groupType or nil,
    })

    return active
end

local function ReconcileActiveMythicPlusMemberCache(reason)
    if GetCurrentActiveMythicPlusRunContext() ~= nil then
        return RefreshActiveMythicPlusMemberCache(reason, { clearWhenInactive = false })
    end

    local characterKey = GetCharKey()
    local active = GetActiveMythicPlusMemberCache(characterKey)
    if active ~= nil and IsInsideMythicPlusDungeonInstance() then
        AppendMythicPlusDebugEvent(characterKey, "active_cache_waiting_for_context", {
            summary = reason or "waiting_for_context",
            reason = reason,
            mapChallengeModeID = active.mapChallengeModeID,
            level = active.level,
        })
        return active
    end
    if active ~= nil then
        ClearActiveMythicPlusMemberCache(characterKey, reason or "inactive")
    end
    return nil
end

local function CaptureCompletionInfoMembers()
    local apiName = "GetChallengeCompletionInfo"
    if type(C_ChallengeMode) ~= "table"
        or type(C_ChallengeMode.GetChallengeCompletionInfo) ~= "function"
    then
        return nil, { apiName = nil }
    end

    local ok, info = pcall(C_ChallengeMode.GetChallengeCompletionInfo)
    if not ok or type(info) ~= "table" then
        return nil, { apiName = apiName, callFailed = true }
    end

    local infoMembers = GetFirstField(info, {
        "members",
        "partyMembers",
        "groupMembers",
        "roster",
    })

    return NormalizeMythicPlusMembers(infoMembers), {
        apiName = apiName,
        mapChallengeModeID = ToSafeNumber(GetFirstField(info, {
            "mapChallengeModeID",
            "challengeModeID",
            "mapID",
        })),
        level = ToSafeNumber(GetFirstField(info, {
            "level",
            "keystoneLevel",
        })),
        durationMs = ToSafeNumber(GetFirstField(info, {
            "time",
            "runTimeMs",
            "runTime",
            "durationMs",
        })),
        completedInTime = NormalizeOptionalBoolean(GetFirstField(info, {
            "onTime",
            "completedInTime",
            "intime",
        })),
        keystoneUpgradeLevels = ToSafeNumber(GetFirstField(info, {
            "keystoneUpgradeLevels",
            "upgradeLevels",
        })),
        memberCount = type(infoMembers) == "table" and #infoMembers or 0,
    }
end

local function CaptureCompletedRunMembers()
    local characterKey = GetCharKey()
    local key, name, realm, charInfo = GetCharacterIdentity()
    local entry = EnsureCharacterEntry(key, name, realm, charInfo)
    NormalizeAndDeduplicateRuns(entry)
    local latestStoredRun = type(entry.mythicPlusRuns) == "table" and entry.mythicPlusRuns[1] or nil
    local completionMembers, completionInfo = CaptureCompletionInfoMembers()
    local liveMembers, liveInfo = CaptureLiveGroupMembers()
    local activeCache = GetActiveMythicPlusMemberCache(characterKey)
    local cachedMembers = type(activeCache) == "table" and activeCache.members or nil
    local sourceParts = {}

    if type(completionMembers) == "table" and #completionMembers > 0 then
        sourceParts[#sourceParts + 1] = "completion_api"
    end
    if type(cachedMembers) == "table" and #cachedMembers > 0 then
        sourceParts[#sourceParts + 1] = "in_key_roster_cache"
    end
    if type(liveMembers) == "table" and #liveMembers > 0 then
        sourceParts[#sourceParts + 1] = "live_roster"
    end

    local members = MergeMythicPlusMemberLists(completionMembers, cachedMembers, liveMembers)
    local source = #sourceParts > 0 and table.concat(sourceParts, "+") or "unavailable"

    UpdateMythicPlusDebugState(characterKey, {
        lastCaptureAt = time(),
        lastCaptureSource = source,
        lastCaptureCount = type(members) == "table" and #members or 0,
        lastCompletionApiName = completionInfo.apiName,
        lastCompletionApiMemberCount = completionInfo.memberCount or 0,
        lastLiveRosterCount = liveInfo.groupSize or 0,
    })

    if type(members) ~= "table" or #members == 0 then
        AppendMythicPlusDebugEvent(characterKey, "members_capture_failed", {
            summary = "api " .. tostring(completionInfo.memberCount or 0)
                .. ", cache " .. tostring(type(activeCache) == "table" and type(activeCache.members) == "table" and #activeCache.members or 0)
                .. ", live " .. tostring(liveInfo.groupSize or 0),
            completionApiName = completionInfo.apiName,
            completionApiMemberCount = completionInfo.memberCount or 0,
            activeCacheCount = type(activeCache) == "table" and type(activeCache.members) == "table" and #activeCache.members or 0,
            liveRosterCount = liveInfo.groupSize or 0,
        })
        return
    end

    AppendMythicPlusDebugEvent(characterKey, "members_captured", {
        summary = source .. " (" .. tostring(#members) .. ")",
        source = source,
        memberCount = #members,
        completionApiName = completionInfo.apiName,
        completionApiMemberCount = completionInfo.memberCount or 0,
        activeCacheCount = type(activeCache) == "table" and type(activeCache.members) == "table" and #activeCache.members or 0,
        liveRosterCount = liveInfo.groupSize or 0,
        mapChallengeModeID = completionInfo.mapChallengeModeID or (type(activeCache) == "table" and activeCache.mapChallengeModeID or nil),
        level = completionInfo.level or (type(activeCache) == "table" and activeCache.level or nil),
    })

    if #members == 0 then
        return
    end

    SetPendingCompletedRunMembers(characterKey, {
        characterKey = characterKey,
        capturedAt = time(),
        members = members,
        source = source,
        mapChallengeModeID = completionInfo.mapChallengeModeID or (type(activeCache) == "table" and activeCache.mapChallengeModeID or nil),
        level = completionInfo.level or (type(activeCache) == "table" and activeCache.level or nil),
        durationMs = completionInfo.durationMs,
        completedInTime = completionInfo.completedInTime,
        keystoneUpgradeLevels = completionInfo.keystoneUpgradeLevels,
        historyRunCount = type(entry.mythicPlusRuns) == "table" and #entry.mythicPlusRuns or 0,
        latestKnownRunFingerprint = type(latestStoredRun) == "table" and latestStoredRun.fingerprint or nil,
        latestKnownRunSortValue = type(latestStoredRun) == "table" and GetRunSortValue(latestStoredRun) or nil,
    }, { reason = source })
    ClearActiveMythicPlusMemberCache(characterKey, "completed_to_pending")
end

local function GetRunDurationMs(run)
    local durationMs = tonumber(run.durationMs)
    if durationMs ~= nil and durationMs > 0 and durationMs <= MAX_REASONABLE_MYTHIC_PLUS_DURATION_MS then
        return math.floor(durationMs + 0.5)
    end

    local durationSeconds = GetFirstField(run, {
        "durationSec",
        "durationSeconds",
        "time",
        "runDuration",
    })
    if type(durationSeconds) == "number" and durationSeconds > 0 and durationSeconds <= (MAX_REASONABLE_MYTHIC_PLUS_DURATION_MS / 1000) then
        return math.floor(durationSeconds * 1000 + 0.5)
    end

    return nil
end

local function GetRunTerminalTimestamp(run)
    return NormalizeMythicPlusDate(run.endedAt)
        or NormalizeMythicPlusDate(run.completedAt)
        or NormalizeMythicPlusDate(run.abandonedAt)
end

local function NormalizeCompletedRunStartDate(run)
    if type(run) ~= "table" then
        return
    end

    local status = GetRunStatus(run)
    if status ~= "completed" and status ~= "abandoned" then
        return
    end

    local startDate = NormalizeMythicPlusDate(run.startDate)
    local terminalAt = GetRunTerminalTimestamp(run)
    local durationMs = GetRunDurationMs(run)
    if terminalAt == nil or durationMs == nil then
        return
    end

    local derivedStart = terminalAt - math.floor(durationMs / 1000 + 0.5)
    if startDate ~= nil
        and math.abs(startDate - derivedStart) <= COMPLETED_RUN_DERIVED_START_TOLERANCE_SECONDS
    then
        return
    end

    run.startDate = derivedStart
    run.attemptId = nil
    if type(run.fingerprint) == "string"
        and (string.sub(run.fingerprint, 1, 8) == "attempt|"
            or string.sub(run.fingerprint, 1, 12) == "aid|attempt|")
    then
        run.fingerprint = nil
    end
end

NormalizeOptionalBoolean = function(value)
    if IsSecretValue(value) then
        return nil
    end

    if type(value) == "boolean" then
        return value
    end

    if type(value) == "number" then
        if value == 0 then
            return false
        end
        if value == 1 then
            return true
        end
        return nil
    end

    if type(value) == "string" then
        local normalized = string.lower(strtrim(value))
        if normalized == "true" or normalized == "yes" or normalized == "1" then
            return true
        end
        if normalized == "false" or normalized == "no" or normalized == "0" then
            return false
        end
    end

    return nil
end

local function GetRunCompletionEstimate(run)
    local completedAt = NormalizeMythicPlusDate(run.completedAt)
        or NormalizeMythicPlusDate(run.completionDate)
        or NormalizeMythicPlusDate(run.completedDate)
        or NormalizeMythicPlusDate(run.endTime)
    if completedAt ~= nil then
        return completedAt
    end

    local startDate = NormalizeMythicPlusDate(run.startDate) or NormalizeMythicPlusDate(run.startedAt)
    local durationMs = GetRunDurationMs(run)
    if startDate ~= nil and durationMs ~= nil then
        return startDate + math.floor(durationMs / 1000 + 0.5)
    end

    return nil
end

local function AttachPendingCompletedRunMembers(runs, characterKey)
    if type(runs) ~= "table" then
        return
    end

    local pending = GetPendingCompletedRunMembers(characterKey)
    if type(pending) ~= "table" or type(pending.members) ~= "table" or #pending.members == 0 then
        SetPendingCompletedRunMembers(characterKey, nil, { reason = "empty_pending_members" })
        return
    end

    local capturedAt = tonumber(pending.capturedAt)
    if capturedAt == nil then
        SetPendingCompletedRunMembers(characterKey, nil, { reason = "missing_captured_at" })
        return
    end

    if math.abs(time() - capturedAt) > PENDING_RUN_MEMBER_RETENTION then
        ClearMythicPlusDebugFields(characterKey, {
            "lastAttachDiffSeconds",
            "lastAttachMapName",
            "lastAttachLevel",
        })
        UpdateMythicPlusDebugState(characterKey, {
            lastAttachAt = time(),
            lastAttachStatus = "expired",
        })
        SetPendingCompletedRunMembers(characterKey, nil, { reason = "pending_expired" })
        return
    end

    local bestIndex = nil
    local bestDiff = nil
    local bestMembers = nil
    local pendingMapChallengeModeID = tonumber(pending.mapChallengeModeID)
    local pendingLevel = tonumber(pending.level)
    local pendingCompletedInTime = type(pending.completedInTime) == "boolean" and pending.completedInTime or nil
    local pendingDurationMs = tonumber(pending.durationMs)
    local pendingHistoryRunCount = tonumber(pending.historyRunCount)
    local pendingLatestRunFingerprint =
        type(pending.latestKnownRunFingerprint) == "string" and pending.latestKnownRunFingerprint or nil
    local pendingLatestRunSortValue = tonumber(pending.latestKnownRunSortValue)

    AppendMythicPlusDebugEvent(characterKey, "attach_attempt", {
        summary = "runs " .. tostring(#runs),
        runCount = #runs,
        pendingSource = pending.source,
        pendingMapChallengeModeID = pendingMapChallengeModeID,
        pendingLevel = pendingLevel,
        pendingCompletedInTime = pendingCompletedInTime,
        pendingDurationMs = pendingDurationMs,
        pendingHistoryRunCount = pendingHistoryRunCount,
    })

    for index, run in ipairs(runs) do
        local runCompletedAt = GetRunCompletionEstimate(run)
        if runCompletedAt ~= nil and math.abs(runCompletedAt - capturedAt) <= PENDING_RUN_MEMBER_MATCH_WINDOW then
            local mapMatches = pendingMapChallengeModeID == nil or tonumber(run.mapChallengeModeID) == pendingMapChallengeModeID
            local levelMatches = pendingLevel == nil or tonumber(run.level) == pendingLevel
            local improvedMembers = GetImprovedMythicPlusMembers(run.members, pending.members)
            if mapMatches and levelMatches and improvedMembers ~= nil then
                local diff = math.abs(runCompletedAt - capturedAt)
                if bestDiff == nil or diff < bestDiff then
                    bestIndex = index
                    bestDiff = diff
                    bestMembers = improvedMembers
                end
            end
        end
    end

    if bestIndex ~= nil then
        runs[bestIndex].members = bestMembers
        UpdateMythicPlusDebugState(characterKey, {
            lastAttachAt = time(),
            lastAttachStatus = "attached",
            lastAttachDiffSeconds = bestDiff,
            lastAttachMapName = runs[bestIndex].mapName,
            lastAttachLevel = runs[bestIndex].level,
        })
        AppendMythicPlusDebugEvent(characterKey, "attach_success", {
            summary = tostring(runs[bestIndex].mapName or "?")
                .. " +" .. tostring(runs[bestIndex].level or "?")
                .. " (" .. tostring(bestDiff or "?") .. "s)",
            diffSeconds = bestDiff,
            mapName = runs[bestIndex].mapName,
            level = runs[bestIndex].level,
        })
        SetPendingCompletedRunMembers(characterKey, nil, { reason = "attached_to_history" })
    else
        local fallbackCandidates = {}

        for index, run in ipairs(runs) do
            local mapMatches = pendingMapChallengeModeID == nil or tonumber(run.mapChallengeModeID) == pendingMapChallengeModeID
            local levelMatches = pendingLevel == nil or tonumber(run.level) == pendingLevel
            local improvedMembers = GetImprovedMythicPlusMembers(run.members, pending.members)
            if mapMatches and levelMatches and improvedMembers ~= nil then
                local runSortValue = GetRunSortValue(run)
                local isAfterCapture = true
                if pendingLatestRunSortValue ~= nil or pendingLatestRunFingerprint ~= nil then
                    isAfterCapture = false
                    if pendingLatestRunSortValue ~= nil and runSortValue > pendingLatestRunSortValue then
                        isAfterCapture = true
                    elseif
                        pendingLatestRunSortValue == nil
                        and pendingLatestRunFingerprint ~= nil
                        and type(run.fingerprint) == "string"
                        and run.fingerprint ~= pendingLatestRunFingerprint
                    then
                        isAfterCapture = true
                    end
                end

                if isAfterCapture then
                    local durationDiff = nil
                    local runDurationMs = GetRunDurationMs(run)
                    if pendingDurationMs ~= nil and runDurationMs ~= nil then
                        durationDiff = math.abs(runDurationMs - pendingDurationMs)
                    end

                    local completionDiff = nil
                    local runCompletedAt = GetRunCompletionEstimate(run)
                    if runCompletedAt ~= nil then
                        completionDiff = math.abs(runCompletedAt - capturedAt)
                    end

                    fallbackCandidates[#fallbackCandidates + 1] = {
                        index = index,
                        durationDiff = durationDiff,
                        completionDiff = completionDiff,
                        outcomeMatches =
                            pendingCompletedInTime == nil
                            or run.completedInTime == nil
                            or run.completedInTime == pendingCompletedInTime,
                        mergedMembers = improvedMembers,
                        thisWeek = run.thisWeek == true,
                        run = run,
                    }
                end
            end
        end

        if pendingDurationMs ~= nil then
            local durationFiltered = {}
            for _, candidate in ipairs(fallbackCandidates) do
                if candidate.durationDiff == nil or candidate.durationDiff <= (2 * 60 * 1000) then
                    durationFiltered[#durationFiltered + 1] = candidate
                end
            end
            if #durationFiltered > 0 then
                fallbackCandidates = durationFiltered
            end
        end

        table.sort(fallbackCandidates, function(a, b)
            local aCompletionDiff = a.completionDiff
            local bCompletionDiff = b.completionDiff
            if aCompletionDiff ~= nil and bCompletionDiff ~= nil and aCompletionDiff ~= bCompletionDiff then
                return aCompletionDiff < bCompletionDiff
            end
            if aCompletionDiff ~= nil and bCompletionDiff == nil then
                return true
            end
            if aCompletionDiff == nil and bCompletionDiff ~= nil then
                return false
            end

            local aDurationDiff = a.durationDiff
            local bDurationDiff = b.durationDiff
            if aDurationDiff ~= nil and bDurationDiff ~= nil and aDurationDiff ~= bDurationDiff then
                return aDurationDiff < bDurationDiff
            end
            if aDurationDiff ~= nil and bDurationDiff == nil then
                return true
            end
            if aDurationDiff == nil and bDurationDiff ~= nil then
                return false
            end

            if a.outcomeMatches ~= b.outcomeMatches then
                return a.outcomeMatches == true
            end
            if a.thisWeek ~= b.thisWeek then
                return a.thisWeek == true
            end

            return a.index < b.index
        end)

        local bestCandidate = fallbackCandidates[1]
        local secondCandidate = fallbackCandidates[2]
        local fallbackUnique = #fallbackCandidates == 1

        if not fallbackUnique and bestCandidate ~= nil then
            local bestCompletionDiff = bestCandidate.completionDiff
            local secondCompletionDiff = secondCandidate and secondCandidate.completionDiff or nil
            local bestDurationDiff = bestCandidate.durationDiff
            local secondDurationDiff = secondCandidate and secondCandidate.durationDiff or nil

            local uniqueByCompletion =
                bestCompletionDiff ~= nil
                and bestCompletionDiff <= (3 * 60 * 60)
                and (secondCompletionDiff == nil or (secondCompletionDiff - bestCompletionDiff) > (15 * 60))
            local uniqueByDuration =
                bestDurationDiff ~= nil
                and bestDurationDiff <= (2 * 60 * 1000)
                and (secondDurationDiff == nil or (secondDurationDiff - bestDurationDiff) > (60 * 1000))
            local uniqueByWeek =
                bestCandidate.thisWeek == true
                and (secondCandidate == nil or secondCandidate.thisWeek ~= true)

            fallbackUnique = uniqueByCompletion or uniqueByDuration or uniqueByWeek
        end

        if fallbackUnique and bestCandidate ~= nil then
            local candidate = bestCandidate
            runs[candidate.index].members = candidate.mergedMembers
            if candidate.durationDiff == nil then
                ClearMythicPlusDebugFields(characterKey, {
                    "lastAttachDiffSeconds",
                })
            end
            UpdateMythicPlusDebugState(characterKey, {
                lastAttachAt = time(),
                lastAttachStatus = "attached_fallback",
                lastAttachDiffSeconds = candidate.durationDiff and math.floor(candidate.durationDiff / 1000 + 0.5) or nil,
                lastAttachMapName = runs[candidate.index].mapName,
                lastAttachLevel = runs[candidate.index].level,
            })
            AppendMythicPlusDebugEvent(characterKey, "attach_success", {
                summary = tostring(runs[candidate.index].mapName or "?")
                    .. " +" .. tostring(runs[candidate.index].level or "?")
                    .. " (fallback)",
                mapName = runs[candidate.index].mapName,
                level = runs[candidate.index].level,
                durationDiffMs = candidate.durationDiff,
                completionDiffSeconds = candidate.completionDiff,
                method = "fallback_ranked_map_level",
            })
            SetPendingCompletedRunMembers(characterKey, nil, { reason = "attached_to_history_fallback" })
            return
        end

        ClearMythicPlusDebugFields(characterKey, {
            "lastAttachDiffSeconds",
            "lastAttachMapName",
            "lastAttachLevel",
        })
        UpdateMythicPlusDebugState(characterKey, {
            lastAttachAt = time(),
            lastAttachStatus = "no_match_yet",
        })
        AppendMythicPlusDebugEvent(characterKey, "attach_miss", {
            summary = "waiting for history match (" .. tostring(#fallbackCandidates) .. " fallback)",
            pendingMapChallengeModeID = pendingMapChallengeModeID,
            pendingLevel = pendingLevel,
            fallbackCandidateCount = #fallbackCandidates,
        })
    end
end

NormalizeMythicPlusDate = function(value)
    if IsSecretValue(value) then
        return nil
    end
    if type(value) == "number" then
        return value
    end

    if type(value) ~= "table" then
        return nil
    end

    local function CalendarToLocalEpoch(calendar)
        if type(calendar) ~= "table" then
            return nil
        end

        local year = ToSafeNumber(calendar.year)
        local month = ToSafeNumber(calendar.month)
        local currentMonthDay = ToSafeNumber(calendar.monthDay)
        local legacyDay = ToSafeNumber(calendar.day)
        local day = currentMonthDay or legacyDay
        if not year or not month or not day then
            return nil
        end

        if year < 100 then
            year = 2000 + year
        end

        -- CalendarTime (the current API shape) is 1-based. Older history
        -- payloads used day/month fields that this addon stored as 0-based.
        if currentMonthDay == nil then
            month = month + 1
            day = day + 1
        end
        if month < 1 or month > 12 or day < 1 or day > 31 then
            return nil
        end

        local ok, epoch = pcall(time, {
            year = year,
            month = month,
            day = day,
            hour = ToSafeNumber(calendar.hour) or 0,
            min = ToSafeNumber(calendar.minute) or ToSafeNumber(calendar.min) or 0,
            sec = ToSafeNumber(calendar.second) or ToSafeNumber(calendar.sec) or 0,
        })
        if not ok then
            return nil
        end
        return ToSafeNumber(epoch)
    end

    local localEpoch = CalendarToLocalEpoch(value)
    if localEpoch == nil then
        return nil
    end

    -- Mythic+ completion dates are realm calendar times. Anchor them to the
    -- current realm calendar so the operating-system time zone cannot shift
    -- fingerprints for players whose machine and realm use different zones.
    if type(C_DateAndTime) == "table"
        and type(C_DateAndTime.GetCurrentCalendarTime) == "function"
    then
        local ok, currentCalendar = pcall(C_DateAndTime.GetCurrentCalendarTime)
        local currentLocalEpoch = ok and CalendarToLocalEpoch(currentCalendar) or nil
        local nowEpoch = ToSafeNumber(time())
        if currentLocalEpoch ~= nil and nowEpoch ~= nil then
            return nowEpoch + math.floor(difftime(localEpoch, currentLocalEpoch))
        end
    end

    return localEpoch
end

GetRunSortValue = function(run)
    return NormalizeMythicPlusDate(run.endedAt)
        or NormalizeMythicPlusDate(run.abandonedAt)
        or NormalizeMythicPlusDate(run.completedAt)
        or NormalizeMythicPlusDate(run.completionDate)
        or NormalizeMythicPlusDate(run.startDate)
        or tonumber(run.observedAt)
        or 0
end

local function GetChallengeModeMapName(mapChallengeModeID)
    local numericMapID = ToSafeNumber(mapChallengeModeID)
    if not numericMapID then
        return nil
    end
    if runtimeState.challengeModeMapNameCache[numericMapID] ~= nil then
        return runtimeState.challengeModeMapNameCache[numericMapID] or nil
    end
    if not C_ChallengeMode or type(C_ChallengeMode.GetMapUIInfo) ~= "function" then
        return nil
    end

    local ok, mapName = pcall(C_ChallengeMode.GetMapUIInfo, numericMapID)
    if ok and type(mapName) == "string" and mapName ~= "" then
        runtimeState.challengeModeMapNameCache[numericMapID] = mapName
        return mapName
    end

    return nil
end

local function ToFingerprintToken(value)
    if IsSecretValue(value) or value == nil then
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

local function NormalizeRunStatusValue(value)
    if type(value) ~= "string" then
        return nil
    end

    local normalized = string.lower(strtrim(value))
    if normalized == "active" or normalized == "completed" or normalized == "abandoned" then
        return normalized
    end

    return nil
end

local function NormalizeAbandonReason(value)
    if type(value) ~= "string" then
        return nil
    end

    local normalized = string.lower(strtrim(value))
    if normalized == "challenge_mode_reset"
        or normalized == "left_instance"
        or normalized == "leaver_timer"
        or normalized == "history_incomplete"
        or normalized == "stale_recovery"
        or normalized == "unknown" then
        return normalized
    end

    return nil
end

local function HasRunCompletionEvidence(run)
    if run.completed == false then
        return false
    end

    return run.completed == true
        or run.durationMs ~= nil
        or run.runScore ~= nil
        or NormalizeMythicPlusDate(run.completedAt) ~= nil
end

local function HasRunAbandonmentEvidence(run)
    return NormalizeMythicPlusDate(run.abandonedAt) ~= nil
        or NormalizeAbandonReason(run.abandonReason) ~= nil
        or (NormalizeMythicPlusDate(run.endedAt) ~= nil and not HasRunCompletionEvidence(run))
end

GetRunStatus = function(run)
    local explicitStatus = NormalizeRunStatusValue(run.status)
    if explicitStatus ~= nil then
        return explicitStatus
    end
    if HasRunCompletionEvidence(run) then
        return "completed"
    end
    if HasRunAbandonmentEvidence(run) then
        return "abandoned"
    end
    return nil
end

local function GetRunStatusPriority(status)
    if status == "completed" then
        return 3
    end
    if status == "abandoned" then
        return 2
    end
    if status == "active" then
        return 1
    end
    return 0
end

local function IsTemporaryRunFingerprint(fingerprint)
    return type(fingerprint) == "string" and string.sub(fingerprint, 1, 8) == "attempt|"
end

local function GetRunMapFingerprintToken(run)
    if run.mapChallengeModeID ~= nil then
        return ToFingerprintToken(run.mapChallengeModeID)
    end

    if type(run.mapName) == "string" then
        local normalizedName = strtrim(run.mapName)
        if normalizedName ~= "" then
            return string.lower(normalizedName)
        end
    end

    return ""
end

local function GetRunIdentityTimestamp(run)
    return NormalizeMythicPlusDate(run.startDate)
        or NormalizeMythicPlusDate(run.completedAt)
        or NormalizeMythicPlusDate(run.endedAt)
        or NormalizeMythicPlusDate(run.abandonedAt)
end

local function GetRunAttemptID(run)
    local explicitAttemptID = type(run.attemptId) == "string" and strtrim(run.attemptId) or nil
    if explicitAttemptID == "" then
        explicitAttemptID = nil
    end
    if explicitAttemptID ~= nil then
        return explicitAttemptID
    end

    local fingerprintAttemptID = type(run.fingerprint) == "string" and strtrim(run.fingerprint) or nil
    if fingerprintAttemptID == "" then
        fingerprintAttemptID = nil
    end
    if fingerprintAttemptID ~= nil and IsTemporaryRunFingerprint(fingerprintAttemptID) then
        return fingerprintAttemptID
    end

    local mapToken = GetRunMapFingerprintToken(run)
    local startDate = NormalizeMythicPlusDate(run.startDate)
    if mapToken == "" or run.level == nil or startDate == nil or startDate <= 0 then
        return nil
    end

    return table.concat({
        "attempt",
        ToFingerprintToken(run.seasonID),
        mapToken,
        ToFingerprintToken(run.level),
        ToFingerprintToken(startDate),
    }, "|")
end

local function BuildLegacyRunFingerprint(run)
    return table.concat({
        ToFingerprintToken(GetRunAttemptID(run)),
        ToFingerprintToken(run.seasonID),
        GetRunMapFingerprintToken(run),
        ToFingerprintToken(run.level),
        ToFingerprintToken(run.status),
        ToFingerprintToken(run.completed),
        ToFingerprintToken(run.completedInTime),
        ToFingerprintToken(run.durationMs),
        ToFingerprintToken(run.runScore),
        ToFingerprintToken(run.endedAt),
        ToFingerprintToken(run.abandonedAt),
        ToFingerprintToken(run.abandonReason),
        ToFingerprintToken(run.completedAt),
        ToFingerprintToken(run.startDate),
    }, "|")
end

local function BuildRunFingerprint(run)
    local attemptID = GetRunAttemptID(run)
    if attemptID ~= nil then
        return "aid|" .. attemptID
    end

    local mapToken = GetRunMapFingerprintToken(run)
    local identityTimestamp = GetRunIdentityTimestamp(run)

    if mapToken == "" or run.level == nil then
        return BuildLegacyRunFingerprint(run)
    end

    if identityTimestamp ~= nil then
        return table.concat({
            ToFingerprintToken(run.seasonID),
            mapToken,
            ToFingerprintToken(run.level),
            ToFingerprintToken(identityTimestamp),
        }, "|")
    end

    if run.durationMs ~= nil or run.runScore ~= nil then
        return table.concat({
            ToFingerprintToken(run.seasonID),
            mapToken,
            ToFingerprintToken(run.level),
            ToFingerprintToken(run.durationMs),
            ToFingerprintToken(run.runScore),
        }, "|")
    end

    return BuildLegacyRunFingerprint(run)
end

GetRunDedupKey = function(run)
    return BuildRunFingerprint(run)
end

local LEAVER_TIMER_REASON_WINDOW_SECONDS = 10 * 60

local function NormalizeLifecycleTimestamp(value)
    local normalized = NormalizeMythicPlusDate(value)
    if type(normalized) ~= "number" then
        return nil
    end
    if normalized > 10000000000 then
        normalized = math.floor(normalized / 1000)
    end
    if normalized <= 0 then
        return nil
    end
    return normalized
end

function runtimeState.RequestMythicPlusMapInfoOnce()
    if runtimeState.mythicPlusMapInfoRequested then
        return true
    end
    if type(C_MythicPlus) ~= "table" or type(C_MythicPlus.RequestMapInfo) ~= "function" then
        return false
    end

    local ok = pcall(C_MythicPlus.RequestMapInfo)
    if ok then
        runtimeState.mythicPlusMapInfoRequested = true
    end
    return ok == true
end

local function GetCurrentMythicPlusSeasonID()
    local function NormalizeSeasonID(value)
        local seasonID = tonumber(value)
        if seasonID and seasonID > 0 then
            return seasonID
        end

        return nil
    end

    if runtimeState.cachedCurrentMythicPlusSeasonID ~= nil then
        return runtimeState.cachedCurrentMythicPlusSeasonID
    end

    if type(C_MythicPlus) ~= "table" then
        return nil
    end

    runtimeState.RequestMythicPlusMapInfoOnce()

    if type(C_MythicPlus.GetCurrentSeason) == "function" then
        local ok, seasonID = pcall(C_MythicPlus.GetCurrentSeason)
        local normalized = ok and NormalizeSeasonID(seasonID) or nil
        if normalized then
            runtimeState.cachedCurrentMythicPlusSeasonID = normalized
            return normalized
        end
    end

    if type(C_MythicPlus.GetCurrentUIDisplaySeason) == "function" then
        local ok, seasonID = pcall(C_MythicPlus.GetCurrentUIDisplaySeason)
        local normalized = ok and NormalizeSeasonID(seasonID) or nil
        if normalized then
            runtimeState.cachedCurrentMythicPlusSeasonID = normalized
            return normalized
        end
    end

    return nil
end

local function GetChallengeModeStartTimestamp()
    local nowTs = time()
    if type(C_ChallengeMode) == "table" and type(C_ChallengeMode.GetStartTime) == "function" then
        local ok, value = pcall(C_ChallengeMode.GetStartTime)
        if ok then
            local rawStart = ToSafeNumber(value)
            if rawStart ~= nil then
                local normalized = nil
                if rawStart >= 1000000000 then
                    normalized = NormalizeLifecycleTimestamp(rawStart)
                elseif type(GetTime) == "function" then
                    local okMonotonic, monotonicNow = pcall(GetTime)
                    monotonicNow = okMonotonic and ToSafeNumber(monotonicNow) or nil
                    if monotonicNow ~= nil then
                        local elapsed = monotonicNow - rawStart
                        if elapsed >= -5 * 60
                            and elapsed <= (MAX_REASONABLE_MYTHIC_PLUS_DURATION_MS / 1000)
                        then
                            normalized = nowTs - math.floor(elapsed + 0.5)
                        end
                    end
                end

                if normalized ~= nil
                    and normalized <= (nowTs + 5 * 60)
                    and normalized >= (nowTs - MAX_REASONABLE_MYTHIC_PLUS_DURATION_MS / 1000)
                then
                    return normalized
                end
            end
        end
    end

    return nowTs
end

local function BuildSyntheticAttemptFingerprint(run)
    return GetRunAttemptID(run)
        or table.concat({
            "attempt",
            ToFingerprintToken(run.seasonID),
            GetRunMapFingerprintToken(run),
            ToFingerprintToken(run.level),
            ToFingerprintToken(run.startDate or run.observedAt or time()),
        }, "|")
end

local function NormalizeRunIdentityString(value)
    if type(value) ~= "string" then
        return nil
    end
    local trimmed = strtrim(value)
    if trimmed == "" then
        return nil
    end
    return trimmed
end

local runLookup = {}

function runLookup.GetIdentityKeys(run)
    if type(run) ~= "table" then
        return {}
    end

    local keys = {}
    local seen = {}
    local function AddKey(prefix, value)
        local normalized = NormalizeRunIdentityString(value)
        if normalized == nil then
            return
        end
        local key = prefix .. normalized
        if not seen[key] then
            seen[key] = true
            keys[#keys + 1] = key
        end
    end

    AddKey("attempt|", GetRunAttemptID(run))
    AddKey("fingerprint|", run.fingerprint)
    AddKey("dedup|", GetRunDedupKey(run))
    return keys
end

function runLookup.GetMergeBucketKey(run)
    if type(run) ~= "table" then
        return nil
    end

    local mapToken = GetRunMapFingerprintToken(run)
    local level = ToSafeNumber(run.level)
    if mapToken == "" or level == nil then
        return nil
    end

    return table.concat({
        mapToken,
        ToFingerprintToken(level),
    }, "|")
end

function runLookup.Add(identityIndex, run, index)
    if type(identityIndex) ~= "table" or type(run) ~= "table" or type(index) ~= "number" then
        return
    end

    identityIndex.keys = identityIndex.keys or {}
    for _, key in ipairs(runLookup.GetIdentityKeys(run)) do
        if identityIndex.keys[key] == nil then
            identityIndex.keys[key] = index
        end
    end

    local bucketKey = runLookup.GetMergeBucketKey(run)
    if bucketKey ~= nil then
        identityIndex.buckets = identityIndex.buckets or {}
        identityIndex.bucketSeen = identityIndex.bucketSeen or {}
        identityIndex.buckets[bucketKey] = identityIndex.buckets[bucketKey] or {}
        identityIndex.bucketSeen[bucketKey] = identityIndex.bucketSeen[bucketKey] or {}
        if not identityIndex.bucketSeen[bucketKey][index] then
            identityIndex.bucketSeen[bucketKey][index] = true
            identityIndex.buckets[bucketKey][#identityIndex.buckets[bucketKey] + 1] = index
        end
    end
end

function runLookup.Build(runs)
    local identityIndex = { keys = {}, buckets = {}, bucketSeen = {} }
    if type(runs) == "table" then
        for index, run in ipairs(runs) do
            runLookup.Add(identityIndex, run, index)
        end
    end
    return identityIndex
end

function runLookup.FindExact(runs, candidateRun, identityIndex)
    if type(runs) ~= "table" or type(candidateRun) ~= "table" then
        return nil
    end

    if type(identityIndex) == "table" and type(identityIndex.keys) == "table" then
        for _, key in ipairs(runLookup.GetIdentityKeys(candidateRun)) do
            local index = identityIndex.keys[key]
            if type(index) == "number" and type(runs[index]) == "table" then
                return index
            end
        end
    end

    local candidateAttemptID = GetRunAttemptID(candidateRun)
    local candidateFingerprint = NormalizeRunIdentityString(candidateRun.fingerprint)
    local candidateDedupKey = GetRunDedupKey(candidateRun)
    for index, currentRun in ipairs(runs) do
        if type(currentRun) == "table" then
            if candidateAttemptID ~= nil then
                local currentAttemptID = GetRunAttemptID(currentRun)
                if currentAttemptID ~= nil and currentAttemptID == candidateAttemptID then
                    return index
                end
            end

            if candidateFingerprint ~= nil then
                local currentFingerprint = NormalizeRunIdentityString(currentRun.fingerprint)
                if currentFingerprint ~= nil and currentFingerprint == candidateFingerprint then
                    return index
                end
            end

            if candidateDedupKey ~= nil and GetRunDedupKey(currentRun) == candidateDedupKey then
                return index
            end
        end
    end

    return nil
end

function runLookup.FindMergeable(runs, candidateRun, identityIndex)
    local exactIndex = runLookup.FindExact(runs, candidateRun, identityIndex)
    if exactIndex ~= nil then
        return exactIndex
    end

    local candidateStart = GetRunIdentityTimestamp(candidateRun)
    if candidateStart == nil then
        return nil
    end

    local candidateStatus = GetRunStatus(candidateRun)
    local bucketKey = runLookup.GetMergeBucketKey(candidateRun)
    local candidateIndexes = type(identityIndex) == "table"
        and type(identityIndex.buckets) == "table"
        and bucketKey ~= nil
        and identityIndex.buckets[bucketKey]
        or nil
    local bestIndex = nil
    local bestDifference = nil

    local function Consider(index)
        local currentRun = runs[index]
        if type(currentRun) ~= "table" then
            return
        end

        local currentSeason = ToSafeNumber(currentRun.seasonID)
        local candidateSeason = ToSafeNumber(candidateRun.seasonID)
        if currentSeason ~= nil and candidateSeason ~= nil and currentSeason ~= candidateSeason then
            return
        end
        if GetRunMapFingerprintToken(currentRun) ~= GetRunMapFingerprintToken(candidateRun)
            or ToSafeNumber(currentRun.level) ~= ToSafeNumber(candidateRun.level)
        then
            return
        end

        local currentStatus = GetRunStatus(currentRun)
        if currentStatus ~= candidateStatus
            and currentStatus ~= "active"
            and candidateStatus ~= "active"
        then
            return
        end

        local currentStart = GetRunIdentityTimestamp(currentRun)
        if currentStart == nil then
            return
        end
        local difference = math.abs(currentStart - candidateStart)
        if difference <= COMPLETED_RUN_DERIVED_START_TOLERANCE_SECONDS
            and (bestDifference == nil or difference < bestDifference)
        then
            bestDifference = difference
            bestIndex = index
        end
    end

    if type(candidateIndexes) == "table" then
        for _, index in ipairs(candidateIndexes) do
            Consider(index)
        end
    else
        for index in ipairs(runs) do
            Consider(index)
        end
    end

    return bestIndex
end

local function DidMythicPlusRunChange(currentRun, mergedRun)
    if currentRun == nil and mergedRun ~= nil then
        return true
    end
    if currentRun == nil or mergedRun == nil then
        return false
    end

    if currentRun.fingerprint ~= mergedRun.fingerprint then return true end
    if currentRun.attemptId ~= mergedRun.attemptId then return true end
    if currentRun.status ~= mergedRun.status then return true end
    if currentRun.completed ~= mergedRun.completed then return true end
    if currentRun.completedInTime ~= mergedRun.completedInTime then return true end
    if currentRun.durationMs ~= mergedRun.durationMs then return true end
    if currentRun.runScore ~= mergedRun.runScore then return true end
    if currentRun.mapName ~= mergedRun.mapName then return true end
    if currentRun.mapChallengeModeID ~= mergedRun.mapChallengeModeID then return true end
    if currentRun.level ~= mergedRun.level then return true end
    if currentRun.startDate ~= mergedRun.startDate then return true end
    if currentRun.completedAt ~= mergedRun.completedAt then return true end
    if currentRun.endedAt ~= mergedRun.endedAt then return true end
    if currentRun.abandonedAt ~= mergedRun.abandonedAt then return true end
    if currentRun.abandonReason ~= mergedRun.abandonReason then return true end
    if currentRun.seasonID ~= mergedRun.seasonID then return true end
    if currentRun.thisWeek ~= mergedRun.thisWeek then return true end
    if not AreMythicPlusMemberListsEqual(currentRun.members, mergedRun.members) then return true end

    return false
end

local function GetRunCompletenessScore(run)
    local score = 0
    local status = GetRunStatus(run)

    if run.seasonID ~= nil then score = score + 1 end
    if run.mapChallengeModeID ~= nil then score = score + 3 end
    if type(run.mapName) == "string" and run.mapName ~= "" then score = score + 1 end
    if run.level ~= nil then score = score + 2 end
    if GetRunAttemptID(run) ~= nil then score = score + 4 end
    if status == "active" then score = score + 2 end
    if status == "abandoned" then score = score + 3 end
    if status == "completed" then score = score + 4 end
    if run.startDate ~= nil then score = score + 4 end
    if run.completedAt ~= nil then score = score + 4 end
    if run.endedAt ~= nil then score = score + 3 end
    if run.abandonedAt ~= nil then score = score + 2 end
    if run.abandonReason ~= nil then score = score + 1 end
    if run.durationMs ~= nil then score = score + 3 end
    if run.runScore ~= nil then score = score + 3 end
    if run.completedInTime ~= nil then score = score + 2 end
    if run.completed ~= nil then score = score + 1 end
    if run.thisWeek ~= nil then score = score + 1 end
    if type(run.members) == "table" and #run.members > 0 then score = score + 3 end

    return score
end

local function PickDefinedValue(preferredValue, fallbackValue)
    if preferredValue ~= nil then
        return preferredValue
    end

    return fallbackValue
end

local function PickMergedSeasonID(preferredValue, fallbackValue)
    local preferredSeason = tonumber(preferredValue)
    local fallbackSeason = tonumber(fallbackValue)
    if preferredSeason ~= nil
        and fallbackSeason ~= nil
        and preferredSeason > 0
        and fallbackSeason > 0
        and preferredSeason ~= fallbackSeason
    then
        return math.max(preferredSeason, fallbackSeason)
    end

    return PickDefinedValue(preferredValue, fallbackValue)
end

MergeStoredMythicPlusRun = function(currentRun, candidateRun)
    if type(currentRun) ~= "table" then
        return candidateRun
    end
    if type(candidateRun) ~= "table" then
        return currentRun
    end

    local candidatePreferred = ShouldReplaceStoredRun(currentRun, candidateRun)
    local preferredRun = candidatePreferred and candidateRun or currentRun
    local fallbackRun = candidatePreferred and currentRun or candidateRun
    local mergedMembers = MergeMythicPlusMemberLists(currentRun.members, candidateRun.members)
    local function MergeLifecycleTimestampValues(preferredValue, fallbackValue)
        local preferredTimestamp = NormalizeMythicPlusDate(preferredValue)
        local fallbackTimestamp = NormalizeMythicPlusDate(fallbackValue)

        if preferredTimestamp == nil then
            return fallbackTimestamp
        end
        if fallbackTimestamp == nil then
            return preferredTimestamp
        end

        if preferredTimestamp == fallbackTimestamp then
            return preferredTimestamp
        end

        if math.abs(preferredTimestamp - fallbackTimestamp) == (60 * 60) then
            return math.max(preferredTimestamp, fallbackTimestamp)
        end

        return preferredTimestamp
    end
    local preferredObservedAt = tonumber(preferredRun.observedAt) or 0
    local fallbackObservedAt = tonumber(fallbackRun.observedAt) or 0
    local mergedObservedAt
    if preferredObservedAt > 0 and fallbackObservedAt > 0 then
        mergedObservedAt = math.min(preferredObservedAt, fallbackObservedAt)
    elseif preferredObservedAt > 0 then
        mergedObservedAt = preferredObservedAt
    else
        mergedObservedAt = fallbackObservedAt
    end

    local mergedRun = {
        fingerprint = PickDefinedValue(preferredRun.fingerprint, fallbackRun.fingerprint),
        attemptId = PickDefinedValue(GetRunAttemptID(preferredRun), GetRunAttemptID(fallbackRun)),
        observedAt = mergedObservedAt > 0 and mergedObservedAt or PickDefinedValue(preferredRun.observedAt, fallbackRun.observedAt),
        seasonID = PickMergedSeasonID(preferredRun.seasonID, fallbackRun.seasonID),
        mapChallengeModeID = PickDefinedValue(preferredRun.mapChallengeModeID, fallbackRun.mapChallengeModeID),
        mapName = PickDefinedValue(preferredRun.mapName, fallbackRun.mapName),
        level = PickDefinedValue(preferredRun.level, fallbackRun.level),
        status = PickDefinedValue(preferredRun.status, fallbackRun.status),
        completed = PickDefinedValue(preferredRun.completed, fallbackRun.completed),
        completedInTime = PickDefinedValue(preferredRun.completedInTime, fallbackRun.completedInTime),
        durationMs = PickDefinedValue(preferredRun.durationMs, fallbackRun.durationMs),
        runScore = PickDefinedValue(preferredRun.runScore, fallbackRun.runScore),
        startDate = MergeLifecycleTimestampValues(preferredRun.startDate, fallbackRun.startDate),
        completedAt = MergeLifecycleTimestampValues(preferredRun.completedAt, fallbackRun.completedAt),
        endedAt = MergeLifecycleTimestampValues(preferredRun.endedAt, fallbackRun.endedAt),
        abandonedAt = MergeLifecycleTimestampValues(preferredRun.abandonedAt, fallbackRun.abandonedAt),
        abandonReason = PickDefinedValue(preferredRun.abandonReason, fallbackRun.abandonReason),
        thisWeek = PickDefinedValue(preferredRun.thisWeek, fallbackRun.thisWeek),
    }

    if mergedMembers ~= nil then
        mergedRun.members = mergedMembers
    end

    local mergedStatus = GetRunStatus(mergedRun)
    if mergedStatus ~= nil then
        mergedRun.status = mergedStatus
        if mergedStatus == "completed" then
            mergedRun.completed = true
            if mergedRun.endedAt == nil then
                mergedRun.endedAt = mergedRun.completedAt
            end
        elseif mergedStatus == "abandoned" then
            if mergedRun.endedAt == nil then
                mergedRun.endedAt = mergedRun.abandonedAt
            end
            if mergedRun.abandonedAt == nil then
                mergedRun.abandonedAt = mergedRun.endedAt
            end
            mergedRun.abandonReason = NormalizeAbandonReason(mergedRun.abandonReason) or "unknown"
        end
    end

    local canonicalFingerprint = BuildRunFingerprint(mergedRun)
    if canonicalFingerprint ~= nil and (mergedRun.status ~= "active" or not IsTemporaryRunFingerprint(mergedRun.fingerprint)) then
        mergedRun.fingerprint = canonicalFingerprint
    end
    mergedRun.attemptId = GetRunAttemptID(mergedRun)

    return mergedRun
end

ShouldReplaceStoredRun = function(currentRun, candidateRun)
    if not currentRun then
        return true
    end

    local currentStatusPriority = GetRunStatusPriority(GetRunStatus(currentRun))
    local candidateStatusPriority = GetRunStatusPriority(GetRunStatus(candidateRun))
    if candidateStatusPriority ~= currentStatusPriority then
        return candidateStatusPriority > currentStatusPriority
    end

    local currentDedupKey = GetRunDedupKey(currentRun)
    local candidateDedupKey = GetRunDedupKey(candidateRun)
    if currentDedupKey == candidateDedupKey then
        local currentIsTemporary = IsTemporaryRunFingerprint(currentRun.fingerprint)
        local candidateIsTemporary = IsTemporaryRunFingerprint(candidateRun.fingerprint)
        if currentIsTemporary ~= candidateIsTemporary then
            return not candidateIsTemporary
        end
    end

    local currentScore = GetRunCompletenessScore(currentRun)
    local candidateScore = GetRunCompletenessScore(candidateRun)
    if candidateScore ~= currentScore then
        return candidateScore > currentScore
    end

    local candidateSort = GetRunSortValue(candidateRun)
    local currentSort = GetRunSortValue(currentRun)
    if candidateSort ~= currentSort then
        return candidateSort > currentSort
    end

    return (tonumber(candidateRun.observedAt) or 0) > (tonumber(currentRun.observedAt) or 0)
end

NormalizeStoredMythicPlusRun = function(run)
    if type(run) ~= "table" then
        return nil
    end

    local legacyRaw = type(run.raw) == "table" and run.raw or nil
    do
        local attemptCandidates = {
            run.attemptId,
            run.attemptID,
            legacyRaw and legacyRaw.attemptId or nil,
            legacyRaw and legacyRaw.attemptID or nil,
        }
        local normalizedAttemptID = nil
        for _, candidate in ipairs(attemptCandidates) do
            if type(candidate) == "string" then
                local trimmed = strtrim(candidate)
                if trimmed ~= "" then
                    normalizedAttemptID = trimmed
                    break
                end
            end
        end
        run.attemptId = normalizedAttemptID
    end
    local rawMembers = GetFirstField(run, { "members", "partyMembers", "groupMembers", "roster" })
    if rawMembers == nil and legacyRaw ~= nil then
        rawMembers = GetFirstField(legacyRaw, { "members", "partyMembers", "groupMembers", "roster" })
    end

    if run.durationMs == nil then
        local durationSeconds = GetFirstField(run, {
            "durationSec",
            "durationSeconds",
            "time",
            "runDuration",
        })
        if type(durationSeconds) == "number"
            and durationSeconds > 0
            and durationSeconds <= (MAX_REASONABLE_MYTHIC_PLUS_DURATION_MS / 1000)
        then
            run.durationMs = math.floor(durationSeconds * 1000 + 0.5)
        end
    end
    if type(run.durationMs) == "number" and (run.durationMs <= 0 or run.durationMs > MAX_REASONABLE_MYTHIC_PLUS_DURATION_MS) then
        run.durationMs = nil
    end

    if run.completedAt == nil then
        run.completedAt = GetFirstField(run, {
            "completionDate",
            "completedDate",
            "endTime",
        })
    end
    run.completedAt = NormalizeMythicPlusDate(run.completedAt)
        or NormalizeMythicPlusDate(run.completionDate)
        or NormalizeMythicPlusDate(run.completedDate)
        or NormalizeMythicPlusDate(run.endTime)
    run.endedAt = NormalizeMythicPlusDate(run.endedAt)
        or NormalizeMythicPlusDate(GetFirstField(run, { "abandonedAt" }))
    run.abandonedAt = NormalizeMythicPlusDate(run.abandonedAt)
        or NormalizeMythicPlusDate(GetFirstField(run, { "endedAt" }))
    run.startDate = NormalizeMythicPlusDate(run.startDate) or NormalizeMythicPlusDate(run.startedAt)

    if run.mapChallengeModeID == nil then
        run.mapChallengeModeID = GetFirstField(run, { "challengeModeID", "mapID" })
    end
    if run.mapName == nil or run.mapName == "" then
        run.mapName = GetFirstField(run, { "mapName", "name", "zoneName", "shortName" })
            or GetChallengeModeMapName(run.mapChallengeModeID)
    end

    if run.level == nil then
        run.level = GetFirstField(run, { "keystoneLevel" })
    end

    if run.completed == nil then
        run.completed = GetFirstField(run, { "finishedSuccess", "isCompleted" })
    end
    run.completed = NormalizeOptionalBoolean(run.completed)

    if run.completedInTime == nil then
        run.completedInTime = GetFirstField(run, { "intime", "onTime" })
    end
    run.completedInTime = NormalizeOptionalBoolean(run.completedInTime)

    if run.runScore == nil then
        run.runScore = GetFirstField(run, { "score", "mythicRating" })
    end

    if run.completed == nil and (run.durationMs ~= nil or run.runScore ~= nil or run.completedAt ~= nil) then
        run.completed = true
    end

    run.source = nil
    run.status = NormalizeRunStatusValue(run.status)
    run.abandonReason = NormalizeAbandonReason(run.abandonReason)
    run.thisWeek = NormalizeOptionalBoolean(run.thisWeek)
    run.members = NormalizeMythicPlusMembers(rawMembers)
    run.raw = nil

    if run.completed == false then
        local terminalAt = run.endedAt or run.abandonedAt or run.completedAt
        run.completedAt = nil
        run.endedAt = terminalAt
        run.abandonedAt = terminalAt
        run.status = "abandoned"
        run.abandonReason = run.abandonReason or "history_incomplete"
    end

    local derivedStatus = GetRunStatus(run)
    if derivedStatus ~= nil then
        run.status = derivedStatus
        if derivedStatus == "completed" then
            run.completed = true
            if run.endedAt == nil then
                run.endedAt = run.completedAt
            end
        elseif derivedStatus == "abandoned" then
            if run.endedAt == nil then
                run.endedAt = run.abandonedAt
            end
            if run.abandonedAt == nil then
                run.abandonedAt = run.endedAt
            end
            run.abandonReason = run.abandonReason or "unknown"
        end
    end

    NormalizeCompletedRunStartDate(run)

    if IsTemporaryRunFingerprint(run.fingerprint) and run.status == "active" then
        -- Preserve temporary synthetic fingerprint while the attempt is active.
        run.fingerprint = run.fingerprint
    else
        run.fingerprint = BuildRunFingerprint(run)
    end
    run.attemptId = GetRunAttemptID(run)
    return run
end

local function NormalizeMythicPlusRun(rawRun, seasonID)
    if type(rawRun) ~= "table" then
        return nil
    end

    local durationMs = GetFirstField(rawRun, {
        "durationMs",
        "completionMilliseconds",
        "mapChallengeModeDuration",
        "runDurationMs",
    })
    if durationMs == nil then
        local durationSeconds = GetFirstField(rawRun, {
            "durationSec",
            "durationSeconds",
            "time",
            "runDuration",
        })
        if type(durationSeconds) == "number"
            and durationSeconds > 0
            and durationSeconds <= (MAX_REASONABLE_MYTHIC_PLUS_DURATION_MS / 1000)
        then
            durationMs = math.floor(durationSeconds * 1000 + 0.5)
        end
    end
    if type(durationMs) == "number" and (durationMs <= 0 or durationMs > MAX_REASONABLE_MYTHIC_PLUS_DURATION_MS) then
        durationMs = nil
    end

    local mapChallengeModeID = GetFirstField(rawRun, { "mapChallengeModeID", "challengeModeID", "mapID" })
    local terminalDate = NormalizeMythicPlusDate(GetFirstField(rawRun, {
        "completedAt",
        "completionDate",
        "completedDate",
        "endTime",
    }))
    local endedAt = NormalizeMythicPlusDate(GetFirstField(rawRun, {
        "endedAt",
        "abandonedAt",
    }))
    local abandonedAt = NormalizeMythicPlusDate(GetFirstField(rawRun, {
        "abandonedAt",
        "endedAt",
    }))
    local startDate = NormalizeMythicPlusDate(GetFirstField(rawRun, { "startDate", "startedAt" }))
    local members = NormalizeMythicPlusMembers(GetFirstField(rawRun, {
        "members",
        "partyMembers",
        "groupMembers",
        "roster",
    }))
    local explicitCompleted = NormalizeOptionalBoolean(GetFirstField(rawRun, {
        "completed",
        "finishedSuccess",
        "isCompleted",
    }))
    local rawSeasonID = ToSafeNumber(GetFirstField(rawRun, { "season", "seasonID" }))

    local run = {
        observedAt          = nil,
        attemptId           = (function()
            local value = GetFirstField(rawRun, { "attemptId", "attemptID" })
            if type(value) ~= "string" then
                return nil
            end
            value = strtrim(value)
            return value ~= "" and value or nil
        end)(),
        seasonID            = rawSeasonID or ToSafeNumber(seasonID),
        mapChallengeModeID  = mapChallengeModeID,
        mapName             = GetFirstField(rawRun, { "mapName", "name", "zoneName", "shortName" })
            or GetChallengeModeMapName(mapChallengeModeID),
        level               = GetFirstField(rawRun, { "level", "keystoneLevel" }),
        completed           = explicitCompleted,
        completedInTime     = GetFirstField(rawRun, { "completedInTime", "intime", "onTime" }),
        durationMs          = durationMs,
        runScore            = GetFirstField(rawRun, { "runScore", "score", "mythicRating" }),
        status              = NormalizeRunStatusValue(GetFirstField(rawRun, { "status" })),
        startDate           = startDate,
        completedAt         = terminalDate,
        endedAt             = endedAt or terminalDate,
        abandonedAt         = explicitCompleted == false and (abandonedAt or terminalDate) or abandonedAt,
        abandonReason       = NormalizeAbandonReason(GetFirstField(rawRun, { "abandonReason" })),
        thisWeek            = NormalizeOptionalBoolean(GetFirstField(rawRun, { "thisWeek", "isThisWeek" })),
        members             = members,
    }

    run.completedInTime = NormalizeOptionalBoolean(run.completedInTime)

    if run.completed == nil and (run.durationMs ~= nil or run.runScore ~= nil or run.completedAt ~= nil) then
        run.completed = true
    end

    if run.completed == false then
        run.completedAt = nil
        run.status = "abandoned"
        run.abandonReason = run.abandonReason or "history_incomplete"
    end

    local derivedStatus = GetRunStatus(run)
    if derivedStatus ~= nil then
        run.status = derivedStatus
        if derivedStatus == "completed" then
            run.completed = true
            if run.endedAt == nil then
                run.endedAt = run.completedAt
            end
        elseif derivedStatus == "abandoned" then
            if run.endedAt == nil then
                run.endedAt = run.abandonedAt
            end
            if run.abandonedAt == nil then
                run.abandonedAt = run.endedAt
            end
            run.abandonReason = run.abandonReason or "history_incomplete"
        end
    end

    NormalizeCompletedRunStartDate(run)

    run.fingerprint = BuildRunFingerprint(run)
    run.attemptId = GetRunAttemptID(run)

    return run
end

local function CollectMythicPlusHistory()
    local characterKey = GetCharKey()
    local seasonID = GetCurrentMythicPlusSeasonID()
    local rawRuns = {}
    if type(C_MythicPlus) == "table" and type(C_MythicPlus.GetRunHistory) == "function" then
        -- Match Blizzard's current Challenges UI: retain incomplete attempts so
        -- leavers are visible, while excluding historical seasons at the API.
        local ok, result = pcall(C_MythicPlus.GetRunHistory, true, true, true)
        if ok and type(result) == "table" then
            rawRuns = result
        end
    end

    local normalizedRuns = {}
    for _, rawRun in ipairs(rawRuns) do
        local normalized = NormalizeMythicPlusRun(rawRun, seasonID)
        if normalized then
            normalizedRuns[#normalizedRuns + 1] = normalized
        end
    end

    AppendMythicPlusDebugEvent(characterKey, "history_collected", {
        summary = tostring(#rawRuns) .. " raw / " .. tostring(#normalizedRuns) .. " normalized",
        rawRunCount = #rawRuns,
        normalizedRunCount = #normalizedRuns,
    })
    AttachPendingCompletedRunMembers(normalizedRuns, characterKey)

    return normalizedRuns
end

local function IsChallengeModeAttemptActive()
    if type(C_ChallengeMode) == "table" and type(C_ChallengeMode.IsChallengeModeActive) == "function" then
        local ok, active = pcall(C_ChallengeMode.IsChallengeModeActive)
        if ok then
            return active == true
        end
    end

    return GetCurrentActiveMythicPlusRunContext() ~= nil
end

local function FindActiveMythicPlusAttemptIndex(entry, options)
    if type(entry) ~= "table" or type(entry.mythicPlusRuns) ~= "table" then
        return nil
    end
    options = options or {}

    local targetMapID = tonumber(options.mapChallengeModeID)
    local targetLevel = tonumber(options.level)
    local bestIndex = nil
    local bestSortValue = nil

    for index, run in ipairs(entry.mythicPlusRuns) do
        if type(run) == "table" and GetRunStatus(run) == "active" then
            local mapMatches = targetMapID == nil or tonumber(run.mapChallengeModeID) == targetMapID
            local levelMatches = targetLevel == nil or tonumber(run.level) == targetLevel
            if mapMatches and levelMatches then
                local sortValue = GetRunSortValue(run)
                if bestSortValue == nil or sortValue > bestSortValue then
                    bestSortValue = sortValue
                    bestIndex = index
                end
            end
        end
    end

    return bestIndex
end

local function GetRecentCompletionEventAge(characterKey)
    local state = GetMythicPlusDebugState(characterKey, false)
    if type(state) ~= "table" then
        return nil
    end
    local completionAt = tonumber(state.lastCompletionEventAt)
    if completionAt == nil then
        return nil
    end
    return math.abs(time() - completionAt)
end

local function ResolveAbandonReason(characterKey, fallbackReason)
    if fallbackReason ~= nil and fallbackReason ~= "left_instance" and fallbackReason ~= "unknown" then
        return NormalizeAbandonReason(fallbackReason) or "unknown"
    end

    local state = GetMythicPlusDebugState(characterKey, false)
    local leaverStartedAt = type(state) == "table" and tonumber(state.lastLeaverTimerStartedAt) or nil
    if leaverStartedAt ~= nil and math.abs(time() - leaverStartedAt) <= LEAVER_TIMER_REASON_WINDOW_SECONDS then
        return "leaver_timer"
    end

    return NormalizeAbandonReason(fallbackReason) or "unknown"
end

local function FindLifecycleMythicPlusRunIndex(entry, run, options)
    if type(entry) ~= "table" or type(run) ~= "table" then
        return nil
    end
    options = options or {}

    if options.matchActive then
        local activeIndex = FindActiveMythicPlusAttemptIndex(entry, {
            mapChallengeModeID = run.mapChallengeModeID,
            level = run.level,
        })
        if activeIndex ~= nil then
            return activeIndex
        end
    end

    return runLookup.FindMergeable(entry.mythicPlusRuns, run)
end

local function UpsertLifecycleMythicPlusRun(entry, candidateRun, options)
    if type(entry) ~= "table" or type(candidateRun) ~= "table" then
        return nil, false
    end
    options = options or {}

    local run = NormalizeStoredMythicPlusRun(candidateRun)
    if run == nil then
        return nil, false
    end
    if run.observedAt == nil or run.observedAt == 0 then
        run.observedAt = time()
    end

    local existingIndex = FindLifecycleMythicPlusRunIndex(entry, run, options)

    if existingIndex == nil then
        entry.mythicPlusRuns[#entry.mythicPlusRuns + 1] = run
        NormalizeAndDeduplicateRuns(entry, true)
        return run, true
    end

    local existing = entry.mythicPlusRuns[existingIndex]
    local merged = MergeStoredMythicPlusRun(existing, run)
    local changed = DidMythicPlusRunChange(existing, merged)
    if not changed then
        return existing, false
    end

    entry.mythicPlusRuns[existingIndex] = merged
    NormalizeAndDeduplicateRuns(entry, true)
    return merged, true
end

local function UpsertSyntheticActiveAttempt(reason, options)
    options = options or {}
    local key, name, realm, charInfo = GetCharacterIdentity()
    local entry = EnsureCharacterEntry(key, name, realm, charInfo)
    NormalizeAndDeduplicateRuns(entry)

    local context = GetCurrentActiveMythicPlusRunContext({
        mapChallengeModeID = options.mapChallengeModeID,
        level = options.level,
    })
    if context == nil then
        return nil, false
    end

    local members = NormalizeMythicPlusMembers(options.members)
    local startDate = NormalizeLifecycleTimestamp(options.startDate) or GetChallengeModeStartTimestamp()
    local seasonID = tonumber(options.seasonID) or GetCurrentMythicPlusSeasonID()
    local mapName = options.mapName or GetChallengeModeMapName(context.mapChallengeModeID)
    local attemptID = BuildSyntheticAttemptFingerprint({
        seasonID = seasonID,
        mapChallengeModeID = context.mapChallengeModeID,
        mapName = mapName,
        level = context.level,
        startDate = startDate,
        observedAt = time(),
    })

    local attempt = {
        fingerprint = attemptID,
        attemptId = attemptID,
        observedAt = time(),
        seasonID = seasonID,
        mapChallengeModeID = context.mapChallengeModeID,
        mapName = mapName,
        level = context.level,
        status = "active",
        completed = false,
        startDate = startDate,
        members = members,
    }

    local merged, changed = UpsertLifecycleMythicPlusRun(entry, attempt, { matchActive = true })
    if changed then
        AppendMythicPlusDebugEvent(key, "attempt_active_upserted", {
            summary = tostring(reason or "active") .. " " .. tostring(attempt.mapChallengeModeID or "?"),
            reason = reason,
            mapChallengeModeID = attempt.mapChallengeModeID,
            level = attempt.level,
            startDate = attempt.startDate,
        })
    end

    return merged, changed
end

local function MarkAttemptCompleted(reason, options)
    options = options or {}
    local key, name, realm, charInfo = GetCharacterIdentity()
    local entry = EnsureCharacterEntry(key, name, realm, charInfo)
    NormalizeAndDeduplicateRuns(entry)

    local context = GetCurrentActiveMythicPlusRunContext({
        mapChallengeModeID = options.mapChallengeModeID,
        level = options.level,
    }) or {
        mapChallengeModeID = tonumber(options.mapChallengeModeID),
        level = tonumber(options.level),
    }

    local activeIndex = FindActiveMythicPlusAttemptIndex(entry, context)
    local activeRun = activeIndex ~= nil and entry.mythicPlusRuns[activeIndex] or nil
    if activeRun == nil then
        local createdRun = UpsertSyntheticActiveAttempt("completion_backfill", options)
        activeIndex = FindActiveMythicPlusAttemptIndex(entry, context)
        activeRun = activeIndex ~= nil and entry.mythicPlusRuns[activeIndex] or createdRun
    end

    local completedAt = NormalizeLifecycleTimestamp(options.completedAt) or time()
    local completionMembers = NormalizeMythicPlusMembers(options.members)
    local activeStartDate = type(activeRun) == "table" and NormalizeLifecycleTimestamp(activeRun.startDate) or nil
    local completionStartDate = activeStartDate or NormalizeLifecycleTimestamp(options.startDate)
    local completionRun = {
        fingerprint = type(activeRun) == "table" and activeRun.fingerprint or nil,
        attemptId = type(activeRun) == "table" and activeRun.attemptId or nil,
        observedAt = time(),
        seasonID = tonumber(options.seasonID) or (type(activeRun) == "table" and activeRun.seasonID) or GetCurrentMythicPlusSeasonID(),
        mapChallengeModeID = tonumber(options.mapChallengeModeID) or (type(activeRun) == "table" and activeRun.mapChallengeModeID),
        mapName = options.mapName or (type(activeRun) == "table" and activeRun.mapName) or GetChallengeModeMapName(tonumber(options.mapChallengeModeID)),
        level = tonumber(options.level) or (type(activeRun) == "table" and activeRun.level),
        status = "completed",
        completed = true,
        completedInTime = options.completedInTime,
        durationMs = tonumber(options.durationMs),
        runScore = tonumber(options.runScore),
        startDate = completionStartDate,
        completedAt = completedAt,
        endedAt = completedAt,
        members = completionMembers,
        thisWeek = NormalizeOptionalBoolean(options.thisWeek),
    }

    local merged, changed = UpsertLifecycleMythicPlusRun(entry, completionRun, { matchActive = true })
    if changed then
        AppendMythicPlusDebugEvent(key, "attempt_completed_marked", {
            summary = tostring(reason or "completed") .. " " .. tostring(completionRun.mapChallengeModeID or "?"),
            reason = reason,
            mapChallengeModeID = completionRun.mapChallengeModeID,
            level = completionRun.level,
            completedAt = completionRun.completedAt,
        })
    end

    return merged, changed
end

local function FinalizeActiveAttemptAsAbandoned(reason, options)
    options = options or {}
    local key, name, realm, charInfo = GetCharacterIdentity()
    local entry = EnsureCharacterEntry(key, name, realm, charInfo)
    NormalizeAndDeduplicateRuns(entry)

    local activeIndex = FindActiveMythicPlusAttemptIndex(entry, {
        mapChallengeModeID = options.mapChallengeModeID,
        level = options.level,
    })
    if activeIndex == nil then
        return false
    end

    local completionAge = GetRecentCompletionEventAge(key)
    if completionAge ~= nil and completionAge <= RECENT_COMPLETION_EVENT_GRACE and options.ignoreRecentCompletion ~= true then
        return false
    end

    local activeRun = entry.mythicPlusRuns[activeIndex]
    local nowTs = NormalizeLifecycleTimestamp(options.at) or time()
    local activeStartedAt = NormalizeMythicPlusDate(activeRun.startDate)
        or NormalizeMythicPlusDate(activeRun.observedAt)
        or nowTs

    local abandonReason = NormalizeAbandonReason(options.abandonReason)
    if abandonReason == nil then
        if options.reason == "stale_recovery" or (nowTs - activeStartedAt) >= STALE_ATTEMPT_RECOVERY_SECONDS then
            abandonReason = "stale_recovery"
        else
            abandonReason = ResolveAbandonReason(key, "left_instance")
        end
    else
        abandonReason = ResolveAbandonReason(key, abandonReason)
    end

    local abandonedRun = {
        fingerprint = activeRun.fingerprint,
        attemptId = activeRun.attemptId,
        observedAt = time(),
        seasonID = activeRun.seasonID,
        mapChallengeModeID = activeRun.mapChallengeModeID,
        mapName = activeRun.mapName,
        level = activeRun.level,
        status = "abandoned",
        completed = false,
        completedInTime = activeRun.completedInTime,
        durationMs = activeRun.durationMs,
        runScore = activeRun.runScore,
        startDate = activeRun.startDate,
        endedAt = nowTs,
        abandonedAt = nowTs,
        abandonReason = abandonReason,
        members = activeRun.members,
        thisWeek = activeRun.thisWeek,
    }

    local _, changed = UpsertLifecycleMythicPlusRun(entry, abandonedRun, { matchActive = true })
    if changed then
        AppendMythicPlusDebugEvent(key, "attempt_abandoned_marked", {
            summary = tostring(reason or "abandoned") .. " (" .. tostring(abandonReason) .. ")",
            reason = reason,
            abandonReason = abandonReason,
            mapChallengeModeID = abandonedRun.mapChallengeModeID,
            level = abandonedRun.level,
        })
    end

    return changed
end

local ScheduleActiveAttemptReconcile

local function ReconcileActiveAttemptLifecycle(reason, options)
    options = options or {}
    local key, name, realm, charInfo = GetCharacterIdentity()
    local entry = EnsureCharacterEntry(key, name, realm, charInfo)
    NormalizeAndDeduplicateRuns(entry)

    local activeIndex = FindActiveMythicPlusAttemptIndex(entry)
    if activeIndex == nil then
        return false
    end

    local completionAge = GetRecentCompletionEventAge(key)
    if completionAge ~= nil and completionAge <= RECENT_COMPLETION_EVENT_GRACE and options.ignoreRecentCompletion ~= true then
        return false
    end

    local challengeModeActive = IsChallengeModeAttemptActive()
    if challengeModeActive then
        if IsInsideMythicPlusDungeonInstance() then
            return false
        end

        local retries = tonumber(options.activeSignalRetries) or 0
        if retries < ACTIVE_ATTEMPT_STALE_ACTIVE_MAX_RETRIES then
            local retryCount = retries + 1
            AppendMythicPlusDebugEvent(key, "attempt_reconcile_active_retry", {
                summary = "active signal retry " .. tostring(retryCount),
                reason = reason,
                retries = retryCount,
            })
            ScheduleActiveAttemptReconcile(reason or "reconcile_active_retry", ACTIVE_ATTEMPT_STALE_ACTIVE_RETRY_DELAY, {
                force = true,
                ignoreRecentCompletion = options.ignoreRecentCompletion,
                reason = options.reason,
                activeSignalRetries = retryCount,
            })
            return false
        end

        AppendMythicPlusDebugEvent(key, "attempt_reconcile_active_forced", {
            summary = "forcing reconcile after stale active signal",
            reason = reason,
            retries = retries,
        })
    end

    local activeRun = entry.mythicPlusRuns[activeIndex]
    local nowTs = time()
    local activeReferenceAt = NormalizeMythicPlusDate(activeRun.observedAt)
        or NormalizeMythicPlusDate(activeRun.startDate)
        or nowTs
    if options.force ~= true and math.abs(nowTs - activeReferenceAt) < ACTIVE_ATTEMPT_RECONCILE_GRACE then
        local remaining = ACTIVE_ATTEMPT_RECONCILE_GRACE - math.abs(nowTs - activeReferenceAt)
        if remaining < 1 then
            remaining = 1
        end
        ScheduleActiveAttemptReconcile(reason or "reconcile_retry", remaining, {
            force = true,
            ignoreRecentCompletion = options.ignoreRecentCompletion,
        })
        return false
    end

    local reasonValue = options.reason
    if reasonValue == nil then
        local startedAt = NormalizeMythicPlusDate(activeRun.startDate) or activeReferenceAt
        if (nowTs - startedAt) >= STALE_ATTEMPT_RECOVERY_SECONDS then
            reasonValue = "stale_recovery"
        else
            reasonValue = "left_instance"
        end
    end

    return FinalizeActiveAttemptAsAbandoned(reason or "reconcile", {
        abandonReason = reasonValue,
        at = nowTs,
        ignoreRecentCompletion = options.ignoreRecentCompletion,
    })
end

ScheduleActiveAttemptReconcile = function(reason, delaySeconds, options)
    options = options or {}
    delaySeconds = delaySeconds or ACTIVE_ATTEMPT_RECONCILE_GRACE

    if pendingActiveAttemptReconcile and not options.force then
        return
    end

    pendingActiveAttemptReconcile = true
    C_Timer.After(delaySeconds, function()
        pendingActiveAttemptReconcile = false
        ReconcileActiveAttemptLifecycle(reason, options)
    end)
end

local function GetCompletedRunsMissingScoreCount(entry)
    if type(entry) ~= "table" or type(entry.mythicPlusRuns) ~= "table" then
        return 0
    end

    local nowTs = time()
    local count = 0
    for _, run in ipairs(entry.mythicPlusRuns) do
        if type(run) == "table"
            and GetRunStatus(run) == "completed"
            and tonumber(run.runScore) == nil
        then
            local playedAt = GetRunSortValue(run)
            if playedAt > 0
                and playedAt <= (nowTs + 5 * 60)
                and (nowTs - playedAt) <= MPLUS_SCORE_BACKFILL_WINDOW
            then
                count = count + 1
            end
        end
    end

    return count
end

local function ClearMythicPlusScoreBackfillState(characterKey, reason)
    if type(characterKey) ~= "string" or characterKey == "" then
        return
    end

    local store = EnsurePendingMythicPlusScoreBackfillStore()
    if store[characterKey] ~= nil then
        store[characterKey] = nil
        AppendMythicPlusDebugEvent(characterKey, "score_backfill_cleared", {
            summary = reason or "cleared",
            reason = reason,
        })
    end
end

local function SyncMythicPlusHistory(reason, options)
    options = options or {}
    if not IsLoggedIn() then
        return false
    end

    runtimeState.RequestMythicPlusMapInfoOnce()

    local key, name, realm, charInfo = GetCharacterIdentity()
    local entry = EnsureCharacterEntry(key, name, realm, charInfo)
    NormalizeAndDeduplicateRuns(entry)
    local beforeCount = #entry.mythicPlusRuns
    local runs = CollectMythicPlusHistory()
    local identityIndex = runLookup.Build(entry.mythicPlusRuns)
    local added = 0
    local updated = false

    for _, run in ipairs(runs) do
        local normalizedRun = NormalizeStoredMythicPlusRun(run)
        if normalizedRun ~= nil then
            if normalizedRun.observedAt == nil or normalizedRun.observedAt == 0 then
                normalizedRun.observedAt = time()
            end

            local existingIndex = runLookup.FindMergeable(
                entry.mythicPlusRuns,
                normalizedRun,
                identityIndex
            )
            if existingIndex == nil then
                entry.mythicPlusRuns[#entry.mythicPlusRuns + 1] = normalizedRun
                runLookup.Add(
                    identityIndex,
                    normalizedRun,
                    #entry.mythicPlusRuns
                )
                added = added + 1
            else
                local existing = entry.mythicPlusRuns[existingIndex]
                local merged = MergeStoredMythicPlusRun(existing, normalizedRun)
                if DidMythicPlusRunChange(existing, merged) then
                    entry.mythicPlusRuns[existingIndex] = merged
                    updated = true
                end
                runLookup.Add(identityIndex, merged, existingIndex)
            end
        end
    end

    if added > 0 or updated then
        NormalizeAndDeduplicateRuns(entry, true)
    end

    lastMPlusSyncAt = GetTime()
    UpdateMythicPlusDebugState(key, {
        lastSyncAt = time(),
        lastSyncReason = reason,
        lastSyncChanged = (added > 0 or updated or beforeCount ~= #entry.mythicPlusRuns),
        lastSyncRunCount = #runs,
    })
    AppendMythicPlusDebugEvent(key, "sync_completed", {
        summary = tostring(reason or "sync")
            .. " (" .. tostring(added) .. " add, "
            .. tostring(updated and 1 or 0) .. " update)",
        reason = reason,
        added = added,
        updated = updated,
        runCount = #runs,
    })

    local missingScoreCount = GetCompletedRunsMissingScoreCount(entry)
    UpdateMythicPlusDebugState(key, {
        lastMissingScoreCount = missingScoreCount,
    })
    if missingScoreCount > 0 then
        ScheduleNextMythicPlusScoreBackfill("missing_score_after_sync", {
            characterKey = key,
            entry = entry,
        })
    else
        ClearMythicPlusScoreBackfillState(key, "score_present")
    end

    return added > 0 or updated or beforeCount ~= #entry.mythicPlusRuns
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
    AppendMythicPlusDebugEvent(GetCharKey(), "sync_scheduled", {
        summary = tostring(reason or "sync") .. " in " .. tostring(delaySeconds) .. "s",
        reason = reason,
        delaySeconds = delaySeconds,
        forced = options.force == true,
    })
    C_Timer.After(delaySeconds, function()
        pendingMPlusSync = false
        -- Skip forced retry if pending members were already consumed
        if options.force and reason == "challenge_mode_completed" then
            local characterKey = GetCharKey()
            local pending = GetPendingCompletedRunMembers(characterKey)
            if pending == nil then
                return
            end
        end
        SyncMythicPlusHistory(reason, options)
    end)
end

ScheduleNextMythicPlusScoreBackfill = function(reason, options)
    options = options or {}
    local characterKey = options.characterKey
    local entry = options.entry

    if type(characterKey) ~= "string" or characterKey == "" or type(entry) ~= "table" then
        local key, name, realm, charInfo = GetCharacterIdentity()
        characterKey = key
        entry = EnsureCharacterEntry(key, name, realm, charInfo)
        NormalizeAndDeduplicateRuns(entry)
    end

    local missingScoreCount = GetCompletedRunsMissingScoreCount(entry)
    if missingScoreCount <= 0 then
        ClearMythicPlusScoreBackfillState(characterKey, "score_present")
        return false
    end

    if pendingMPlusScoreBackfillSync and not options.force then
        return false
    end

    local store = EnsurePendingMythicPlusScoreBackfillStore()
    local state = store[characterKey]
    if type(state) ~= "table" or options.reset == true then
        state = {
            startedAt = time(),
            retryIndex = 1,
        }
        store[characterKey] = state
    end

    local retryIndex = tonumber(state.retryIndex) or 1
    local delaySeconds = options.delaySeconds
        or MPLUS_SCORE_BACKFILL_RETRY_DELAYS[retryIndex]
        or MPLUS_SCORE_BACKFILL_PERIODIC_DELAY
    state.retryIndex = retryIndex + 1
    state.lastScheduledAt = time()
    state.lastReason = reason or "missing_score"
    state.missingCount = missingScoreCount

    pendingMPlusScoreBackfillSync = true
    AppendMythicPlusDebugEvent(characterKey, "score_backfill_scheduled", {
        summary = tostring(reason or "missing_score")
            .. " in " .. tostring(delaySeconds) .. "s"
            .. " (" .. tostring(missingScoreCount) .. ")",
        reason = reason,
        delaySeconds = delaySeconds,
        retryIndex = retryIndex,
        missingScoreCount = missingScoreCount,
    })

    C_Timer.After(delaySeconds, function()
        pendingMPlusScoreBackfillSync = false
        if not IsLoggedIn() then
            return
        end

        local key, name, realm, charInfo = GetCharacterIdentity()
        local currentEntry = EnsureCharacterEntry(key, name, realm, charInfo)
        NormalizeAndDeduplicateRuns(currentEntry)
        local currentMissingScoreCount = GetCompletedRunsMissingScoreCount(currentEntry)
        if currentMissingScoreCount <= 0 then
            ClearMythicPlusScoreBackfillState(key, "score_present")
            return
        end

        AppendMythicPlusDebugEvent(key, "score_backfill_sync", {
            summary = tostring(currentMissingScoreCount) .. " missing score",
            reason = reason,
            missingScoreCount = currentMissingScoreCount,
        })
        SyncMythicPlusHistory(reason or "missing_score_backfill", {
            scoreBackfill = true,
        })
    end)

    return true
end

function addon.BuildSnapshotClientInfo()
    local gameVersion, buildNumber, buildDate, tocVersion = nil, nil, nil, nil
    if type(GetBuildInfo) == "function" then
        local ok, version, build, date, toc = pcall(GetBuildInfo)
        if ok then
            gameVersion = version
            buildNumber = build
            buildDate = date
            tocVersion = tonumber(toc)
        end
    end

    local locale = nil
    if type(GetLocale) == "function" then
        local ok, value = pcall(GetLocale)
        if ok then
            locale = value
        end
    end

    return {
        addonVersion = ADDON_VERSION,
        interfaceVersion = tonumber(ADDON_INTERFACE),
        gameVersion = gameVersion,
        buildNumber = buildNumber,
        buildDate = buildDate,
        tocVersion = tocVersion,
        expansion = ADDON_EXPANSION,
        locale = locale,
    }
end

function addon.BuildEquipmentSnapshot()
    if type(GetInventorySlotInfo) ~= "function" then
        return nil
    end

    local equipment = {}
    for _, slot in ipairs(addon.SNAPSHOT_EQUIPMENT_SLOTS or {}) do
        local slotID = CallSafeNumber(GetInventorySlotInfo, slot.slotName)
        if slotID then
            local itemID = CallSafeNumber(GetInventoryItemID, "player", slotID)
            local itemLink = nil
            if type(GetInventoryItemLink) == "function" then
                local ok, value = pcall(GetInventoryItemLink, "player", slotID)
                itemLink = ok and ToSafeText(value) or nil
            end
            if itemID or itemLink then
                local itemName, itemQuality, itemLevel, iconFileID = nil, nil, nil, nil
                if itemLink and type(C_Item) == "table" and type(C_Item.GetItemInfo) == "function" then
                    local ok, name, link, quality, level, _, _, _, _, icon = pcall(C_Item.GetItemInfo, itemLink)
                    if ok then
                        itemName = ToSafeText(name)
                        itemLink = ToSafeText(link) or itemLink
                        itemQuality = ToSafeNumber(quality)
                        itemLevel = ToSafeNumber(level)
                        iconFileID = ToSafeNumber(icon)
                    end
                end
                if itemLink
                    and type(C_Item) == "table"
                    and type(C_Item.GetDetailedItemLevelInfo) == "function"
                then
                    local ok, detailedLevel = pcall(C_Item.GetDetailedItemLevelInfo, itemLink)
                    if ok and ToSafeNumber(detailedLevel) then
                        itemLevel = ToSafeNumber(detailedLevel)
                    end
                end
                if iconFileID == nil
                    and itemID ~= nil
                    and type(C_Item) == "table"
                    and type(C_Item.GetItemIconByID) == "function"
                then
                    iconFileID = CallSafeNumber(C_Item.GetItemIconByID, itemID)
                end
                if itemName == nil
                    and itemID ~= nil
                    and type(C_Item) == "table"
                    and type(C_Item.RequestLoadItemDataByID) == "function"
                then
                    pcall(C_Item.RequestLoadItemDataByID, itemID)
                end

                equipment[slot.key] = {
                    slot = slot.key,
                    slotID = slotID,
                    itemID = itemID,
                    itemName = itemName,
                    itemLink = itemLink,
                    itemLevel = itemLevel,
                    quality = itemQuality,
                    iconFileID = iconFileID,
                }
            end
        end
    end

    if next(equipment) then
        return equipment
    end

    return nil
end

function addon.BuildWeeklyRewardsSnapshot()
    if type(C_WeeklyRewards) ~= "table" or type(C_WeeklyRewards.GetActivities) ~= "function" then
        return nil
    end

    local activities = {}
    local okActivities, rawActivities = pcall(C_WeeklyRewards.GetActivities)
    if okActivities and type(rawActivities) == "table" then
        for index, activity in ipairs(rawActivities) do
            if type(activity) == "table" then
                table.insert(activities, {
                    type = tonumber(activity.type or activity.activityType),
                    index = tonumber(activity.index) or index,
                    id = tonumber(activity.id),
                    level = tonumber(activity.level),
                    threshold = tonumber(activity.threshold),
                    progress = tonumber(activity.progress),
                    activityTierID = tonumber(activity.activityTierID),
                    itemLevel = tonumber(activity.itemLevel),
                    name = activity.name and tostring(activity.name) or nil,
                })
            end
        end
    end

    if #activities == 0 then
        return nil
    end

    local canClaimRewards = nil
    if type(C_WeeklyRewards.CanClaimRewards) == "function" then
        local ok, value = pcall(C_WeeklyRewards.CanClaimRewards)
        if ok then
            canClaimRewards = value == true
        end
    end

    local isCurrentPeriod = nil
    if type(C_WeeklyRewards.AreRewardsForCurrentRewardPeriod) == "function" then
        local ok, value = pcall(C_WeeklyRewards.AreRewardsForCurrentRewardPeriod)
        if ok then
            isCurrentPeriod = value == true
        end
    end

    return {
        canClaimRewards = canClaimRewards,
        isCurrentPeriod = isCurrentPeriod,
        activities = activities,
    }
end

function addon.BuildMajorFactionsSnapshot()
    if type(C_MajorFactions) ~= "table"
        or type(C_MajorFactions.GetMajorFactionIDs) ~= "function"
        or type(C_MajorFactions.GetMajorFactionData) ~= "function" then
        return nil
    end

    local okIDs, majorFactionIDs = pcall(C_MajorFactions.GetMajorFactionIDs)
    if not okIDs or type(majorFactionIDs) ~= "table" then
        return nil
    end

    local factions = {}
    for _, factionID in ipairs(majorFactionIDs) do
        local numericFactionID = tonumber(factionID)
        if numericFactionID then
            local okData, data = pcall(C_MajorFactions.GetMajorFactionData, numericFactionID)
            if okData and type(data) == "table" and data.isUnlocked ~= false then
                local isWeeklyCapped = nil
                if type(C_MajorFactions.IsWeeklyRenownCapped) == "function" then
                    local okCapped, capped = pcall(C_MajorFactions.IsWeeklyRenownCapped, numericFactionID)
                    if okCapped then
                        isWeeklyCapped = capped == true
                    end
                end

                table.insert(factions, {
                    factionID = numericFactionID,
                    name = data.name and tostring(data.name) or nil,
                    expansionID = tonumber(data.expansionID),
                    isUnlocked = data.isUnlocked == true,
                    renownLevel = tonumber(data.renownLevel),
                    renownReputationEarned = tonumber(data.renownReputationEarned),
                    renownLevelThreshold = tonumber(data.renownLevelThreshold),
                    isWeeklyCapped = isWeeklyCapped,
                })
            end
        end
    end

    if #factions > 0 then
        return { factions = factions }
    end

    return nil
end

local function BuildPendingSnapshot()
    local key, name, realm, charInfo = GetCharacterIdentity()

    local specIndex = CallSafeNumber(GetSpecialization)
    if not specIndex or specIndex <= 0 then return nil end
    local okSpec, _, rawSpecName, _, _, rawSpecRole = pcall(GetSpecializationInfo, specIndex)
    if not okSpec then return nil end
    local sName = ToSafeText(rawSpecName)
    local sRole = ToSafeText(rawSpecRole)
    if not sName then return nil end
    local specName = sName
    local role     = "dps"
    if     sRole == "TANK"   then role = "tank"
    elseif sRole == "HEALER" then role = "healer"
    end

    local okItemLevel, _, rawEquippedItemLevel = pcall(GetAverageItemLevel)
    local equippedIlvl = okItemLevel and ToSafeNumber(rawEquippedItemLevel) or nil
    if equippedIlvl == nil then return nil end

    local currencies = {}
    local currencyDetails = {}
    for fieldName, currencyID in pairs(CURRENCY_IDS) do
        local quantity = 0
        if type(C_CurrencyInfo) == "table" and type(C_CurrencyInfo.GetCurrencyInfo) == "function" then
            local ok, info = pcall(C_CurrencyInfo.GetCurrencyInfo, currencyID)
            if ok and type(info) == "table" then
                quantity = ToSafeNumber(info.quantity) or 0
                currencyDetails[fieldName] = {
                    currencyID = currencyID,
                    name = ToSafeText(info.name),
                    quantity = quantity,
                    iconFileID = ToSafeNumber(info.iconFileID),
                    maxQuantity = ToSafeNumber(info.maxQuantity),
                    canEarnPerWeek = info.canEarnPerWeek == true,
                    quantityEarnedThisWeek = ToSafeNumber(info.quantityEarnedThisWeek),
                    maxWeeklyQuantity = ToSafeNumber(info.maxWeeklyQuantity),
                    totalEarned = ToSafeNumber(info.totalEarned),
                    discovered = info.discovered == true,
                    quality = ToSafeNumber(info.quality),
                    useTotalEarnedForMaxQty = info.useTotalEarnedForMaxQty == true,
                }
            end
        end
        currencies[fieldName] = quantity
    end

    local function GetSafeUnitStat(statIndex)
        if type(UnitStat) ~= "function" or statIndex == nil then
            return nil
        end
        local ok, _, effectiveStat = pcall(UnitStat, "player", statIndex)
        return ok and ToSafeNumber(effectiveStat) or nil
    end

    local stamina = GetSafeUnitStat(LE_UNIT_STAT_STAMINA)
    local strength = GetSafeUnitStat(LE_UNIT_STAT_STRENGTH)
    local agility = GetSafeUnitStat(LE_UNIT_STAT_AGILITY)
    local intellect = GetSafeUnitStat(LE_UNIT_STAT_INTELLECT)
    if stamina == nil or strength == nil or agility == nil or intellect == nil then
        return nil
    end

    local critPercent = CallSafeNumber(GetCritChance)
    local hastePercent = CallSafeNumber(GetHaste) or CallSafeNumber(GetMeleeHaste)
    local masteryPercent = CallSafeNumber(GetMasteryEffect)
    local versatilityPercent = CallSafeNumber(GetCombatRatingBonus, CR_VERSATILITY_DAMAGE_DONE)
    if critPercent == nil
        or hastePercent == nil
        or masteryPercent == nil
        or versatilityPercent == nil
    then
        return nil
    end

    local stats = {
        stamina            = stamina,
        strength           = strength,
        agility            = agility,
        intellect          = intellect,
        critRating         = CallSafeNumber(GetCombatRating, CR_CRIT_MELEE),
        critPercent        = critPercent,
        hasteRating        = CallSafeNumber(GetCombatRating, CR_HASTE_MELEE),
        hastePercent       = hastePercent,
        masteryRating      = CallSafeNumber(GetCombatRating, CR_MASTERY),
        masteryPercent     = masteryPercent,
        versatilityRating  = CallSafeNumber(GetCombatRating, CR_VERSATILITY_DAMAGE_DONE),
        versatilityPercent = versatilityPercent,
        speedRating        = CallSafeNumber(GetCombatRating, CR_SPEED),
        speedPercent       = CallSafeNumber(GetCombatRatingBonus, CR_SPEED),
        leechRating        = CallSafeNumber(GetCombatRating, CR_LIFESTEAL),
        leechPercent       = CallSafeNumber(GetCombatRatingBonus, CR_LIFESTEAL),
        avoidanceRating    = CallSafeNumber(GetCombatRating, CR_AVOIDANCE),
        avoidancePercent   = CallSafeNumber(GetCombatRatingBonus, CR_AVOIDANCE),
    }

    local mplusScore = type(C_ChallengeMode) == "table"
        and CallSafeNumber(C_ChallengeMode.GetOverallDungeonScore)
        or nil
    mplusScore = mplusScore or 0

    local ownedKeystone = nil
    if C_MythicPlus then
        local ownedKeystoneLevel = nil
        if type(C_MythicPlus.GetOwnedKeystoneLevel) == "function" then
            ownedKeystoneLevel = CallSafeNumber(C_MythicPlus.GetOwnedKeystoneLevel)
        end

        if ownedKeystoneLevel and ownedKeystoneLevel > 0 then
            local mapChallengeModeID = nil
            if type(C_MythicPlus.GetOwnedKeystoneChallengeMapID) == "function" then
                mapChallengeModeID = CallSafeNumber(C_MythicPlus.GetOwnedKeystoneChallengeMapID)
            end

            ownedKeystone = {
                level = ownedKeystoneLevel,
                mapChallengeModeID = mapChallengeModeID,
                mapName = GetChallengeModeMapName(mapChallengeModeID),
            }
        end
    end

    local seasonID = GetCurrentMythicPlusSeasonID()
    local equipment = addon.BuildEquipmentSnapshot()
    local weeklyRewards = addon.BuildWeeklyRewardsSnapshot()
    local majorFactions = addon.BuildMajorFactionsSnapshot()
    local clientInfo = addon.BuildSnapshotClientInfo()
    local unitLevel = CallSafeNumber(UnitLevel, "player")
    local moneyCopper = CallSafeNumber(GetMoney)
    if unitLevel == nil or moneyCopper == nil then return nil end

    return {
        key      = key,
        name     = name,
        realm    = realm,
        charInfo = charInfo,
        snap = {
            takenAt         = time(),
            level           = unitLevel,
            spec            = specName,
            role            = role,
            itemLevel       = math.floor((equippedIlvl or 0) * 100 + 0.5) / 100,
            gold            = moneyCopper / 10000,
            playtimeSeconds = 0,
            playtimeThisLevelSeconds = 0,
            mythicPlusScore = mplusScore,
            seasonID        = seasonID,
            ownedKeystone   = ownedKeystone,
            currencies      = currencies,
            currencyDetails = next(currencyDetails) and currencyDetails or nil,
            stats           = stats,
            equipment       = equipment,
            weeklyRewards   = weeklyRewards,
            majorFactions   = majorFactions,
            clientInfo      = clientInfo,
        },
    }
end

local function SetPlaytimeBaseline(totalSeconds, thisLevelSeconds, capturedAt, level)
    local totalValue = tonumber(totalSeconds)
    local thisLevelValue = tonumber(thisLevelSeconds)
    if totalValue == nil and thisLevelValue == nil then
        return
    end

    addon.playtimeBaseline = {
        totalSeconds = totalValue or 0,
        thisLevelSeconds = thisLevelValue or 0,
        capturedAt = tonumber(capturedAt) or time(),
        level = tonumber(level) or tonumber(UnitLevel("player")),
    }
end

local function GetLastKnownPlaytime(characterKey)
    local characters = WowDashboardDB and WowDashboardDB.characters
    local entry = type(characters) == "table" and characters[characterKey] or nil
    local snapshots = type(entry) == "table" and entry.snapshots or nil
    if type(snapshots) ~= "table" then
        return 0, 0
    end

    for index = #snapshots, 1, -1 do
        local snap = snapshots[index]
        if type(snap) == "table" then
            local totalSeconds = tonumber(snap.playtimeSeconds)
            local thisLevelSeconds = tonumber(snap.playtimeThisLevelSeconds)
            if totalSeconds ~= nil or thisLevelSeconds ~= nil then
                return totalSeconds or 0, thisLevelSeconds or 0, tonumber(snap.takenAt), tonumber(snap.level)
            end
        end
    end

    return 0, 0
end

local function GetEstimatedPlaytime(characterKey)
    local now = time()
    local currentLevel = tonumber(UnitLevel("player"))
    local baseline = addon.playtimeBaseline

    if type(baseline) ~= "table" then
        local totalSeconds, thisLevelSeconds, _, snapshotLevel = GetLastKnownPlaytime(characterKey)
        if snapshotLevel ~= nil and currentLevel ~= nil and snapshotLevel ~= currentLevel then
            thisLevelSeconds = 0
        end
        SetPlaytimeBaseline(totalSeconds, thisLevelSeconds, now, currentLevel)
        baseline = addon.playtimeBaseline
    end

    if type(baseline) ~= "table" then
        return 0, 0
    end

    local elapsed = math.max(0, now - (tonumber(baseline.capturedAt) or now))
    local totalSeconds = (tonumber(baseline.totalSeconds) or 0) + elapsed
    local thisLevelSeconds = tonumber(baseline.thisLevelSeconds) or 0
    local baselineLevel = tonumber(baseline.level)

    if baselineLevel == nil or currentLevel == nil or baselineLevel == currentLevel then
        thisLevelSeconds = thisLevelSeconds + elapsed
    else
        thisLevelSeconds = 0
    end

    return math.floor(totalSeconds), math.floor(thisLevelSeconds)
end

local function RequestLoginPlaytimeSync()
    if loginPlaytimeSyncRequested then
        return false
    end
    if not addon.ShouldSyncPlaytimeOnLogin() then
        return false
    end
    if not IsLoggedIn() or type(RequestTimePlayed) ~= "function" then
        return false
    end

    loginPlaytimeSyncRequested = true
    local ok = pcall(RequestTimePlayed)
    if not ok then
        loginPlaytimeSyncRequested = false
    end

    return ok == true
end

local function CommitSnapshot(totalSeconds, thisLevelSeconds)
    if not pendingSnapshot then return end
    local p         = pendingSnapshot
    pendingSnapshot = nil
    p.snap.playtimeSeconds = totalSeconds or 0
    p.snap.playtimeThisLevelSeconds = thisLevelSeconds or 0
    SetPlaytimeBaseline(p.snap.playtimeSeconds, p.snap.playtimeThisLevelSeconds, p.snap.takenAt, p.snap.level)

    local db = WowDashboardDB
    local entry = EnsureCharacterEntry(p.key, p.name, p.realm, p.charInfo)
    SignSnapshotPayload(entry, p.snap)

    table.insert(entry.snapshots, p.snap)

    -- Bound snapshot retention per character
    TrimArrayToNewest(entry.snapshots, MAX_SNAPSHOTS_PER_CHARACTER)

    lastSnapshotAt = GetTime()
    if addon.RefreshLog then
        addon.RefreshLog()
    end
    if addon.RefreshOverviewPanel then
        addon.RefreshOverviewPanel()
    end
end

local function CollectSnapshot(forceFresh)
    if not IsLoggedIn() then return false end
    if pendingSnapshot and not forceFresh then return false end

    local inCombat = false
    if type(InCombatLockdown) == "function" then
        local ok, value = pcall(InCombatLockdown)
        inCombat = ok and value == true
    end
    if not inCombat and type(UnitAffectingCombat) == "function" then
        local ok, value = pcall(UnitAffectingCombat, "player")
        inCombat = ok and value == true
    end
    if inCombat then
        runtimeState.snapshotDeferredForCombat = true
        return false
    end

    local snapshot = BuildPendingSnapshot()
    if not snapshot then return false end
    runtimeState.snapshotDeferredForCombat = false
    pendingSnapshot = snapshot

    CommitSnapshot(GetEstimatedPlaytime(snapshot.key))
    return true
end

function addon.RequestFreshSnapshot()
    local requested = CollectSnapshot(true)
    if requested then
        StartSnapshotTicker()
    end
    return requested
end

function addon.IsSnapshotPending()
    return pendingSnapshot ~= nil
end

function addon.GetNextSnapshotAt()
    return nextSnapshotAt
end

function addon.GetRefreshCooldownUntil()
    return refreshCooldownUntil
end

function addon.SetRefreshCooldownUntil(value)
    refreshCooldownUntil = tonumber(value) or 0
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
-- ============================================================
-- Dashboard UI is implemented in wow-dashboard-ui.lua.
-- Keep this file focused on data capture and event handling.
-- ============================================================


-- ============================================================
-- Slash Commands & Events
-- ============================================================

-- Small internal surface for standalone regression tests. This table is
-- runtime-only and is never persisted in SavedVariables.
addon.testHooks = {
    CaptureCompletionInfoMembers = CaptureCompletionInfoMembers,
    CollectMythicPlusHistory = CollectMythicPlusHistory,
    GetChallengeModeStartTimestamp = GetChallengeModeStartTimestamp,
    GetRunStatus = GetRunStatus,
    MigrateDatabase = MigrateDatabase,
    NormalizeAndDeduplicateRuns = NormalizeAndDeduplicateRuns,
    NormalizeMythicPlusDate = NormalizeMythicPlusDate,
    NormalizeMythicPlusRun = NormalizeMythicPlusRun,
    MYTHIC_PLUS_STORAGE_VERSION = STORAGE_POLICY.mythicPlusVersion,
}

SLASH_WOWDASHBOARD1 = "/wd"
SLASH_WOWDASHBOARD2 = "/wowdashboard"
function addon.PrintSlashHelp()
    PrintAddonMessage("Commands: /wd, /wd help, /wd open, /wd mplusdebug")
end

SlashCmdList["WOWDASHBOARD"] = function(msg)
    local input = msg and msg:match("^%s*(.-)%s*$") or ""
    if input == "" then
        if addon.ToggleDashboard then
            addon.ToggleDashboard()
        end
        return
    end

    local command, rest = input:match("^(%S+)%s*(.-)$")
    command = command and command:lower() or ""

    if command == "open" then
        if addon.SetDashboardShown then
            addon.SetDashboardShown(true)
        end
        return
    end

    if command == "help" then
        addon.PrintSlashHelp()
        return
    end

    if command == "mplusdebug" then
        PrintMythicPlusDebug()
        return
    end

    addon.PrintSlashHelp()
end

addon.eventFrame = CreateFrame("Frame")
addon.eventFrame:RegisterEvent("ADDON_LOADED")
addon.eventFrame:RegisterEvent("PLAYER_ENTERING_WORLD")
addon.eventFrame:RegisterEvent("ZONE_CHANGED_NEW_AREA")
addon.eventFrame:RegisterEvent("GROUP_ROSTER_UPDATE")
addon.eventFrame:RegisterEvent("CHALLENGE_MODE_START")
addon.eventFrame:RegisterEvent("CHALLENGE_MODE_COMPLETED")
addon.eventFrame:RegisterEvent("CHALLENGE_MODE_COMPLETED_REWARDS")
addon.eventFrame:RegisterEvent("CHALLENGE_MODE_MAPS_UPDATE")
addon.eventFrame:RegisterEvent("CHALLENGE_MODE_MEMBER_INFO_UPDATED")
addon.eventFrame:RegisterEvent("CHALLENGE_MODE_RESET")
addon.eventFrame:RegisterEvent("CHALLENGE_MODE_LEAVER_TIMER_STARTED")
addon.eventFrame:RegisterEvent("CHALLENGE_MODE_LEAVER_TIMER_ENDED")
addon.eventFrame:RegisterEvent("PLAYER_REGEN_ENABLED")
addon.eventFrame:RegisterEvent("SAVED_VARIABLES_TOO_LARGE")
addon.eventFrame:RegisterEvent("TIME_PLAYED_MSG")
addon.eventFrame:SetScript("OnEvent", function(self, event, ...)
    if event == "ADDON_LOADED" and ... == addonName then
        if not WowDashboardDB then
            WowDashboardDB = {
                version = DB_VERSION,
                characters = {},
                panelOpen = false,
                settings = {
                    syncPlaytimeOnLogin = true,
                },
                signing = {
                    algorithm = ADDON_SIGNATURE_ALGORITHM,
                    installId = GenerateSigningToken("install"),
                    secret = GenerateSigningToken("secret"),
                    createdAt = time(),
                },
                minimap = {
                    minimapPos = DEFAULT_MINIMAP_POS,
                    hide = false,
                },
            }
        end
        MigrateDatabase()
        if WowDashboardDB.panelOpen == nil then WowDashboardDB.panelOpen = false end
        EnsureAddonSigning()
        addon.EnsureAddonSettings()
        if addon.EnsureMinimapSettings then
            addon.EnsureMinimapSettings()
        end
        if addon.CreateMinimapButton then
            addon.CreateMinimapButton()
        end

    elseif event == "PLAYER_ENTERING_WORLD" then
        if addon.RefreshMinimapButton then
            addon.RefreshMinimapButton()
        end
        if addon.RefreshSettingsControls then
            addon.RefreshSettingsControls()
        end
        if addon.RefreshOverviewPanel then
            addon.RefreshOverviewPanel()
        end
        local enteringContext = GetCurrentActiveMythicPlusRunContext()
        local activeCache = ReconcileActiveMythicPlusMemberCache("player_entering_world")
        if enteringContext ~= nil then
            UpsertSyntheticActiveAttempt("player_entering_world", {
                mapChallengeModeID = enteringContext.mapChallengeModeID,
                level = enteringContext.level,
                members = type(activeCache) == "table" and activeCache.members or nil,
                startDate = GetChallengeModeStartTimestamp(),
            })
        end
        ScheduleActiveAttemptReconcile("player_entering_world", ACTIVE_ATTEMPT_RECONCILE_GRACE)
        if not initialized then
            initialized = true
            print("|cff00ccff[WoW Dashboard]|r Loaded — type |cffffffff/wowdashboard|r to open.")
            if addon.SetDashboardShown then
                addon.SetDashboardShown(WowDashboardDB.panelOpen == true)
            end
            C_Timer.After(1, RequestLoginPlaytimeSync)
            -- First snapshot in 5 s, then every 15 min
            nextSnapshotAt = GetTime() + 5
            C_Timer.After(5, function()
                CollectSnapshot()
                StartSnapshotTicker()
            end)
            ScheduleMythicPlusHistorySync("initial_login", 8)
        else
            -- Re-entering world (dungeon entry/exit, zone transfer)
            if GetTime() - lastSnapshotAt > STORAGE_POLICY.snapshotEventMinInterval then
                C_Timer.After(2, CollectSnapshot)
            end
            ScheduleMythicPlusHistorySync("player_entering_world", 4)
        end

    elseif event == "ZONE_CHANGED_NEW_AREA" then
        local zoneContext = GetCurrentActiveMythicPlusRunContext()
        local activeCache = ReconcileActiveMythicPlusMemberCache("zone_changed_new_area")
        if zoneContext ~= nil then
            UpsertSyntheticActiveAttempt("zone_changed_new_area", {
                mapChallengeModeID = zoneContext.mapChallengeModeID,
                level = zoneContext.level,
                members = type(activeCache) == "table" and activeCache.members or nil,
                startDate = GetChallengeModeStartTimestamp(),
            })
        end
        ScheduleActiveAttemptReconcile("zone_changed_new_area", ACTIVE_ATTEMPT_RECONCILE_GRACE)
        if GetTime() - lastSnapshotAt > STORAGE_POLICY.snapshotEventMinInterval then
            C_Timer.After(2, CollectSnapshot)
        end

    elseif event == "GROUP_ROSTER_UPDATE" then
        if GetCurrentActiveMythicPlusRunContext() ~= nil then
            RefreshActiveMythicPlusMemberCache("group_roster_update", {
                clearWhenInactive = false,
            })
        end

    elseif event == "CHALLENGE_MODE_START" then
        local mapChallengeModeID = ...
        local characterKey = GetCharKey()
        local startMembers = CaptureLiveGroupMembers()
        local startTs = GetChallengeModeStartTimestamp()
        RefreshActiveMythicPlusMemberCache("challenge_mode_start", {
            mapChallengeModeID = mapChallengeModeID,
            clearWhenInactive = false,
            members = startMembers,
        })
        UpsertSyntheticActiveAttempt("challenge_mode_start", {
            mapChallengeModeID = tonumber(mapChallengeModeID),
            members = startMembers,
            startDate = startTs,
        })
        UpdateMythicPlusDebugState(characterKey, {
            lastChallengeStartAt = time(),
            lastChallengeStartMapID = tonumber(mapChallengeModeID),
        })
        AppendMythicPlusDebugEvent(characterKey, "challenge_mode_start", {
            summary = "map " .. tostring(mapChallengeModeID) .. " (" .. tostring(#startMembers) .. ")",
            mapChallengeModeID = tonumber(mapChallengeModeID),
            memberCount = #startMembers,
        })

    elseif event == "CHALLENGE_MODE_COMPLETED" then
        local characterKey = GetCharKey()
        local completionApiMembers, completionInfo = CaptureCompletionInfoMembers()
        local completionMembers, completionLiveInfo = CaptureLiveGroupMembers()
        local mergedCompletionMembers = MergeMythicPlusMemberLists(completionApiMembers, completionMembers) or {}
        local completionAt = time()
        RefreshActiveMythicPlusMemberCache("challenge_mode_completed", {
            clearWhenInactive = false,
            members = mergedCompletionMembers,
            liveInfo = completionLiveInfo,
        })
        MarkAttemptCompleted("challenge_mode_completed", {
            mapChallengeModeID = completionInfo.mapChallengeModeID,
            level = completionInfo.level,
            durationMs = completionInfo.durationMs,
            completedInTime = completionInfo.completedInTime,
            completedAt = completionAt,
            members = mergedCompletionMembers,
            startDate = GetChallengeModeStartTimestamp(),
        })
        ScheduleNextMythicPlusScoreBackfill("challenge_mode_completed_score", {
            reset = true,
            force = true,
        })
        UpdateMythicPlusDebugState(characterKey, {
            lastCompletionEventAt = completionAt,
            lastCompletionEventGroupType = completionLiveInfo.groupType,
            lastCompletionEventGroupSize = completionLiveInfo.groupSize,
        })
        AppendMythicPlusDebugEvent(characterKey, "challenge_mode_completed", {
            summary = tostring(completionLiveInfo.groupType or "group")
                .. " (" .. tostring(completionLiveInfo.groupSize or 0) .. ")",
            groupType = completionLiveInfo.groupType,
            groupSize = completionLiveInfo.groupSize,
            memberCount = #mergedCompletionMembers,
        })
        CaptureCompletedRunMembers()
        for _, retryDelay in ipairs(PENDING_RUN_MEMBER_RETRY_DELAYS) do
            ScheduleMythicPlusHistorySync("challenge_mode_completed", retryDelay, { force = true })
        end

    elseif event == "CHALLENGE_MODE_MEMBER_INFO_UPDATED" then
        CaptureCompletedRunMembers()
        ScheduleMythicPlusHistorySync("challenge_mode_member_info_updated", 1, { force = true })

    elseif event == "CHALLENGE_MODE_COMPLETED_REWARDS" then
        local mapChallengeModeID, _, durationMs = ...
        CaptureCompletedRunMembers()
        ScheduleNextMythicPlusScoreBackfill("challenge_mode_completed_rewards_score", {
            reset = true,
            force = true,
        })
        ScheduleMythicPlusHistorySync("challenge_mode_completed_rewards", 1, { force = true })
        AppendMythicPlusDebugEvent(GetCharKey(), "challenge_mode_completed_rewards", {
            summary = "map " .. tostring(mapChallengeModeID) .. " in " .. tostring(durationMs) .. "ms",
            mapChallengeModeID = ToSafeNumber(mapChallengeModeID),
            durationMs = ToSafeNumber(durationMs),
        })

    elseif event == "CHALLENGE_MODE_MAPS_UPDATE" then
        -- Map data may refresh at login, after a hotfix, or across a season
        -- rollover. Keep successful names fast while never pinning stale data
        -- for the rest of a long-running client session.
        runtimeState.cachedCurrentMythicPlusSeasonID = nil
        runtimeState.challengeModeMapNameCache = {}
        runtimeState.mythicPlusMapInfoRequested = true

    elseif event == "CHALLENGE_MODE_RESET" then
        FinalizeActiveAttemptAsAbandoned("challenge_mode_reset", {
            abandonReason = "challenge_mode_reset",
        })
        ClearActiveMythicPlusMemberCache(GetCharKey(), "challenge_mode_reset")

    elseif event == "CHALLENGE_MODE_LEAVER_TIMER_STARTED" then
        local characterKey = GetCharKey()
        UpdateMythicPlusDebugState(characterKey, {
            lastLeaverTimerStartedAt = time(),
            lastLeaverTimerEndedAt = nil,
        })
        AppendMythicPlusDebugEvent(characterKey, "leaver_timer_started", {
            summary = "leaver timer started",
        })

    elseif event == "CHALLENGE_MODE_LEAVER_TIMER_ENDED" then
        local characterKey = GetCharKey()
        UpdateMythicPlusDebugState(characterKey, {
            lastLeaverTimerEndedAt = time(),
        })
        AppendMythicPlusDebugEvent(characterKey, "leaver_timer_ended", {
            summary = "leaver timer ended",
        })

    elseif event == "PLAYER_REGEN_ENABLED" then
        if runtimeState.snapshotDeferredForCombat then
            runtimeState.snapshotDeferredForCombat = false
            C_Timer.After(1, CollectSnapshot)
        end

    elseif event == "SAVED_VARIABLES_TOO_LARGE" then
        local affectedAddonName = ...
        if affectedAddonName == nil or affectedAddonName == addonName then
            PrintAddonMessage(
                "SavedVariables are near the client limit. Older snapshots and Mythic+ runs "
                    .. "will be pruned automatically on the next load."
            )
        end

    elseif event == "TIME_PLAYED_MSG" then
        local totalSeconds, thisLevelSeconds = ...
        SetPlaytimeBaseline(totalSeconds, thisLevelSeconds, time(), UnitLevel("player"))
        if pendingSnapshot then
            CommitSnapshot(totalSeconds, thisLevelSeconds)
        end
    end
end)

