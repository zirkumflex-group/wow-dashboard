local addonName, addon = ...

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
    if (value == nil or value == "") and type(GetAddOnMetadata) == "function" then
        value = GetAddOnMetadata(addonName, fieldName)
    end

    if value ~= nil and value ~= "" then
        return tostring(value)
    end

    return fallback
end

local ADDON_VERSION   = GetAddonMetadata("Version", "1.2.9")
local ADDON_INTERFACE = GetAddonMetadata("Interface", "120001")
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
--       members            array?
--         name             string
--         realm            string?
--         classTag         string?
--         role             string?  -- "tank" | "healer" | "dps"
--     mythicPlusRunKeys table -- keyed by dedupe fingerprint/canonical key
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
--   pendingMythicPlusMembers table -- keyed by "Name-Realm"
--     capturedAt    number
--     members       array
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

local DB_VERSION            = 2
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
local MAX_REASONABLE_MYTHIC_PLUS_DURATION_MS = 4 * 60 * 60 * 1000
local MYTHIC_PLUS_DEBUG_EVENT_LIMIT = 30
local PLAYTIME_TIMEOUT = 30             -- seconds before we give up waiting for TIME_PLAYED_MSG
local MAX_SNAPSHOTS_PER_CHARACTER = 500
local MAX_MYTHIC_PLUS_RUNS_PER_CHARACTER = 5000
local MAX_MYTHIC_PLUS_RUN_MEMBERS = 10
local MAX_LOG_ENTRIES = 200

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
local pendingCompletedRunMembers = nil
local pendingActiveAttemptReconcile = false

-- UI widgets — assigned after frames are built; used by the ticker
local timerLabel = nil
local refreshBtn = nil
local minimapToggle = nil
local RefreshLog = nil  -- assigned after Snapshots panel is built
local RefreshOverviewPanel = nil
local StartSnapshotTicker = nil

local function GetCharKey()
    local name, realm = UnitFullName("player")
    realm = (realm and realm ~= "") and realm or GetRealmName()
    return name .. "-" .. realm, name, realm
end

local function GetRegion()
    if GetCurrentRegionName then
        local region = GetCurrentRegionName()
        if type(region) == "string" and region ~= "" then
            region = string.lower(region)
            if region == "us" or region == "eu" or region == "kr" or region == "tw" then
                return region
            end
        end
    end
    return "us"
end

local function PrintAddonMessage(message)
    print("|cff00ccff[WoW Dashboard]|r " .. message)
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
            mythicPlusRunKeys = {},
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
    end
    entry.mythicPlusDebug = nil

    -- Trim legacy oversized snapshot lists down to the cap (keeps newest)
    TrimArrayToNewest(entry.snapshots, MAX_SNAPSHOTS_PER_CHARACTER)

    return entry
end

local function NormalizeAndDeduplicateRuns(entry)
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

    local normalizedKeys = {}
    for _, run in ipairs(normalizedRuns) do
        local dedupKey = GetRunDedupKey(run)
        if dedupKey then
            normalizedKeys[dedupKey] = true
        end
    end

    entry.mythicPlusRuns = normalizedRuns
    entry.mythicPlusRunKeys = normalizedKeys
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

