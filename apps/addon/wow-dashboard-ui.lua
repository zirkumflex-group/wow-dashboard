local addonName, addon = ...
addon = addon or {}

local constants = addon.constants or {}
local helpers = addon.uiHelpers or {}

local FONT_BOLD = constants.FONT_BOLD or "Fonts\\FRIZQT__.TTF"
local MINIMAP_ICON = constants.MINIMAP_ICON or 134400
local ADDON_VERSION = constants.ADDON_VERSION or "dev"
local ADDON_INTERFACE = constants.ADDON_INTERFACE or "unknown"
local ADDON_EXPANSION = constants.ADDON_EXPANSION or "unknown"
local DEFAULT_MINIMAP_POS = constants.DEFAULT_MINIMAP_POS or 225
local MINIMAP_BUTTON_RADIUS = constants.MINIMAP_BUTTON_RADIUS or 5
local MAX_LOG_ENTRIES = constants.MAX_LOG_ENTRIES or 200

local BuildSection = helpers.BuildSection
local CreateMajorDivider = helpers.CreateMajorDivider
local BuildCategoryBar = helpers.BuildCategoryBar
local BuildInfoRow = helpers.BuildInfoRow

local timerLabel = nil
local refreshBtn = nil
local minimapToggle = nil

local LEFT_W, RIGHT_W, HEIGHT = 220, 560, 500
local MainFrame = nil
local dashboardTicker = nil

-- ============================================================
-- 1-Second UI Ticker  (timer label + cooldown display)
-- ============================================================

local function OnSecondTick()
    if timerLabel then
        if addon.IsSnapshotPending and addon.IsSnapshotPending() then
            timerLabel:SetText("Saving snapshot...")
        else
            local remaining = math.max(0, math.ceil((addon.GetNextSnapshotAt and addon.GetNextSnapshotAt() or 0) - GetTime()))
            local mm = math.floor(remaining / 60)
            local ss = remaining % 60
            timerLabel:SetFormattedText("Next snapshot  |cffffffff%d:%02d|r", mm, ss)
        end
    end

    if refreshBtn then
        local now = GetTime()
        local cooldownUntil = addon.GetRefreshCooldownUntil and addon.GetRefreshCooldownUntil() or 0
        if now < cooldownUntil then
            refreshBtn:SetText(string.format("Wait  %ds", math.ceil(cooldownUntil - now)))
            refreshBtn:Disable()
        else
            local isEnabled = refreshBtn:IsEnabled()
            if isEnabled == false or isEnabled == nil or isEnabled == 0 then
                refreshBtn:SetText("Save Snapshot")
                refreshBtn:Enable()
            end
        end
    end

    if addon.RefreshOverviewPanel then
        addon.RefreshOverviewPanel()
    end
end

local function StartDashboardUiTicker()
    if dashboardTicker then return end
    dashboardTicker = C_Timer.NewTicker(1, OnSecondTick)
end

local function StopDashboardUiTicker()
    if dashboardTicker then
        dashboardTicker:Cancel()
        dashboardTicker = nil
    end
end

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

function addon.EnsureMinimapSettings()
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

function addon.RefreshMinimapButton()
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

function addon.CreateMinimapButton()
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
            addon.RequestFreshSnapshot()
            return
        end

        addon.ToggleDashboard()
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

addon.RefreshOverviewPanel = function()
    if not overviewWidgets.title then
        return
    end

    local key, name, realm, entry = gui.GetCurrentDashboardEntry()
    local latest, snapshotCount = gui.GetLatestSnapshot(entry)

    if name then
        overviewWidgets.title:SetText(name)
        overviewWidgets.meta:SetText((realm or "Unknown Realm") .. "  |  " .. addon.GetRegion():upper())
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
        if addon.IsSnapshotPending and addon.IsSnapshotPending() then
            overviewWidgets.scheduleDetail:SetText("Saving current character state")
        elseif latest then
            overviewWidgets.scheduleDetail:SetText("Latest: " .. date("%m/%d %H:%M", latest.takenAt))
        else
            overviewWidgets.scheduleDetail:SetText("Automatic capture starts after login")
        end
    end
end

end

function addon.EnsureDashboardFrame()
    if MainFrame then return MainFrame end

    -- Main Window
    -- ============================================================

    MainFrame = CreateFrame("Frame", "WowDashboardFrame", UIParent)
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
        StartDashboardUiTicker()
        if addon.RefreshOverviewPanel then
            addon.RefreshOverviewPanel()
        end
    end)

    MainFrame:SetScript("OnHide", function()
        if WowDashboardDB then
            WowDashboardDB.panelOpen = false
        end
        StopDashboardUiTicker()
    end)

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
        if which == "overview" and addon.RefreshOverviewPanel then addon.RefreshOverviewPanel() end
        if which == "snapshots" and addon.RefreshLog then addon.RefreshLog(true) end
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
        addon.SetDashboardShown(false)
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
        if GetTime() < (addon.GetRefreshCooldownUntil and addon.GetRefreshCooldownUntil() or 0) then return end
        if addon.SetRefreshCooldownUntil then addon.SetRefreshCooldownUntil(GetTime() + 15) end
        addon.RequestFreshSnapshot()
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
        addon.RefreshMinimapButton()
    end)

    UpdateTabVisuals()
    addon.RefreshOverviewPanel()
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

    addon.RefreshLog = function(force)
        if not force and currentTab ~= "snapshots" then return end
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

    return MainFrame
end

function addon.SetDashboardShown(shown)
    if not shown and not MainFrame then return end
    local frame = addon.EnsureDashboardFrame()
    frame:SetShown(shown)
end

function addon.ToggleDashboard()
    local frame = addon.EnsureDashboardFrame()
    frame:SetShown(not frame:IsShown())
end
