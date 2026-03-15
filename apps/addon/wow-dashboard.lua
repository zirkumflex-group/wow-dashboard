local addonName, addon = ...

-- ============================================================
-- WoW Dashboard — Expansion Overview Panel Style
-- ============================================================

local ADDON_PATH = "Interface\\AddOns\\wow-dashboard"
local FONT_BOLD  = ADDON_PATH .. "\\Fonts\\Lato-Bold.ttf"
local BORDER_TEX = ADDON_PATH .. "\\Art\\ExpansionLandingPage\\ExpansionBorder_TWW"

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
--   characters     table    -- keyed by "Name-Realm"
--     name         string
--     realm        string
--     region       string   -- "us" | "eu" | "kr" | "tw"
--     class        string   -- e.g. "WARRIOR"
--     race         string   -- e.g. "Human"
--     faction      string   -- "alliance" | "horde"
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

local DB_VERSION        = 1
local SNAPSHOT_INTERVAL = 15 * 60  -- seconds

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
local initialized          = false  -- true after first PLAYER_ENTERING_WORLD

-- UI widgets — assigned after frames are built; used by the ticker
local timerLabel = nil
local refreshBtn = nil
local RefreshLog = nil  -- assigned after Snapshots panel is built

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

local function CommitSnapshot(totalSeconds)
    if not pendingSnapshot then return end
    local p         = pendingSnapshot
    pendingSnapshot = nil
    p.snap.playtimeSeconds = totalSeconds or 0

    local db = WowDashboardDB
    if not db.characters then db.characters = {} end

    local entry = db.characters[p.key]
    if not entry then
        db.characters[p.key] = {
            name      = p.name,
            realm     = p.realm,
            region    = p.charInfo.region,
            class     = p.charInfo.class,
            race      = p.charInfo.race,
            faction   = p.charInfo.faction,
            snapshots = {},
        }
        entry = db.characters[p.key]
    else
        entry.region  = p.charInfo.region
        entry.class   = p.charInfo.class
        entry.race    = p.charInfo.race
        entry.faction = p.charInfo.faction
    end

    table.insert(entry.snapshots, p.snap)
    lastSnapshotAt = GetTime()
    if RefreshLog then RefreshLog() end
end