local function NormalizePartyRole(value)
    if type(value) ~= "string" then
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
    if type(value) == "string" then
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
    if type(unit) ~= "string" or not UnitExists(unit) or not UnitIsPlayer(unit) then
        return nil
    end

    local name, realm = NormalizeMemberIdentity(UnitFullName(unit))
    if name == nil then
        return nil
    end

    local _, classTag = UnitClass(unit)
    classTag = NormalizeClassTag(classTag)

    local role = NormalizePartyRole(UnitGroupRolesAssigned(unit))
    if role == nil and unit == "player" then
        local specIndex = GetSpecialization()
        if specIndex and specIndex > 0 then
            local _, _, _, _, specRole = GetSpecializationInfo(specIndex)
            role = NormalizePartyRole(specRole)
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
    local _, _, difficultyID = GetInstanceInfo()
    return difficultyID == 8 or difficultyID == 23
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
    if type(C_ChallengeMode) ~= "table" then
        return nil, { apiName = nil }
    end

    local apiName = nil
    local apiFunc = nil
    if type(C_ChallengeMode.GetChallengeCompletionInfo) == "function" then
        apiName = "GetChallengeCompletionInfo"
        apiFunc = C_ChallengeMode.GetChallengeCompletionInfo
    elseif type(C_ChallengeMode.GetCompletionInfo) == "function" then
        apiName = "GetCompletionInfo"
        apiFunc = C_ChallengeMode.GetCompletionInfo
    end

    if type(apiFunc) ~= "function" then
        return nil, { apiName = nil }
    end

    local ok,
        mapChallengeModeID,
        level,
        runTimeMs,
        onTime,
        keystoneUpgradeLevels,
        _practiceRun,
        _oldOverallDungeonScore,
        _newOverallDungeonScore,
        _isMapRecord,
        _isAffixRecord,
        _primaryAffix,
        _isEligibleForScore,
        members = pcall(apiFunc)
    if not ok then
        return nil, { apiName = apiName, callFailed = true }
    end

    if type(mapChallengeModeID) == "table" and level == nil and runTimeMs == nil then
        local info = mapChallengeModeID
        local infoMembers = GetFirstField(info, {
            "members",
            "partyMembers",
            "groupMembers",
            "roster",
        })

        return NormalizeMythicPlusMembers(infoMembers), {
            apiName = apiName,
            mapChallengeModeID = tonumber(GetFirstField(info, {
                "mapChallengeModeID",
                "challengeModeID",
                "mapID",
            })),
            level = tonumber(GetFirstField(info, {
                "level",
                "keystoneLevel",
            })),
            durationMs = tonumber(GetFirstField(info, {
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
            keystoneUpgradeLevels = tonumber(GetFirstField(info, {
                "keystoneUpgradeLevels",
                "upgradeLevels",
            })),
            memberCount = type(infoMembers) == "table" and #infoMembers or 0,
        }
    end

    return NormalizeMythicPlusMembers(members), {
        apiName = apiName,
        mapChallengeModeID = tonumber(mapChallengeModeID),
        level = tonumber(level),
        durationMs = tonumber(runTimeMs),
        completedInTime = NormalizeOptionalBoolean(onTime),
        keystoneUpgradeLevels = tonumber(keystoneUpgradeLevels),
        memberCount = type(members) == "table" and #members or 0,
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

NormalizeOptionalBoolean = function(value)
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
    if type(value) == "number" then
        return value
    end

    if type(value) ~= "table" then
        return nil
    end

    local year = tonumber(value.year)
    local month = tonumber(value.month)
    local day = tonumber(value.day)
    if not year or not month or not day then
        return nil
    end

    if year < 100 then
        year = 2000 + year
    end

    local hour = tonumber(value.hour) or 0
    local minute = tonumber(value.minute) or tonumber(value.min) or 0
    local second = tonumber(value.second) or tonumber(value.sec) or 0

    local localEpoch = time({
        year = year,
        month = month + 1,
        day = day + 1,
        hour = hour,
        min = minute,
        sec = second,
    })
    if localEpoch == nil then
        return nil
    end

    local utcAsLocalEpoch = time(date("!*t", localEpoch))
    if utcAsLocalEpoch == nil then
        return localEpoch
    end

    return localEpoch + math.floor(difftime(localEpoch, utcAsLocalEpoch))
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
    if not mapChallengeModeID then
        return nil
    end
    if not C_ChallengeMode or type(C_ChallengeMode.GetMapUIInfo) ~= "function" then
        return nil
    end

    local ok, mapName = pcall(C_ChallengeMode.GetMapUIInfo, mapChallengeModeID)
    if ok and type(mapName) == "string" and mapName ~= "" then
        return mapName
    end

    return nil
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

local function GetCurrentMythicPlusSeasonID()
    if type(C_MythicPlus) == "table" and type(C_MythicPlus.GetCurrentSeason) == "function" then
        local ok, seasonID = pcall(C_MythicPlus.GetCurrentSeason)
        if ok then
            return tonumber(seasonID)
        end
    end

    return nil
end

local function GetChallengeModeStartTimestamp()
    local startDate = nil
    if type(C_ChallengeMode) == "table" and type(C_ChallengeMode.GetStartTime) == "function" then
        local ok, value = pcall(C_ChallengeMode.GetStartTime)
        if ok then
            startDate = NormalizeLifecycleTimestamp(value)
        end
    end

    return startDate or time()
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

local function FindExactMythicPlusRunIdentityIndex(runs, candidateRun)
    if type(runs) ~= "table" or type(candidateRun) ~= "table" then
        return nil
    end

    local candidateAttemptID = GetRunAttemptID(candidateRun)
    local candidateFingerprint = NormalizeRunIdentityString(candidateRun.fingerprint)
    local candidateDedupKey = GetRunDedupKey(candidateRun)
    if candidateAttemptID == nil and candidateFingerprint == nil and candidateDedupKey == nil then
        return nil
    end

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

local function FindMergeableMythicPlusRunIndex(runs, candidateRun)
    return FindExactMythicPlusRunIdentityIndex(runs, candidateRun)
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
        seasonID = PickDefinedValue(preferredRun.seasonID, fallbackRun.seasonID),
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

    if run.completed ~= true and (run.durationMs ~= nil or run.runScore ~= nil or run.completedAt ~= nil) then
        run.completed = true
    end

    run.source = nil
    run.status = NormalizeRunStatusValue(run.status)
    run.abandonReason = NormalizeAbandonReason(run.abandonReason)
    run.thisWeek = NormalizeOptionalBoolean(run.thisWeek)
    run.members = NormalizeMythicPlusMembers(rawMembers)
    run.raw = nil

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

    if IsTemporaryRunFingerprint(run.fingerprint) and run.status == "active" then
        -- Preserve temporary synthetic fingerprint while the attempt is active.
        run.fingerprint = run.fingerprint
    else
        run.fingerprint = BuildRunFingerprint(run)
    end
    run.attemptId = GetRunAttemptID(run)
    return run
end

local function CallAddonApi(apiFunc, ...)
    if type(apiFunc) ~= "function" then
        return nil
    end

    local packed = { pcall(apiFunc, ...) }
    local ok = table.remove(packed, 1)
    if not ok then
        return nil
    end
    return packed
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
    local completedAt = NormalizeMythicPlusDate(GetFirstField(rawRun, {
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
        seasonID            = seasonID,
        mapChallengeModeID  = mapChallengeModeID,
        mapName             = GetFirstField(rawRun, { "mapName", "name", "zoneName", "shortName" })
            or GetChallengeModeMapName(mapChallengeModeID),
        level               = GetFirstField(rawRun, { "level", "keystoneLevel" }),
        completed           = GetFirstField(rawRun, { "completed", "finishedSuccess", "isCompleted" }),
        completedInTime     = GetFirstField(rawRun, { "completedInTime", "intime", "onTime" }),
        durationMs          = durationMs,
        runScore            = GetFirstField(rawRun, { "runScore", "score", "mythicRating" }),
        status              = NormalizeRunStatusValue(GetFirstField(rawRun, { "status" })),
        startDate           = startDate,
        completedAt         = completedAt,
        endedAt             = endedAt,
        abandonedAt         = abandonedAt,
        abandonReason       = NormalizeAbandonReason(GetFirstField(rawRun, { "abandonReason" })),
        thisWeek            = NormalizeOptionalBoolean(GetFirstField(rawRun, { "thisWeek", "isThisWeek" })),
        members             = members,
    }

    run.completed = NormalizeOptionalBoolean(run.completed)
    run.completedInTime = NormalizeOptionalBoolean(run.completedInTime)

    if run.completed ~= true and (run.durationMs ~= nil or run.runScore ~= nil or run.completedAt ~= nil) then
        run.completed = true
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

    run.fingerprint = BuildRunFingerprint(run)
    run.attemptId = GetRunAttemptID(run)

    return run
end

local function SelectBestRunHistory(calls)
    local bestRuns = nil
    local bestCount = -1

    for _, results in ipairs(calls) do
        if type(results) == "table" then
            for _, value in ipairs(results) do
                if type(value) == "table" and IsSequentialArray(value) then
                    local count = #value
                    local firstValue = value[1]
                    if (count == 0 or type(firstValue) == "table") and count > bestCount then
                        bestRuns = value
                        bestCount = count
                    end
                end
            end
        end
    end

    return bestRuns or {}
end

local function CollectMythicPlusHistory()
    local calls = {}
    local characterKey = GetCharKey()

    local function AddCall(apiFunc, ...)
        local results = CallAddonApi(apiFunc, ...)
        if results then
            calls[#calls + 1] = results
        end
    end

    local seasonID = nil
    if C_MythicPlus and type(C_MythicPlus.GetCurrentSeason) == "function" then
        local ok, result = pcall(C_MythicPlus.GetCurrentSeason)
        if ok then
            seasonID = result
        end
    end

    AddCall(C_MythicPlus and C_MythicPlus.GetRunHistory)
    AddCall(C_MythicPlus and C_MythicPlus.GetRunHistory, false, false)
    AddCall(C_MythicPlus and C_MythicPlus.GetRunHistory, true, false)
    AddCall(C_MythicPlus and C_MythicPlus.GetRunHistory, false, true)
    AddCall(C_MythicPlus and C_MythicPlus.GetRunHistory, true, true)

    local rawRuns = SelectBestRunHistory(calls)
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

    return FindMergeableMythicPlusRunIndex(entry.mythicPlusRuns, run)
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
        NormalizeAndDeduplicateRuns(entry)
        return run, true
    end

    local existing = entry.mythicPlusRuns[existingIndex]
    local merged = MergeStoredMythicPlusRun(existing, run)
    local changed = DidMythicPlusRunChange(existing, merged)
    entry.mythicPlusRuns[existingIndex] = merged
    NormalizeAndDeduplicateRuns(entry)
    return merged, changed
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
        startDate = NormalizeLifecycleTimestamp(options.startDate) or (type(activeRun) == "table" and activeRun.startDate),
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

local function SyncMythicPlusHistory(reason, options)
    options = options or {}
    if not IsLoggedIn() then
        return false
    end

    if type(C_MythicPlus) == "table" and type(C_MythicPlus.RequestMapInfo) == "function" then
        pcall(C_MythicPlus.RequestMapInfo)
    end

    local key, name, realm, charInfo = GetCharacterIdentity()
    local entry = EnsureCharacterEntry(key, name, realm, charInfo)
    NormalizeAndDeduplicateRuns(entry)
    local beforeCount = #entry.mythicPlusRuns
    local runs = CollectMythicPlusHistory()
    local added = 0
    local updated = false

    for _, run in ipairs(runs) do
        local normalizedRun = NormalizeStoredMythicPlusRun(run)
        if normalizedRun ~= nil then
            if normalizedRun.observedAt == nil or normalizedRun.observedAt == 0 then
                normalizedRun.observedAt = time()
            end

            local existingIndex = FindMergeableMythicPlusRunIndex(entry.mythicPlusRuns, normalizedRun)
            if existingIndex == nil then
                entry.mythicPlusRuns[#entry.mythicPlusRuns + 1] = normalizedRun
                added = added + 1
            else
                local existing = entry.mythicPlusRuns[existingIndex]
                local merged = MergeStoredMythicPlusRun(existing, normalizedRun)
                if DidMythicPlusRunChange(existing, merged) then
                    entry.mythicPlusRuns[existingIndex] = merged
                    updated = true
                end
            end
        end
    end

    if added > 0 or updated then
        NormalizeAndDeduplicateRuns(entry)
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
        local quantity = 0
        if type(C_CurrencyInfo) == "table" and type(C_CurrencyInfo.GetCurrencyInfo) == "function" then
            local ok, info = pcall(C_CurrencyInfo.GetCurrencyInfo, currencyID)
            if ok and type(info) == "table" then
                quantity = tonumber(info.quantity) or 0
            end
        end
        currencies[fieldName] = quantity
    end

    local _, stamina = UnitStat("player", LE_UNIT_STAT_STAMINA)
    local _, strength = UnitStat("player", LE_UNIT_STAT_STRENGTH)
    local _, agility = UnitStat("player", LE_UNIT_STAT_AGILITY)
    local _, intellect = UnitStat("player", LE_UNIT_STAT_INTELLECT)

    local stats = {
        stamina            = stamina or 0,
        strength           = strength or 0,
        agility            = agility or 0,
        intellect          = intellect or 0,
        critRating         = CR_CRIT_MELEE and GetCombatRating(CR_CRIT_MELEE) or 0,
        critPercent        = GetCritChance()    or 0,
        hasteRating        = CR_HASTE_MELEE and GetCombatRating(CR_HASTE_MELEE) or 0,
        hastePercent       = GetMeleeHaste()    or 0,
        masteryRating      = CR_MASTERY and GetCombatRating(CR_MASTERY) or 0,
        masteryPercent     = GetMasteryEffect() or 0,
        versatilityRating  = CR_VERSATILITY_DAMAGE_DONE and GetCombatRating(CR_VERSATILITY_DAMAGE_DONE) or 0,
        versatilityPercent = GetCombatRatingBonus(CR_VERSATILITY_DAMAGE_DONE) or 0,
        speedRating        = CR_SPEED and GetCombatRating(CR_SPEED) or 0,
        speedPercent       = CR_SPEED and GetCombatRatingBonus(CR_SPEED) or 0,
        leechRating        = CR_LIFESTEAL and GetCombatRating(CR_LIFESTEAL) or 0,
        leechPercent       = CR_LIFESTEAL and GetCombatRatingBonus(CR_LIFESTEAL) or 0,
        avoidanceRating    = CR_AVOIDANCE and GetCombatRating(CR_AVOIDANCE) or 0,
        avoidancePercent   = CR_AVOIDANCE and GetCombatRatingBonus(CR_AVOIDANCE) or 0,
    }

    local mplusScore = 0
    if type(C_ChallengeMode) == "table" and type(C_ChallengeMode.GetOverallDungeonScore) == "function" then
        local ok, score = pcall(C_ChallengeMode.GetOverallDungeonScore)
        if ok then
            mplusScore = tonumber(score) or 0
        end
    end

    local ownedKeystone = nil
    if C_MythicPlus then
        local ownedKeystoneLevel = nil
        if type(C_MythicPlus.GetOwnedKeystoneLevel) == "function" then
            local ok, result = pcall(C_MythicPlus.GetOwnedKeystoneLevel)
            if ok then
                ownedKeystoneLevel = tonumber(result)
            end
        end

        if ownedKeystoneLevel and ownedKeystoneLevel > 0 then
            local mapChallengeModeID = nil
            if type(C_MythicPlus.GetOwnedKeystoneChallengeMapID) == "function" then
                local ok, result = pcall(C_MythicPlus.GetOwnedKeystoneChallengeMapID)
                if ok then
                    mapChallengeModeID = tonumber(result)
                end
            end

            ownedKeystone = {
                level = ownedKeystoneLevel,
                mapChallengeModeID = mapChallengeModeID,
                mapName = GetChallengeModeMapName(mapChallengeModeID),
            }
        end
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
            playtimeThisLevelSeconds = 0,
            mythicPlusScore = mplusScore,
            ownedKeystone   = ownedKeystone,
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
                return totalSeconds or 0, thisLevelSeconds or 0
            end
        end
    end

    return 0, 0
end

local function CommitSnapshot(totalSeconds, thisLevelSeconds)
    if not pendingSnapshot then return end
    local p         = pendingSnapshot
    pendingSnapshot = nil
    p.snap.playtimeSeconds = totalSeconds or 0
    p.snap.playtimeThisLevelSeconds = thisLevelSeconds or 0

    local db = WowDashboardDB
    local entry = EnsureCharacterEntry(p.key, p.name, p.realm, p.charInfo)

    table.insert(entry.snapshots, p.snap)

    -- Bound snapshot retention per character
    TrimArrayToNewest(entry.snapshots, MAX_SNAPSHOTS_PER_CHARACTER)

    lastSnapshotAt = GetTime()
    if RefreshLog then
        RefreshLog()
    end
    if RefreshOverviewPanel then
        RefreshOverviewPanel()
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
    if type(RequestTimePlayed) == "function" then
        local ok = pcall(RequestTimePlayed)
        if ok then
            -- Failsafe: if TIME_PLAYED_MSG never arrives, unblock after timeout
            local timeoutSnapshot = snapshot
            C_Timer.After(PLAYTIME_TIMEOUT, function()
                if waitingForPlaytime and pendingSnapshot == timeoutSnapshot then
                    waitingForPlaytime = false
                    RestoreTimePlayedMessages()
                    CommitSnapshot(GetLastKnownPlaytime(timeoutSnapshot.key))
                    if queuedFreshSnapshot then
                        queuedFreshSnapshot = false
                        CollectSnapshot(true)
                    end
                end
            end)
            return true
        end
    end

    waitingForPlaytime = false
    RestoreTimePlayedMessages()
    CommitSnapshot(GetLastKnownPlaytime(snapshot.key))
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

local LEFT_W, RIGHT_W, HEIGHT = 220, 560, 500

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

local snapshotsPanel = nil

do
addon.gui = addon.gui or {}
local gui = addon.gui

gui.CreatePanelFill = function(parent, r, g, b, a)
    local tex = parent:CreateTexture(nil, "BACKGROUND")
    tex:SetAllPoints(parent)
    tex:SetColorTexture(r, g, b, a)
    return tex
end

gui.CreatePanelLine = function(parent, anchor, r, g, b, a)
    local line = parent:CreateTexture(nil, "BORDER")
    line:SetHeight(1)
    line:SetPoint("LEFT", parent, "LEFT", 8, 0)
    line:SetPoint("RIGHT", parent, "RIGHT", -8, 0)
    line:SetPoint(anchor, parent, anchor)
    line:SetColorTexture(r, g, b, a)
    return line
end

gui.CreateDashboardCard = function(parent, width, height)
    local card = CreateFrame("Frame", nil, parent)
    card:SetSize(width, height)
    gui.CreatePanelFill(card, 0.055, 0.044, 0.032, 0.92)
    gui.CreatePanelLine(card, "TOP", 1, 0.82, 0, 0.28)
    gui.CreatePanelLine(card, "BOTTOM", 0, 0, 0, 0.45)
    return card
end

gui.CreateSmallLabel = function(parent, text)
    local label = parent:CreateFontString(nil, "OVERLAY")
    label:SetFont(FONT_BOLD, 9, "")
    label:SetTextColor(0.58, 0.52, 0.44)
    label:SetText(text)
    return label
end

gui.CreateValueText = function(parent, size)
    local text = parent:CreateFontString(nil, "OVERLAY")
    text:SetFont(FONT_BOLD, size or 15, "")
    text:SetTextColor(1, 0.86, 0.36)
    return text
end

gui.StyleDashboardButton = function(button)
    button:GetFontString():SetFont(FONT_BOLD, 11, "")
    button:SetFrameLevel(button:GetParent():GetFrameLevel() + 3)
end

gui.FormatGoldAmount = function(value)
    local gold = tonumber(value) or 0
    if gold >= 1000000 then
        return string.format("%.1fm", gold / 1000000)
    end
    if gold >= 10000 then
        return string.format("%.1fk", gold / 1000)
    end
    return tostring(math.floor(gold))
end

gui.FormatShortAge = function(timestamp)
    if type(timestamp) ~= "number" or timestamp <= 0 then
        return "never"
    end

    local seconds = math.max(0, time() - timestamp)
    if seconds < 60 then
        return "just now"
    end
    if seconds < 3600 then
        return tostring(math.floor(seconds / 60)) .. "m ago"
    end
    if seconds < 86400 then
        return tostring(math.floor(seconds / 3600)) .. "h ago"
    end
    return tostring(math.floor(seconds / 86400)) .. "d ago"
end

gui.GetCurrentDashboardEntry = function()
    if not IsLoggedIn() then
        return nil, nil, nil, nil
    end

    local name, realm = UnitFullName("player")
    if type(name) ~= "string" or name == "" then
        return nil, nil, nil, nil
    end

    realm = (realm and realm ~= "") and realm or GetRealmName()
    local key = name .. "-" .. realm
    local characters = WowDashboardDB and WowDashboardDB.characters
    local entry = type(characters) == "table" and characters[key] or nil
    return key, name, realm, entry
end

gui.GetLatestSnapshot = function(entry)
    local snapshots = type(entry) == "table" and entry.snapshots or nil
    if type(snapshots) ~= "table" or #snapshots == 0 then
        return nil, 0
    end
    return snapshots[#snapshots], #snapshots
end

gui.overviewWidgets = gui.overviewWidgets or {}
gui.metricCards = gui.metricCards or {}
local overviewWidgets = gui.overviewWidgets
local metricCards = gui.metricCards

gui.SetMetric = function(index, value, detail)
    local card = metricCards[index]
    if not card then
        return
    end
    card.value:SetText(value)
    card.detail:SetText(detail or "")
end

RefreshOverviewPanel = function()
    if not overviewWidgets.title then
        return
    end

    local key, name, realm, entry = gui.GetCurrentDashboardEntry()
    local latest, snapshotCount = gui.GetLatestSnapshot(entry)

    if name then
        overviewWidgets.title:SetText(name)
        overviewWidgets.meta:SetText((realm or "Unknown Realm") .. "  |  " .. GetRegion():upper())
        local _, classTag = UnitClass("player")
        local classColor = RAID_CLASS_COLORS and classTag and RAID_CLASS_COLORS[classTag] or nil
        if classColor then
            overviewWidgets.title:SetTextColor(classColor.r, classColor.g, classColor.b)
        else
            overviewWidgets.title:SetTextColor(1, 0.86, 0.36)
        end
    else
        overviewWidgets.title:SetText("Character not ready")
        overviewWidgets.meta:SetText("Enter the world to start collecting data")
        overviewWidgets.title:SetTextColor(1, 0.86, 0.36)
    end

    if latest then
        local spec = type(latest.spec) == "string" and latest.spec or "Unknown spec"
        local role = type(latest.role) == "string" and latest.role or "dps"
        overviewWidgets.snapshotStatus:SetText("Last snapshot " .. gui.FormatShortAge(latest.takenAt))
        overviewWidgets.snapshotDetail:SetText("Lv " .. tostring(tonumber(latest.level) or UnitLevel("player") or 0)
            .. " " .. spec .. "  |  " .. string.upper(role))
        gui.SetMetric(1, string.format("%.1f", tonumber(latest.itemLevel) or 0), "Equipped item level")
        gui.SetMetric(2, gui.FormatGoldAmount(latest.gold), "Gold saved locally")
        gui.SetMetric(3, tostring(math.floor(tonumber(latest.mythicPlusScore) or 0)), "Mythic+ rating")
        gui.SetMetric(4, tostring(snapshotCount), "Snapshots for this character")
    else
        overviewWidgets.snapshotStatus:SetText("No saved snapshot")
        overviewWidgets.snapshotDetail:SetText("Use Save Snapshot after logging in")
        gui.SetMetric(1, "--", "Equipped item level")
        gui.SetMetric(2, "--", "Gold saved locally")
        gui.SetMetric(3, "--", "Mythic+ rating")
        gui.SetMetric(4, tostring(snapshotCount), "Snapshots for this character")
    end

    if overviewWidgets.sidebarStatus then
        local label = key and (tostring(snapshotCount) .. " local snapshots") or "Waiting for player"
        overviewWidgets.sidebarStatus:SetText(label)
    end

    if overviewWidgets.scheduleDetail then
        if pendingSnapshot then
            overviewWidgets.scheduleDetail:SetText("Saving current character state")
        elseif latest then
            overviewWidgets.scheduleDetail:SetText("Latest: " .. date("%m/%d %H:%M", latest.takenAt))
        else
            overviewWidgets.scheduleDetail:SetText("Automatic capture starts after login")
        end
    end
end

end

do
local gui = addon.gui
local overviewWidgets = gui.overviewWidgets
local metricCards = gui.metricCards
local LeftSection = BuildSection(MainFrame, LEFT_W, HEIGHT, false)
LeftSection:SetPoint("TOPLEFT", MainFrame, "TOPLEFT")

do
local brandIcon = LeftSection:CreateTexture(nil, "ARTWORK")
brandIcon:SetSize(42, 42)
brandIcon:SetTexture(MINIMAP_ICON)
brandIcon:SetPoint("TOPLEFT", LeftSection, "TOPLEFT", 24, -42)

local brandTitle = LeftSection:CreateFontString(nil, "OVERLAY")
brandTitle:SetFont(FONT_BOLD, 16, "")
brandTitle:SetTextColor(1, 0.86, 0.36)
brandTitle:SetPoint("TOPLEFT", brandIcon, "TOPRIGHT", 10, -3)
brandTitle:SetText("WoW Dashboard")

local brandSub = LeftSection:CreateFontString(nil, "OVERLAY")
brandSub:SetFont(FONT_BOLD, 9, "")
brandSub:SetTextColor(0.62, 0.56, 0.46)
brandSub:SetPoint("TOPLEFT", brandTitle, "BOTTOMLEFT", 0, -4)
brandSub:SetText("Addon capture")
end

BuildCategoryBar(LeftSection, "Navigation", 104)

local navOverview = CreateFrame("Button", nil, LeftSection)
local navSnapshots = CreateFrame("Button", nil, LeftSection)

local function SetupNavButton(button, label, yOffset)
    button:SetSize(168, 30)
    button:SetPoint("TOP", LeftSection, "TOP", 0, -yOffset)
    button.bg = button:CreateTexture(nil, "BACKGROUND")
    button.bg:SetAllPoints(button)
    button.lbl = button:CreateFontString(nil, "OVERLAY")
    button.lbl:SetFont(FONT_BOLD, 11, "")
    button.lbl:SetPoint("LEFT", button, "LEFT", 12, 0)
    button.lbl:SetText(label)
end

local currentTab = "overview"
local overviewPanel = nil

local function UpdateTabVisuals()
    local function Apply(button, active)
        button.bg:SetColorTexture(active and 0.22 or 0.09, active and 0.15 or 0.07, active and 0.05 or 0.04, active and 0.92 or 0.75)
        button.lbl:SetTextColor(active and 1 or 0.78, active and 0.86 or 0.68, active and 0.36 or 0.50)
    end
    Apply(navOverview, currentTab == "overview")
    Apply(navSnapshots, currentTab == "snapshots")
end

local function SelectTab(which)
    currentTab = which
    UpdateTabVisuals()
    overviewPanel:SetShown(which == "overview")
    snapshotsPanel:SetShown(which == "snapshots")
    if which == "overview" and RefreshOverviewPanel then RefreshOverviewPanel() end
    if which == "snapshots" and RefreshLog then RefreshLog() end
end

SetupNavButton(navOverview, "Overview", 140)
SetupNavButton(navSnapshots, "Snapshots", 176)
navOverview:SetScript("OnClick", function() SelectTab("overview") end)
navSnapshots:SetScript("OnClick", function() SelectTab("snapshots") end)

do
BuildCategoryBar(LeftSection, "Addon", 224)
BuildInfoRow(LeftSection, "Version",    ADDON_VERSION,   264)
BuildInfoRow(LeftSection, "Interface",  ADDON_INTERFACE, 282)
BuildInfoRow(LeftSection, "Expansion",  ADDON_EXPANSION, 300)

BuildCategoryBar(LeftSection, "Local State", 340)
overviewWidgets.sidebarStatus = LeftSection:CreateFontString(nil, "OVERLAY")
overviewWidgets.sidebarStatus:SetFont(FONT_BOLD, 11, "")
overviewWidgets.sidebarStatus:SetTextColor(0.80, 0.80, 0.80)
overviewWidgets.sidebarStatus:SetPoint("TOPLEFT", LeftSection, "TOPLEFT", 24, -380)
overviewWidgets.sidebarStatus:SetText("Waiting for player")

local slashHint = LeftSection:CreateFontString(nil, "OVERLAY")
slashHint:SetFont(FONT_BOLD, 10, "")
slashHint:SetTextColor(0.58, 0.52, 0.44)
slashHint:SetPoint("TOPLEFT", overviewWidgets.sidebarStatus, "BOTTOMLEFT", 0, -10)
slashHint:SetText("/wd toggles the window")
end

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

do
-- Header title
local headerTitle = RightSection:CreateFontString(nil, "OVERLAY")
headerTitle:SetFont(FONT_BOLD, 19, "")
headerTitle:SetTextColor(1, 0.82, 0)
headerTitle:SetPoint("TOPLEFT", RightSection, "TOPLEFT", 36, -36)
headerTitle:SetText("Character Capture")

local headerSub = RightSection:CreateFontString(nil, "OVERLAY")
headerSub:SetFont(FONT_BOLD, 10, "")
headerSub:SetTextColor(0.62, 0.56, 0.46)
headerSub:SetPoint("TOPLEFT", headerTitle, "BOTTOMLEFT", 0, -5)
headerSub:SetText("Snapshots, currencies, stats, and Mythic+ run history")

local cadencePill = CreateFrame("Frame", nil, RightSection)
cadencePill:SetSize(150, 24)
cadencePill:SetPoint("TOPRIGHT", RightSection, "TOPRIGHT", -40, -39)
gui.CreatePanelFill(cadencePill, 0.12, 0.09, 0.05, 0.85)

local cadenceText = cadencePill:CreateFontString(nil, "OVERLAY")
cadenceText:SetFont(FONT_BOLD, 9, "")
cadenceText:SetTextColor(1, 0.86, 0.36)
cadenceText:SetPoint("CENTER", cadencePill, "CENTER")
cadenceText:SetText("15 min autosave")
end

-- Divider below header
-- Keep the decorative divider in the header, above the tab content.
local div = CreateMajorDivider(RightSection)
div:SetPoint("TOPLEFT",  RightSection, "TOPLEFT",  36, -72)
div:SetPoint("TOPRIGHT", RightSection, "TOPRIGHT", -36, -72)

-- ============================================================
-- Content area
-- ============================================================

-- Content panels share the same anchor (one shown at a time)
overviewPanel = CreateFrame("Frame", nil, RightSection)
overviewPanel:SetPoint("TOPLEFT",     RightSection, "TOPLEFT",     36, -92)
overviewPanel:SetPoint("BOTTOMRIGHT", RightSection, "BOTTOMRIGHT", -36, 30)

snapshotsPanel = CreateFrame("Frame", nil, RightSection)
snapshotsPanel:SetPoint("TOPLEFT",     RightSection, "TOPLEFT",     36, -92)
snapshotsPanel:SetPoint("BOTTOMRIGHT", RightSection, "BOTTOMRIGHT", -36, 30)
snapshotsPanel:Hide()

-- ============================================================
-- Overview Panel
-- ============================================================

local hero = gui.CreateDashboardCard(overviewPanel, RIGHT_W - 72, 92)
hero:SetPoint("TOPLEFT", overviewPanel, "TOPLEFT", 0, 0)

overviewWidgets.title = gui.CreateValueText(hero, 22)
overviewWidgets.title:SetPoint("TOPLEFT", hero, "TOPLEFT", 18, -16)
overviewWidgets.title:SetText("Character not ready")

overviewWidgets.meta = gui.CreateSmallLabel(hero, "Enter the world to start collecting data")
overviewWidgets.meta:SetPoint("TOPLEFT", overviewWidgets.title, "BOTTOMLEFT", 1, -5)

overviewWidgets.snapshotStatus = gui.CreateValueText(hero, 12)
overviewWidgets.snapshotStatus:SetPoint("TOPRIGHT", hero, "TOPRIGHT", -18, -20)
overviewWidgets.snapshotStatus:SetJustifyH("RIGHT")
overviewWidgets.snapshotStatus:SetText("No saved snapshot")

overviewWidgets.snapshotDetail = gui.CreateSmallLabel(hero, "")
overviewWidgets.snapshotDetail:SetPoint("TOPRIGHT", overviewWidgets.snapshotStatus, "BOTTOMRIGHT", 0, -7)
overviewWidgets.snapshotDetail:SetJustifyH("RIGHT")

local function BuildMetricCard(index, label, xOffset)
    local card = gui.CreateDashboardCard(overviewPanel, 116, 74)
    card:SetPoint("TOPLEFT", overviewPanel, "TOPLEFT", xOffset, -108)
    card.label = gui.CreateSmallLabel(card, label)
    card.label:SetPoint("TOPLEFT", card, "TOPLEFT", 12, -10)
    card.value = gui.CreateValueText(card, 20)
    card.value:SetPoint("TOPLEFT", card.label, "BOTTOMLEFT", 0, -8)
    card.value:SetText("--")
    card.detail = gui.CreateSmallLabel(card, "")
    card.detail:SetPoint("BOTTOMLEFT", card, "BOTTOMLEFT", 12, 9)
    metricCards[index] = card
end

BuildMetricCard(1, "ITEM LEVEL", 0)
BuildMetricCard(2, "GOLD", 124)
BuildMetricCard(3, "MYTHIC+", 248)
BuildMetricCard(4, "SAVED", 372)

local scheduleCard = gui.CreateDashboardCard(overviewPanel, 240, 100)
scheduleCard:SetPoint("TOPLEFT", overviewPanel, "TOPLEFT", 0, -198)

local scheduleLabel = gui.CreateSmallLabel(scheduleCard, "SNAPSHOT SCHEDULE")
scheduleLabel:SetPoint("TOPLEFT", scheduleCard, "TOPLEFT", 14, -12)

timerLabel = gui.CreateValueText(scheduleCard, 18)
timerLabel:SetPoint("TOPLEFT", scheduleLabel, "BOTTOMLEFT", 0, -10)
timerLabel:SetText("Next snapshot  --:--")

overviewWidgets.scheduleDetail = gui.CreateSmallLabel(scheduleCard, "Automatic capture starts after login")
overviewWidgets.scheduleDetail:SetPoint("TOPLEFT", timerLabel, "BOTTOMLEFT", 0, -10)

local actionCard = gui.CreateDashboardCard(overviewPanel, 240, 100)
actionCard:SetPoint("TOPLEFT", overviewPanel, "TOPLEFT", 248, -198)

local actionLabel = gui.CreateSmallLabel(actionCard, "ACTIONS")
actionLabel:SetPoint("TOPLEFT", actionCard, "TOPLEFT", 14, -12)

-- Manual snapshot button (15-second cooldown)
refreshBtn = CreateFrame("Button", nil, actionCard, "UIPanelButtonTemplate")
refreshBtn:SetSize(132, 28)
refreshBtn:SetPoint("TOPLEFT", actionCard, "TOPLEFT", 14, -38)
refreshBtn:SetText("Save Snapshot")
gui.StyleDashboardButton(refreshBtn)
refreshBtn:SetScript("OnClick", function()
    if GetTime() < refreshCooldownUntil then return end
    refreshCooldownUntil = GetTime() + 15
    RequestFreshSnapshot()
end)

minimapToggle = CreateFrame("CheckButton", nil, actionCard, "UICheckButtonTemplate")
minimapToggle:SetPoint("TOPLEFT", refreshBtn, "BOTTOMLEFT", -4, -14)
minimapToggle:SetSize(24, 24)
minimapToggle.Label = actionCard:CreateFontString(nil, "OVERLAY")
minimapToggle.Label:SetFont(FONT_BOLD, 11, "")
minimapToggle.Label:SetTextColor(0.80, 0.80, 0.80)
minimapToggle.Label:SetPoint("LEFT", minimapToggle, "RIGHT", 4, 0)
minimapToggle.Label:SetText("Show minimap icon")
minimapToggle:SetScript("OnClick", function(self)
    if not WowDashboardDB or not WowDashboardDB.minimap then return end

    WowDashboardDB.minimap.hide = not self:GetChecked()
    RefreshMinimapButton()
end)

UpdateTabVisuals()
RefreshOverviewPanel()
end

-- ============================================================
-- Snapshots Panel — scrollable log of saved snapshots
-- ============================================================

do
local LOG_ROW_H     = 24
local LOG_ROW_GAP   = 2
local SCROLL_W      = RIGHT_W - 72 - 8
local COL_CHAR_W    = 154
local COL_TIME_W    = 96

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
logHeader:SetTextColor(0.78, 0.68, 0.46)
logHeader:SetJustifyH("LEFT")
logHeader:SetPoint("TOPLEFT", scrollChild, "TOPLEFT", 8, -5)
logHeader:SetText("CHARACTER                  DATE/TIME         LEVEL   ILVL     GOLD      M+")

local emptyState = snapshotsPanel:CreateFontString(nil, "OVERLAY")
emptyState:SetFont(FONT_BOLD, 12, "")
emptyState:SetTextColor(0.62, 0.56, 0.46)
emptyState:SetPoint("CENTER", snapshotsPanel, "CENTER", 0, 4)
emptyState:SetText("No local snapshots yet")

-- Row pool
local rowPool  = {}
local rowCount = 0

local function GetRow(i)
    if rowPool[i] then return rowPool[i] end

    local row = CreateFrame("Frame", nil, scrollChild)
    local rowW = SCROLL_W - 8
    row:SetSize(rowW, LOG_ROW_H)
    row:SetPoint("TOPLEFT", scrollChild, "TOPLEFT", 4, -(22 + (i - 1) * (LOG_ROW_H + LOG_ROW_GAP)))

    local bg = row:CreateTexture(nil, "BACKGROUND")
    bg:SetAllPoints(row)
    if i % 2 == 0 then
        bg:SetColorTexture(0.11, 0.08, 0.045, 0.50)
    else
        bg:SetColorTexture(0.055, 0.044, 0.032, 0.38)
    end

    row.charText = row:CreateFontString(nil, "OVERLAY")
    row.charText:SetFont(FONT_BOLD, 10, "")
    row.charText:SetTextColor(1, 0.82, 0)
    row.charText:SetWidth(COL_CHAR_W)
    row.charText:SetJustifyH("LEFT")
    row.charText:SetPoint("LEFT", row, "LEFT", 8, 0)

    row.timeText = row:CreateFontString(nil, "OVERLAY")
    row.timeText:SetFont(FONT_BOLD, 10, "")
    row.timeText:SetTextColor(0.66, 0.62, 0.56)
    row.timeText:SetWidth(COL_TIME_W)
    row.timeText:SetJustifyH("LEFT")
    row.timeText:SetPoint("LEFT", row, "LEFT", COL_CHAR_W + 14, 0)

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
        local snapshots = type(charData) == "table" and charData.snapshots or nil
        for _, snap in ipairs(snapshots or {}) do
            if type(snap) == "table" and type(snap.takenAt) == "number" then
                all[#all + 1] = { key = key, snap = snap }
            end
        end
    end
    table.sort(all, function(a, b) return a.snap.takenAt > b.snap.takenAt end)

    local n = math.min(#all, MAX_LOG_ENTRIES)

    -- Hide rows no longer needed
    for i = n + 1, rowCount do
        rowPool[i]:Hide()
    end
    rowCount = n

    for i = 1, n do
        local entry = all[i]
        local row  = GetRow(i)
        local snap = entry.snap
        row.charText:SetText(entry.key)
        row.timeText:SetText(date("%m/%d %H:%M", snap.takenAt))
        row.statsText:SetFormattedText("Lv%d  %d  %dg  %dM+",
            tonumber(snap.level) or 0,
            math.floor(tonumber(snap.itemLevel) or 0),
            math.floor(tonumber(snap.gold) or 0),
            tonumber(snap.mythicPlusScore) or 0)
        row:Show()
    end

    emptyState:SetShown(n == 0)
    scrollChild:SetHeight(math.max(24 + n * (LOG_ROW_H + LOG_ROW_GAP), 1))
end
end

-- ============================================================
-- 1-Second UI Ticker  (timer label + cooldown display)
-- ============================================================

local function OnSecondTick()
    if timerLabel then
        if pendingSnapshot then
            timerLabel:SetText("Saving snapshot...")
        else
            local remaining = math.max(0, math.ceil(nextSnapshotAt - GetTime()))
            local mm = math.floor(remaining / 60)
            local ss = remaining % 60
            timerLabel:SetFormattedText("Next snapshot  |cffffffff%d:%02d|r", mm, ss)
        end
    end

    if refreshBtn then
        local now = GetTime()
        if now < refreshCooldownUntil then
            refreshBtn:SetText(string.format("Wait  %ds", math.ceil(refreshCooldownUntil - now)))
            refreshBtn:Disable()
        else
            local isEnabled = refreshBtn:IsEnabled()
            if isEnabled == false or isEnabled == nil or isEnabled == 0 then
                refreshBtn:SetText("Save Snapshot")
                refreshBtn:Enable()
            end
        end
    end

    if RefreshOverviewPanel then
        RefreshOverviewPanel()
    end
end

-- ============================================================
-- Slash Commands & Events
-- ============================================================

SLASH_WOWDASHBOARD1 = "/wd"
SLASH_WOWDASHBOARD2 = "/wowdashboard"
local function PrintSlashHelp()
    PrintAddonMessage("Commands: /wd, /wd help, /wd open, /wd mplusdebug")
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

    if command == "mplusdebug" then
        PrintMythicPlusDebug()
        return
    end

    PrintSlashHelp()
end

local eventFrame = CreateFrame("Frame")
eventFrame:RegisterEvent("ADDON_LOADED")
eventFrame:RegisterEvent("PLAYER_ENTERING_WORLD")
eventFrame:RegisterEvent("ZONE_CHANGED_NEW_AREA")
eventFrame:RegisterEvent("GROUP_ROSTER_UPDATE")
eventFrame:RegisterEvent("CHALLENGE_MODE_START")
eventFrame:RegisterEvent("CHALLENGE_MODE_COMPLETED")
eventFrame:RegisterEvent("CHALLENGE_MODE_RESET")
eventFrame:RegisterEvent("CHALLENGE_MODE_LEAVER_TIMER_STARTED")
eventFrame:RegisterEvent("CHALLENGE_MODE_LEAVER_TIMER_ENDED")
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
        if type(WowDashboardDB.activeMythicPlusMembers) ~= "table" then
            WowDashboardDB.activeMythicPlusMembers = {}
        end
        if type(WowDashboardDB.pendingMythicPlusMembers) ~= "table" then
            WowDashboardDB.pendingMythicPlusMembers = {}
        end
        if WowDashboardDB.panelOpen == nil then WowDashboardDB.panelOpen = false end
        EnsureMinimapSettings()
        if minimapToggle then
            minimapToggle:SetChecked(not WowDashboardDB.minimap.hide)
        end
        CreateMinimapButton()

    elseif event == "PLAYER_ENTERING_WORLD" then
        RefreshMinimapButton()
        if RefreshOverviewPanel then
            RefreshOverviewPanel()
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
        if GetTime() - lastSnapshotAt > 60 then
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

    elseif event == "TIME_PLAYED_MSG" then
        local totalSeconds, thisLevelSeconds = ...
        if waitingForPlaytime then
            waitingForPlaytime = false
            RestoreTimePlayedMessages()
        end
        CommitSnapshot(totalSeconds, thisLevelSeconds)
        if queuedFreshSnapshot then
            queuedFreshSnapshot = false
            CollectSnapshot(true)
        end
    end
end)