local function CollectSnapshot()
    if not IsLoggedIn() then return end

    local key, name, realm = GetCharKey()
    local _, classFilename = UnitClass("player")
    local _, raceFilename  = UnitRace("player")
    local factionGroup     = UnitFactionGroup("player") or "Alliance"

    local specIndex      = GetSpecialization()
    local specName, role = "Unknown", "dps"
    if specIndex and specIndex > 0 then
        local _, sName, _, _, sRole = GetSpecializationInfo(specIndex)
        specName = sName or "Unknown"
        if     sRole == "TANK"   then role = "tank"
        elseif sRole == "HEALER" then role = "healer"
        end
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

    pendingSnapshot = {
        key      = key,
        name     = name,
        realm    = realm,
        charInfo = {
            region  = GetRegion(),
            class   = classFilename,
            race    = raceFilename,
            faction = factionGroup:lower(),
        },
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

    RequestTimePlayed()
end

local function StartSnapshotTicker()
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
BuildInfoRow(LeftSection, "/wowdashboard", "open",     198)
BuildInfoRow(LeftSection, "/wd",           "shortcut", 216)

-- ============================================================
-- Right Section
-- ============================================================

local RightSection = BuildSection(MainFrame, RIGHT_W, HEIGHT, true)
RightSection:SetPoint("TOPLEFT", LeftSection, "TOPRIGHT")

local twwBG = RightSection.NineSlice.Background
twwBG:SetAtlas("thewarwithin-landingpage-background", false)
twwBG:SetVertexColor(0.25, 0.25, 0.25)

RightSection.NineSlice.CloseButton:SetScript("OnClick", function()
    MainFrame:Hide()
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
    CollectSnapshot()
    StartSnapshotTicker()   -- reset the 15-minute window from now
end)

-- Delete all snapshots button (two-click confirmation, 5-second window)
local deleteBtn = CreateFrame("Button", nil, overviewPanel, "UIPanelButtonTemplate")
deleteBtn:SetSize(160, 30)
deleteBtn:SetPoint("TOP", refreshBtn, "BOTTOM", 0, -10)
deleteBtn:SetText("Delete All Snapshots")
deleteBtn:GetFontString():SetFont(FONT_BOLD, 11, "")
deleteBtn:SetFrameLevel(overviewPanel:GetFrameLevel() + 2)

local deletePendingUntil = 0
deleteBtn:SetScript("OnClick", function()
    local now = GetTime()
    if now < deletePendingUntil then
        -- Second click within 5-second window — confirmed, delete
        if WowDashboardDB then
            WowDashboardDB.characters = {}
        end
        if RefreshLog then RefreshLog() end
        deletePendingUntil = 0
        deleteBtn:SetText("Delete All Snapshots")
        deleteBtn:GetFontString():SetTextColor(1, 1, 1)  -- restore default color
        print("|cff00ccff[WoW Dashboard]|r All snapshots deleted.")
    else
        -- First click — arm confirmation for 5 seconds
        deletePendingUntil = now + 5
        deleteBtn:SetText("Click again to confirm!")
        deleteBtn:GetFontString():SetTextColor(1, 0.2, 0.2)
    end
end)

-- Upload button — reloads UI so WoW flushes SavedVariables to disk
local uploadBtn = CreateFrame("Button", nil, overviewPanel, "UIPanelButtonTemplate")
uploadBtn:SetSize(160, 30)
uploadBtn:SetPoint("TOP", deleteBtn, "BOTTOM", 0, -10)
uploadBtn:SetText("Upload")
uploadBtn:GetFontString():SetFont(FONT_BOLD, 11, "")
uploadBtn:SetFrameLevel(overviewPanel:GetFrameLevel() + 2)
uploadBtn:SetScript("OnClick", function()
    ReloadUI()
end)

-- Revert delete button if confirmation window expires (checked by 1-second ticker)
local function UpdateDeleteBtn()
    if deletePendingUntil > 0 and GetTime() >= deletePendingUntil then
        deletePendingUntil = 0
        deleteBtn:SetText("Delete All Snapshots")
        deleteBtn:GetFontString():SetTextColor(1, 1, 1)
    end
end

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
    UpdateDeleteBtn()
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
SlashCmdList["WOWDASHBOARD"] = function()
    MainFrame:SetShown(not MainFrame:IsShown())
end

local eventFrame = CreateFrame("Frame")
eventFrame:RegisterEvent("ADDON_LOADED")
eventFrame:RegisterEvent("PLAYER_ENTERING_WORLD")
eventFrame:RegisterEvent("ZONE_CHANGED_NEW_AREA")
eventFrame:RegisterEvent("TIME_PLAYED_MSG")
eventFrame:SetScript("OnEvent", function(self, event, ...)
    if event == "ADDON_LOADED" and ... == addonName then
        if not WowDashboardDB then
            WowDashboardDB = { version = DB_VERSION, characters = {} }
        end
        if not WowDashboardDB.version    then WowDashboardDB.version    = DB_VERSION end
        if not WowDashboardDB.characters then WowDashboardDB.characters = {} end

    elseif event == "PLAYER_ENTERING_WORLD" then
        if not initialized then
            initialized = true
            print("|cff00ccff[WoW Dashboard]|r Loaded — type |cffffffff/wowdashboard|r to open.")
            MainFrame:Show()
            C_Timer.NewTicker(1, OnSecondTick)
            -- First snapshot in 5 s, then every 15 min
            nextSnapshotAt = GetTime() + 5
            C_Timer.After(5, function()
                CollectSnapshot()
                StartSnapshotTicker()
            end)
        else
            -- Re-entering world (dungeon entry/exit, zone transfer)
            if GetTime() - lastSnapshotAt > 60 then
                C_Timer.After(2, CollectSnapshot)
            end
        end

    elseif event == "ZONE_CHANGED_NEW_AREA" then
        if GetTime() - lastSnapshotAt > 60 then
            C_Timer.After(2, CollectSnapshot)
        end

    elseif event == "TIME_PLAYED_MSG" then
        local totalSeconds = ...
        CommitSnapshot(totalSeconds)
    end
end)
