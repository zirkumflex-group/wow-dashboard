local addonName, addon = ...
addon = addon or {}

local constants = addon.constants or {}
local helpers = addon.uiHelpers or {}

local FONT_BOLD = constants.FONT_BOLD or "Fonts\\FRIZQT__.TTF"
local FONT_BODY = "Fonts\\FRIZQT__.TTF"
local MINIMAP_ICON = constants.MINIMAP_ICON or 134400
local ADDON_VERSION = constants.ADDON_VERSION or "dev"
local ADDON_INTERFACE = constants.ADDON_INTERFACE or "unknown"
local ADDON_EXPANSION = constants.ADDON_EXPANSION or "unknown"
local DEFAULT_MINIMAP_POS = constants.DEFAULT_MINIMAP_POS or 225
local MINIMAP_BUTTON_RADIUS = constants.MINIMAP_BUTTON_RADIUS or 5
local MAX_LOG_ENTRIES = constants.MAX_LOG_ENTRIES or 200
local BuildSection = helpers.BuildSection

local FRAME_W, FRAME_H = 860, 560
local INNER_INSET = 30
local SIDEBAR_W = 194
local CONTENT_W = FRAME_W - (INNER_INSET * 2) - SIDEBAR_W
local PANEL_W = CONTENT_W - 52
local DASHBOARD_FRAME_STRATA = "DIALOG"
local DASHBOARD_FRAME_LEVEL = 100
local OVERVIEW_REFRESH_INTERVAL = 30
local SNAPSHOT_INTERVAL = 15 * 60
local TIMER_PROGRESS_WIDTH = 224

local COLORS = {
    canvas = { 0.018, 0.024, 0.033, 0.97 },
    sidebar = { 0.022, 0.029, 0.040, 0.98 },
    surface = { 0.043, 0.052, 0.067, 0.96 },
    surfaceRaised = { 0.058, 0.069, 0.087, 0.98 },
    surfaceHover = { 0.090, 0.105, 0.127, 0.98 },
    border = { 0.265, 0.302, 0.350, 0.52 },
    borderSoft = { 0.215, 0.245, 0.285, 0.34 },
    gold = { 1.000, 0.780, 0.240, 1.00 },
    goldMuted = { 0.710, 0.555, 0.230, 1.00 },
    text = { 0.930, 0.940, 0.950, 1.00 },
    muted = { 0.610, 0.650, 0.700, 1.00 },
    dim = { 0.405, 0.445, 0.500, 1.00 },
    green = { 0.340, 0.820, 0.535, 1.00 },
    blue = { 0.350, 0.660, 1.000, 1.00 },
    purple = { 0.720, 0.500, 1.000, 1.00 },
    red = { 0.950, 0.330, 0.310, 1.00 },
}

local timerLabel = nil
local timerProgress = nil
local refreshBtn = nil
local minimapToggle = nil
local playtimeSyncToggle = nil
local MainFrame = nil
local MinimapButton = nil
local dashboardTicker = nil
local lastOverviewRefreshAt = 0

local function SetTextureColor(texture, color, alpha)
    texture:SetColorTexture(color[1], color[2], color[3], alpha or color[4] or 1)
end

local function SetFontColor(fontString, color, alpha)
    fontString:SetTextColor(color[1], color[2], color[3], alpha or color[4] or 1)
end

local function RaiseDashboardFrame(frame)
    if not frame then return end

    frame:SetFrameStrata(DASHBOARD_FRAME_STRATA)
    frame:SetFrameLevel(DASHBOARD_FRAME_LEVEL)
    frame:Raise()
end

local function IsButtonEnabled(button)
    local enabled = button and button:IsEnabled()
    return enabled ~= false and enabled ~= nil and enabled ~= 0
end

-- ============================================================
-- Shared visual components
-- ============================================================

addon.gui = addon.gui or {}
local gui = addon.gui

gui.CreatePanelFill = function(parent, color, layer)
    local texture = parent:CreateTexture(nil, layer or "BACKGROUND")
    texture:SetAllPoints(parent)
    SetTextureColor(texture, color)
    return texture
end

gui.CreateLine = function(parent, color, layer)
    local texture = parent:CreateTexture(nil, layer or "BORDER")
    SetTextureColor(texture, color)
    return texture
end

gui.CreatePanel = function(parent, width, height, raised)
    local panel = CreateFrame("Frame", nil, parent)
    panel:SetSize(width, height)
    panel.background = gui.CreatePanelFill(panel, raised and COLORS.surfaceRaised or COLORS.surface)

    panel.borderTop = gui.CreateLine(panel, COLORS.border)
    panel.borderTop:SetHeight(1)
    panel.borderTop:SetPoint("TOPLEFT", panel, "TOPLEFT")
    panel.borderTop:SetPoint("TOPRIGHT", panel, "TOPRIGHT")

    panel.borderBottom = gui.CreateLine(panel, COLORS.borderSoft)
    panel.borderBottom:SetHeight(1)
    panel.borderBottom:SetPoint("BOTTOMLEFT", panel, "BOTTOMLEFT")
    panel.borderBottom:SetPoint("BOTTOMRIGHT", panel, "BOTTOMRIGHT")

    panel.borderLeft = gui.CreateLine(panel, COLORS.borderSoft)
    panel.borderLeft:SetWidth(1)
    panel.borderLeft:SetPoint("TOPLEFT", panel, "TOPLEFT")
    panel.borderLeft:SetPoint("BOTTOMLEFT", panel, "BOTTOMLEFT")

    panel.borderRight = gui.CreateLine(panel, COLORS.borderSoft)
    panel.borderRight:SetWidth(1)
    panel.borderRight:SetPoint("TOPRIGHT", panel, "TOPRIGHT")
    panel.borderRight:SetPoint("BOTTOMRIGHT", panel, "BOTTOMRIGHT")

    return panel
end

gui.CreateLabel = function(parent, text, size, color, font)
    local label = parent:CreateFontString(nil, "OVERLAY")
    label:SetFont(font or FONT_BOLD, size or 10, "")
    SetFontColor(label, color or COLORS.muted)
    label:SetText(text or "")
    return label
end

gui.CreateKicker = function(parent, text)
    local kicker = gui.CreateLabel(parent, text, 9, COLORS.goldMuted)
    return kicker
end

gui.CreateValueText = function(parent, size, color)
    return gui.CreateLabel(parent, "", size or 18, color or COLORS.text)
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

gui.FormatInteger = function(value)
    local formatted = tostring(math.floor(tonumber(value) or 0))
    local grouped = formatted:reverse():gsub("(%d%d%d)", "%1,"):reverse()
    local result = grouped:gsub("^,", "")
    return result
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

gui.CreatePrimaryButton = function(parent, width, height, text)
    local button = CreateFrame("Button", nil, parent)
    button:SetSize(width, height)
    button.hovered = false

    button.background = button:CreateTexture(nil, "BACKGROUND")
    button.background:SetAllPoints(button)
    button.shine = button:CreateTexture(nil, "ARTWORK")
    button.shine:SetHeight(1)
    button.shine:SetPoint("TOPLEFT", button, "TOPLEFT", 1, -1)
    button.shine:SetPoint("TOPRIGHT", button, "TOPRIGHT", -1, -1)
    button.borderBottom = button:CreateTexture(nil, "BORDER")
    button.borderBottom:SetHeight(1)
    button.borderBottom:SetPoint("BOTTOMLEFT", button, "BOTTOMLEFT")
    button.borderBottom:SetPoint("BOTTOMRIGHT", button, "BOTTOMRIGHT")

    button.label = gui.CreateLabel(button, text, 11, COLORS.canvas)
    button.label:SetPoint("CENTER", button, "CENTER")
    button:SetFontString(button.label)

    function button:RefreshVisual()
        if not IsButtonEnabled(self) then
            SetTextureColor(self.background, COLORS.dim, 0.55)
            SetTextureColor(self.shine, COLORS.muted, 0.22)
            SetTextureColor(self.borderBottom, COLORS.canvas, 0.65)
            SetFontColor(self.label, COLORS.muted)
        elseif self.hovered then
            self.background:SetColorTexture(1.000, 0.835, 0.335, 1)
            SetTextureColor(self.shine, COLORS.text, 0.55)
            SetTextureColor(self.borderBottom, COLORS.goldMuted, 0.90)
            SetFontColor(self.label, COLORS.canvas)
        else
            SetTextureColor(self.background, COLORS.gold)
            SetTextureColor(self.shine, COLORS.text, 0.35)
            SetTextureColor(self.borderBottom, COLORS.goldMuted)
            SetFontColor(self.label, COLORS.canvas)
        end
    end

    button:SetScript("OnEnter", function(self)
        self.hovered = true
        self:RefreshVisual()
    end)
    button:SetScript("OnLeave", function(self)
        self.hovered = false
        self:RefreshVisual()
    end)
    button:SetScript("OnMouseDown", function(self)
        if not IsButtonEnabled(self) then return end
        self.label:ClearAllPoints()
        self.label:SetPoint("CENTER", self, "CENTER", 0, -1)
    end)
    button:SetScript("OnMouseUp", function(self)
        self.label:ClearAllPoints()
        self.label:SetPoint("CENTER", self, "CENTER")
    end)
    button:SetScript("OnEnable", function(self) self:RefreshVisual() end)
    button:SetScript("OnDisable", function(self) self:RefreshVisual() end)
    button:RefreshVisual()
    return button
end

gui.CreateToggle = function(parent, width, labelText)
    local toggle = CreateFrame("CheckButton", nil, parent)
    toggle:SetSize(width, 24)
    toggle.hovered = false

    toggle.label = gui.CreateLabel(toggle, labelText, 10, COLORS.muted, FONT_BODY)
    toggle.label:SetPoint("LEFT", toggle, "LEFT", 0, 0)

    toggle.track = toggle:CreateTexture(nil, "ARTWORK")
    toggle.track:SetSize(32, 16)
    toggle.track:SetPoint("RIGHT", toggle, "RIGHT", 0, 0)

    toggle.knob = toggle:CreateTexture(nil, "OVERLAY")
    toggle.knob:SetSize(10, 10)

    function toggle:RefreshVisual()
        self.knob:ClearAllPoints()
        if self:GetChecked() then
            SetTextureColor(self.track, COLORS.gold, 0.90)
            SetTextureColor(self.knob, COLORS.canvas)
            self.knob:SetPoint("RIGHT", self.track, "RIGHT", -3, 0)
            SetFontColor(self.label, self.hovered and COLORS.text or COLORS.muted)
        else
            SetTextureColor(self.track, COLORS.dim, 0.48)
            SetTextureColor(self.knob, COLORS.muted)
            self.knob:SetPoint("LEFT", self.track, "LEFT", 3, 0)
            SetFontColor(self.label, self.hovered and COLORS.text or COLORS.muted)
        end
    end

    toggle:SetScript("OnEnter", function(self)
        self.hovered = true
        self:RefreshVisual()
    end)
    toggle:SetScript("OnLeave", function(self)
        self.hovered = false
        self:RefreshVisual()
    end)
    toggle:SetScript("OnClick", function(self)
        self:RefreshVisual()
        if self.onChanged then
            self.onChanged(self:GetChecked())
        end
    end)
    toggle:RefreshVisual()
    return toggle
end

local function CreateNavGlyph(button, kind)
    local glyph = CreateFrame("Frame", nil, button)
    glyph:SetSize(22, 22)
    glyph:SetPoint("LEFT", button, "LEFT", 12, 0)
    glyph.pieces = {}

    if kind == "overview" then
        local positions = {
            { "TOPLEFT", 2, -2 },
            { "TOPRIGHT", -2, -2 },
            { "BOTTOMLEFT", 2, 2 },
            { "BOTTOMRIGHT", -2, 2 },
        }
        for i, position in ipairs(positions) do
            local piece = glyph:CreateTexture(nil, "ARTWORK")
            piece:SetSize(7, 7)
            piece:SetPoint(position[1], glyph, position[1], position[2], position[3])
            glyph.pieces[i] = piece
        end
    else
        for i = 1, 3 do
            local piece = glyph:CreateTexture(nil, "ARTWORK")
            piece:SetSize(16, 3)
            piece:SetPoint("TOP", glyph, "TOP", 0, -(3 + ((i - 1) * 6)))
            glyph.pieces[i] = piece
        end
    end

    button.glyph = glyph
end

gui.CreateNavButton = function(parent, labelText, detailText, kind)
    local button = CreateFrame("Button", nil, parent)
    button:SetSize(154, 44)
    button.active = false
    button.hovered = false

    button.background = button:CreateTexture(nil, "BACKGROUND")
    button.background:SetAllPoints(button)
    button.marker = button:CreateTexture(nil, "BORDER")
    button.marker:SetWidth(3)
    button.marker:SetPoint("TOPLEFT", button, "TOPLEFT")
    button.marker:SetPoint("BOTTOMLEFT", button, "BOTTOMLEFT")
    CreateNavGlyph(button, kind)

    button.label = gui.CreateLabel(button, labelText, 11, COLORS.text)
    button.label:SetPoint("TOPLEFT", button, "TOPLEFT", 44, -8)
    button.detail = gui.CreateLabel(button, detailText, 9, COLORS.dim, FONT_BODY)
    button.detail:SetPoint("TOPLEFT", button.label, "BOTTOMLEFT", 0, -3)

    function button:RefreshVisual()
        if self.active then
            self.background:SetColorTexture(0.105, 0.118, 0.142, 0.98)
            SetTextureColor(self.marker, COLORS.gold)
            SetFontColor(self.label, COLORS.text)
            SetFontColor(self.detail, COLORS.muted)
        elseif self.hovered then
            self.background:SetColorTexture(0.072, 0.084, 0.103, 0.92)
            SetTextureColor(self.marker, COLORS.border, 0.60)
            SetFontColor(self.label, COLORS.text)
            SetFontColor(self.detail, COLORS.muted)
        else
            self.background:SetColorTexture(0, 0, 0, 0)
            self.marker:SetColorTexture(0, 0, 0, 0)
            SetFontColor(self.label, COLORS.muted)
            SetFontColor(self.detail, COLORS.dim)
        end

        for _, piece in ipairs(self.glyph.pieces) do
            if self.active then
                SetTextureColor(piece, COLORS.gold)
            elseif self.hovered then
                SetTextureColor(piece, COLORS.muted)
            else
                SetTextureColor(piece, COLORS.dim)
            end
        end
    end

    button:SetScript("OnEnter", function(self)
        self.hovered = true
        self:RefreshVisual()
    end)
    button:SetScript("OnLeave", function(self)
        self.hovered = false
        self:RefreshVisual()
    end)
    button:RefreshVisual()
    return button
end

gui.overviewWidgets = gui.overviewWidgets or {}
gui.metricCards = gui.metricCards or {}
local overviewWidgets = gui.overviewWidgets
local metricCards = gui.metricCards

gui.SetMetric = function(index, value, detail)
    local card = metricCards[index]
    if not card then return end
    card.value:SetText(value)
    card.detail:SetText(detail or "")
end

-- ============================================================
-- 1-second UI ticker
-- ============================================================

local function UpdateSnapshotTimer()
    if not timerLabel then return end

    if addon.IsSnapshotPending and addon.IsSnapshotPending() then
        timerLabel:SetText("Saving snapshot...")
        if timerProgress then
            timerProgress:SetWidth(TIMER_PROGRESS_WIDTH)
        end
        return
    end

    local now = GetTime()
    local nextSnapshotAt = addon.GetNextSnapshotAt and addon.GetNextSnapshotAt() or 0
    if nextSnapshotAt <= 0 then
        timerLabel:SetText("Waiting for login")
        if timerProgress then timerProgress:SetWidth(2) end
        return
    end

    local remaining = math.max(0, math.ceil(nextSnapshotAt - now))
    local mm = math.floor(remaining / 60)
    local ss = remaining % 60
    timerLabel:SetFormattedText("Next capture  %d:%02d", mm, ss)

    if timerProgress then
        local elapsedRatio = 1 - math.min(1, remaining / SNAPSHOT_INTERVAL)
        timerProgress:SetWidth(math.max(2, TIMER_PROGRESS_WIDTH * elapsedRatio))
    end
end

local function UpdateRefreshButton()
    if not refreshBtn then return end

    local now = GetTime()
    local isPending = addon.IsSnapshotPending and addon.IsSnapshotPending()
    local cooldownUntil = addon.GetRefreshCooldownUntil and addon.GetRefreshCooldownUntil() or 0
    if isPending then
        refreshBtn:SetText("Saving...")
        refreshBtn:Disable()
    elseif now < cooldownUntil then
        refreshBtn:SetText(string.format("Ready in %ds", math.ceil(cooldownUntil - now)))
        refreshBtn:Disable()
    else
        refreshBtn:SetText("Save Snapshot")
        if not IsButtonEnabled(refreshBtn) then
            refreshBtn:Enable()
        end
    end
end

local function OnSecondTick()
    UpdateSnapshotTimer()
    UpdateRefreshButton()

    local now = GetTime()
    if addon.RefreshOverviewPanel and (now - lastOverviewRefreshAt) >= OVERVIEW_REFRESH_INTERVAL then
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

-- ============================================================
-- Minimap button
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
        minimapToggle:RefreshVisual()
    end
end

function addon.RefreshSettingsControls()
    if minimapToggle then
        addon.EnsureMinimapSettings()
        minimapToggle:SetChecked(not WowDashboardDB.minimap.hide)
        minimapToggle:RefreshVisual()
    end

    if playtimeSyncToggle and addon.ShouldSyncPlaytimeOnLogin then
        playtimeSyncToggle:SetChecked(addon.ShouldSyncPlaytimeOnLogin())
        playtimeSyncToggle:RefreshVisual()
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

    local background = button:CreateTexture(nil, "BACKGROUND")
    background:SetSize(24, 24)
    background:SetTexture(136467)
    background:SetPoint("CENTER", button, "CENTER")

    local icon = button:CreateTexture(nil, "ARTWORK")
    icon:SetSize(19, 19)
    icon:SetTexture(MINIMAP_ICON)
    icon:SetTexCoord(0.06, 0.94, 0.06, 0.94)
    icon:SetPoint("CENTER", button, "CENTER")
    button.icon = icon

    local overlay = button:CreateTexture(nil, "OVERLAY")
    overlay:SetSize(50, 50)
    overlay:SetTexture(136430)
    overlay:SetPoint("CENTER", button, "CENTER", 0, 0)

    local highlight = button:CreateTexture(nil, "HIGHLIGHT")
    highlight:SetSize(25, 25)
    highlight:SetTexture(136477)
    highlight:SetPoint("CENTER", button, "CENTER")
    highlight:SetBlendMode("ADD")
    highlight:SetAlpha(0.65)

    local activityDot = button:CreateTexture(nil, "OVERLAY")
    activityDot:SetSize(5, 5)
    activityDot:SetPoint("BOTTOMRIGHT", button, "BOTTOMRIGHT", -2, 2)
    SetTextureColor(activityDot, COLORS.gold)

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
        self.icon:SetVertexColor(1, 0.90, 0.55)
        GameTooltip:SetOwner(self, "ANCHOR_LEFT")
        GameTooltip:SetText("WoW Dashboard", COLORS.gold[1], COLORS.gold[2], COLORS.gold[3])
        GameTooltip:AddLine("Character capture  •  v" .. ADDON_VERSION, 0.68, 0.72, 0.78)
        GameTooltip:AddLine(" ")
        GameTooltip:AddDoubleLine("Left click", "Open dashboard", 1, 1, 1, 0.68, 0.72, 0.78)
        GameTooltip:AddDoubleLine("Middle click", "Save snapshot", 1, 1, 1, 0.68, 0.72, 0.78)
        GameTooltip:AddDoubleLine("Right click", "Reload UI", 1, 1, 1, 0.68, 0.72, 0.78)
        GameTooltip:AddLine("Drag to reposition", 0.50, 0.54, 0.60)
        GameTooltip:Show()
    end)
    button:SetScript("OnLeave", function(self)
        self.icon:SetVertexColor(1, 1, 1)
        GameTooltip:Hide()
    end)
    button:SetScript("OnMouseDown", function(self)
        self.icon:ClearAllPoints()
        self.icon:SetPoint("CENTER", self, "CENTER", 0, -1)
    end)
    button:SetScript("OnMouseUp", function(self)
        self.icon:ClearAllPoints()
        self.icon:SetPoint("CENTER", self, "CENTER")
    end)
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
-- Dynamic overview state
-- ============================================================

addon.RefreshOverviewPanel = function()
    if not overviewWidgets.title or (MainFrame and not MainFrame:IsShown()) then
        return
    end
    lastOverviewRefreshAt = GetTime()

    local key, name, realm, entry = gui.GetCurrentDashboardEntry()
    local latest, snapshotCount = gui.GetLatestSnapshot(entry)
    local classColor = nil

    if name then
        local _, classTag = UnitClass("player")
        classColor = RAID_CLASS_COLORS and classTag and RAID_CLASS_COLORS[classTag] or nil
        overviewWidgets.title:SetText(name)
        overviewWidgets.meta:SetText((realm or "Unknown Realm") .. "  •  " .. addon.GetRegion():upper())
        if classColor then
            overviewWidgets.title:SetTextColor(classColor.r, classColor.g, classColor.b)
            overviewWidgets.heroAccent:SetColorTexture(classColor.r, classColor.g, classColor.b, 1)
        else
            SetFontColor(overviewWidgets.title, COLORS.gold)
            SetTextureColor(overviewWidgets.heroAccent, COLORS.gold)
        end
        if SetPortraitTexture then
            SetPortraitTexture(overviewWidgets.portrait, "player")
            overviewWidgets.portrait:SetTexCoord(0.08, 0.92, 0.08, 0.92)
        end
        overviewWidgets.statusLabel:SetText("CAPTURING")
        SetTextureColor(overviewWidgets.statusDot, COLORS.green)
        SetTextureColor(overviewWidgets.sidebarStatusDot, COLORS.green)
    else
        overviewWidgets.title:SetText("Character unavailable")
        overviewWidgets.meta:SetText("Enter the world to begin local capture")
        SetFontColor(overviewWidgets.title, COLORS.gold)
        SetTextureColor(overviewWidgets.heroAccent, COLORS.goldMuted)
        overviewWidgets.portrait:SetTexture(MINIMAP_ICON)
        overviewWidgets.portrait:SetTexCoord(0, 1, 0, 1)
        overviewWidgets.statusLabel:SetText("WAITING")
        SetTextureColor(overviewWidgets.statusDot, COLORS.goldMuted)
        SetTextureColor(overviewWidgets.sidebarStatusDot, COLORS.goldMuted)
    end

    if latest then
        local spec = type(latest.spec) == "string" and latest.spec or "Unknown spec"
        local role = type(latest.role) == "string" and latest.role or "dps"
        overviewWidgets.snapshotStatus:SetText("Saved " .. gui.FormatShortAge(latest.takenAt))
        overviewWidgets.snapshotDetail:SetText("Level " .. tostring(tonumber(latest.level) or UnitLevel("player") or 0)
            .. "  •  " .. spec .. "  •  " .. string.upper(role))
        gui.SetMetric(1, string.format("%.1f", tonumber(latest.itemLevel) or 0), "Equipped gear")
        gui.SetMetric(2, gui.FormatGoldAmount(latest.gold), "Character total")
        gui.SetMetric(3, gui.FormatInteger(latest.mythicPlusScore), "Season rating")
        gui.SetMetric(4, tostring(snapshotCount), "Local captures")
    else
        overviewWidgets.snapshotStatus:SetText("No snapshot yet")
        overviewWidgets.snapshotDetail:SetText("Save one now or wait for automatic capture")
        gui.SetMetric(1, "—", "Equipped gear")
        gui.SetMetric(2, "—", "Character total")
        gui.SetMetric(3, "—", "Season rating")
        gui.SetMetric(4, tostring(snapshotCount), "Local captures")
    end

    if overviewWidgets.sidebarStatus then
        local label = key and (tostring(snapshotCount) .. (snapshotCount == 1 and " capture" or " captures")) or "Waiting for player"
        overviewWidgets.sidebarStatus:SetText(label)
    end

    if overviewWidgets.scheduleDetail then
        if addon.IsSnapshotPending and addon.IsSnapshotPending() then
            overviewWidgets.scheduleDetail:SetText("Writing the current character state")
        elseif latest then
            overviewWidgets.scheduleDetail:SetText("Last saved  " .. date("%b %d  •  %H:%M", latest.takenAt))
        else
            overviewWidgets.scheduleDetail:SetText("Automatic capture begins after login")
        end
    end

    UpdateSnapshotTimer()
    UpdateRefreshButton()
end

-- ============================================================
-- Main dashboard
-- ============================================================

function addon.EnsureDashboardFrame()
    if MainFrame then return MainFrame end

    MainFrame = CreateFrame("Frame", "WowDashboardFrame", UIParent)
    MainFrame:SetSize(FRAME_W, FRAME_H)
    MainFrame:SetPoint("CENTER")
    RaiseDashboardFrame(MainFrame)
    MainFrame:SetMovable(true)
    MainFrame:EnableMouse(true)
    MainFrame:SetToplevel(true)
    MainFrame:RegisterForDrag("LeftButton")
    MainFrame:SetScript("OnDragStart", MainFrame.StartMoving)
    MainFrame:SetScript("OnDragStop", MainFrame.StopMovingOrSizing)
    MainFrame:SetClampedToScreen(true)
    MainFrame:Hide()

    table.insert(UISpecialFrames, "WowDashboardFrame")

    MainFrame:SetScript("OnShow", function(self)
        RaiseDashboardFrame(self)
        if UIFrameFadeIn then UIFrameFadeIn(self, 0.12, 0, 1) end
        if WowDashboardDB then WowDashboardDB.panelOpen = true end
        StartDashboardUiTicker()
        addon.RefreshSettingsControls()
        if self.RefreshVisibleTab then
            self:RefreshVisibleTab()
        elseif addon.RefreshOverviewPanel then
            addon.RefreshOverviewPanel()
        end
    end)

    MainFrame:SetScript("OnHide", function()
        if WowDashboardDB then WowDashboardDB.panelOpen = false end
        StopDashboardUiTicker()
    end)

    local shell = BuildSection(MainFrame, FRAME_W, FRAME_H, true)
    shell:SetPoint("TOPLEFT", MainFrame, "TOPLEFT")
    shell.NineSlice.Background:SetAtlas("thewarwithin-landingpage-background", false)
    shell.NineSlice.Background:SetVertexColor(0.24, 0.28, 0.36)
    shell.NineSlice.Background:SetAlpha(0.65)
    shell.NineSlice.CloseButton:SetScript("OnClick", function()
        addon.SetDashboardShown(false)
    end)

    local inner = CreateFrame("Frame", nil, shell)
    inner:SetPoint("TOPLEFT", shell, "TOPLEFT", INNER_INSET, -INNER_INSET)
    inner:SetPoint("BOTTOMRIGHT", shell, "BOTTOMRIGHT", -INNER_INSET, INNER_INSET)
    gui.CreatePanelFill(inner, COLORS.canvas)

    local sidebar = CreateFrame("Frame", nil, inner)
    sidebar:SetPoint("TOPLEFT", inner, "TOPLEFT")
    sidebar:SetPoint("BOTTOMLEFT", inner, "BOTTOMLEFT")
    sidebar:SetWidth(SIDEBAR_W)
    gui.CreatePanelFill(sidebar, COLORS.sidebar)

    local sidebarEdge = gui.CreateLine(sidebar, COLORS.border)
    sidebarEdge:SetWidth(1)
    sidebarEdge:SetPoint("TOPRIGHT", sidebar, "TOPRIGHT")
    sidebarEdge:SetPoint("BOTTOMRIGHT", sidebar, "BOTTOMRIGHT")
    local sidebarGlow = gui.CreateLine(sidebar, COLORS.gold, "ARTWORK")
    sidebarGlow:SetSize(1, 72)
    sidebarGlow:SetPoint("TOPRIGHT", sidebar, "TOPRIGHT", 0, -18)
    sidebarGlow:SetAlpha(0.34)

    local brandIconFrame = gui.CreatePanel(sidebar, 42, 42, true)
    brandIconFrame:SetPoint("TOPLEFT", sidebar, "TOPLEFT", 20, -18)
    local brandIcon = brandIconFrame:CreateTexture(nil, "ARTWORK")
    brandIcon:SetPoint("TOPLEFT", brandIconFrame, "TOPLEFT", 4, -4)
    brandIcon:SetPoint("BOTTOMRIGHT", brandIconFrame, "BOTTOMRIGHT", -4, 4)
    brandIcon:SetTexture(MINIMAP_ICON)

    local brandTitle = gui.CreateLabel(sidebar, "WoW Dashboard", 14, COLORS.text)
    brandTitle:SetPoint("TOPLEFT", brandIconFrame, "TOPRIGHT", 10, -5)
    local brandSub = gui.CreateKicker(sidebar, "CHARACTER DATA")
    brandSub:SetPoint("TOPLEFT", brandTitle, "BOTTOMLEFT", 0, -5)

    local brandRule = gui.CreateLine(sidebar, COLORS.borderSoft)
    brandRule:SetHeight(1)
    brandRule:SetPoint("TOPLEFT", sidebar, "TOPLEFT", 20, -76)
    brandRule:SetPoint("TOPRIGHT", sidebar, "TOPRIGHT", -20, -76)

    local navigationKicker = gui.CreateKicker(sidebar, "NAVIGATION")
    navigationKicker:SetPoint("TOPLEFT", sidebar, "TOPLEFT", 20, -98)

    local navOverview = gui.CreateNavButton(sidebar, "Overview", "Current character", "overview")
    navOverview:SetPoint("TOPLEFT", sidebar, "TOPLEFT", 20, -116)
    local navSnapshots = gui.CreateNavButton(sidebar, "Snapshots", "Capture history", "snapshots")
    navSnapshots:SetPoint("TOPLEFT", sidebar, "TOPLEFT", 20, -164)

    local captureCard = gui.CreatePanel(sidebar, 154, 62, false)
    captureCard:SetPoint("TOPLEFT", sidebar, "TOPLEFT", 20, -230)
    local captureKicker = gui.CreateKicker(captureCard, "LOCAL CAPTURE")
    captureKicker:SetPoint("TOPLEFT", captureCard, "TOPLEFT", 12, -11)
    overviewWidgets.sidebarStatusDot = captureCard:CreateTexture(nil, "ARTWORK")
    overviewWidgets.sidebarStatusDot:SetSize(6, 6)
    overviewWidgets.sidebarStatusDot:SetPoint("BOTTOMLEFT", captureCard, "BOTTOMLEFT", 12, 13)
    SetTextureColor(overviewWidgets.sidebarStatusDot, COLORS.goldMuted)
    overviewWidgets.sidebarStatus = gui.CreateLabel(captureCard, "Waiting for player", 10, COLORS.muted, FONT_BODY)
    overviewWidgets.sidebarStatus:SetPoint("LEFT", overviewWidgets.sidebarStatusDot, "RIGHT", 7, 0)

    local addonKicker = gui.CreateKicker(sidebar, "ADDON")
    addonKicker:SetPoint("BOTTOMLEFT", sidebar, "BOTTOMLEFT", 20, 118)

    local function CreateMetaRow(label, value, y)
        local keyText = gui.CreateLabel(sidebar, label, 9, COLORS.dim, FONT_BODY)
        keyText:SetPoint("BOTTOMLEFT", sidebar, "BOTTOMLEFT", 20, y)
        local valueText = gui.CreateLabel(sidebar, value, 9, COLORS.muted)
        valueText:SetPoint("BOTTOMRIGHT", sidebar, "BOTTOMRIGHT", -20, y)
    end
    CreateMetaRow("Version", ADDON_VERSION, 96)
    CreateMetaRow("Interface", ADDON_INTERFACE, 78)
    CreateMetaRow("Expansion", ADDON_EXPANSION, 60)

    local commandPill = CreateFrame("Frame", nil, sidebar)
    commandPill:SetSize(154, 28)
    commandPill:SetPoint("BOTTOMLEFT", sidebar, "BOTTOMLEFT", 20, 18)
    gui.CreatePanelFill(commandPill, COLORS.surface)
    local command = gui.CreateLabel(commandPill, "/wd", 10, COLORS.gold)
    command:SetPoint("LEFT", commandPill, "LEFT", 10, 0)
    local commandHint = gui.CreateLabel(commandPill, "toggle dashboard", 9, COLORS.dim, FONT_BODY)
    commandHint:SetPoint("RIGHT", commandPill, "RIGHT", -10, 0)

    local content = CreateFrame("Frame", nil, inner)
    content:SetPoint("TOPLEFT", sidebar, "TOPRIGHT")
    content:SetPoint("BOTTOMRIGHT", inner, "BOTTOMRIGHT")

    local headerKicker = gui.CreateKicker(content, "LOCAL CHARACTER DATA")
    headerKicker:SetPoint("TOPLEFT", content, "TOPLEFT", 26, -17)
    local pageTitle = gui.CreateLabel(content, "Character overview", 20, COLORS.text)
    pageTitle:SetPoint("TOPLEFT", content, "TOPLEFT", 26, -32)
    local pageSubtitle = gui.CreateLabel(content, "At-a-glance capture health and progression.", 10, COLORS.muted, FONT_BODY)
    pageSubtitle:SetPoint("TOPLEFT", pageTitle, "BOTTOMLEFT", 0, -5)

    local cadencePill = CreateFrame("Frame", nil, content)
    cadencePill:SetSize(124, 28)
    cadencePill:SetPoint("TOPRIGHT", content, "TOPRIGHT", -26, -24)
    gui.CreatePanelFill(cadencePill, COLORS.surfaceRaised)
    local cadenceDot = cadencePill:CreateTexture(nil, "ARTWORK")
    cadenceDot:SetSize(6, 6)
    cadenceDot:SetPoint("LEFT", cadencePill, "LEFT", 12, 0)
    SetTextureColor(cadenceDot, COLORS.green)
    local cadenceText = gui.CreateLabel(cadencePill, "AUTO  •  15 MIN", 9, COLORS.muted)
    cadenceText:SetPoint("LEFT", cadenceDot, "RIGHT", 7, 0)

    local headerRule = gui.CreateLine(content, COLORS.borderSoft)
    headerRule:SetHeight(1)
    headerRule:SetPoint("TOPLEFT", content, "TOPLEFT", 26, -82)
    headerRule:SetPoint("TOPRIGHT", content, "TOPRIGHT", -26, -82)
    local headerAccent = gui.CreateLine(content, COLORS.gold)
    headerAccent:SetSize(76, 1)
    headerAccent:SetPoint("TOPLEFT", headerRule, "TOPLEFT")
    headerAccent:SetAlpha(0.72)

    local overviewPanel = CreateFrame("Frame", nil, content)
    overviewPanel:SetPoint("TOPLEFT", content, "TOPLEFT", 26, -100)
    overviewPanel:SetPoint("BOTTOMRIGHT", content, "BOTTOMRIGHT", -26, 26)

    local snapshotsPanel = CreateFrame("Frame", nil, content)
    snapshotsPanel:SetPoint("TOPLEFT", content, "TOPLEFT", 26, -100)
    snapshotsPanel:SetPoint("BOTTOMRIGHT", content, "BOTTOMRIGHT", -26, 26)
    snapshotsPanel:Hide()

    -- Overview: character hero
    local hero = gui.CreatePanel(overviewPanel, PANEL_W, 96, true)
    hero:SetPoint("TOPLEFT", overviewPanel, "TOPLEFT")
    overviewWidgets.heroAccent = hero:CreateTexture(nil, "ARTWORK")
    overviewWidgets.heroAccent:SetWidth(3)
    overviewWidgets.heroAccent:SetPoint("TOPLEFT", hero, "TOPLEFT")
    overviewWidgets.heroAccent:SetPoint("BOTTOMLEFT", hero, "BOTTOMLEFT")
    SetTextureColor(overviewWidgets.heroAccent, COLORS.goldMuted)

    local portraitFrame = gui.CreatePanel(hero, 60, 60, false)
    portraitFrame:SetPoint("LEFT", hero, "LEFT", 17, 0)
    overviewWidgets.portrait = portraitFrame:CreateTexture(nil, "ARTWORK")
    overviewWidgets.portrait:SetPoint("TOPLEFT", portraitFrame, "TOPLEFT", 3, -3)
    overviewWidgets.portrait:SetPoint("BOTTOMRIGHT", portraitFrame, "BOTTOMRIGHT", -3, 3)
    overviewWidgets.portrait:SetTexture(MINIMAP_ICON)

    overviewWidgets.title = gui.CreateValueText(hero, 23, COLORS.gold)
    overviewWidgets.title:SetPoint("TOPLEFT", hero, "TOPLEFT", 92, -19)
    overviewWidgets.title:SetWidth(240)
    overviewWidgets.title:SetJustifyH("LEFT")
    overviewWidgets.title:SetText("Character unavailable")
    overviewWidgets.meta = gui.CreateLabel(hero, "Enter the world to begin local capture", 10, COLORS.muted, FONT_BODY)
    overviewWidgets.meta:SetPoint("TOPLEFT", overviewWidgets.title, "BOTTOMLEFT", 1, -5)

    overviewWidgets.statusDot = hero:CreateTexture(nil, "ARTWORK")
    overviewWidgets.statusDot:SetSize(6, 6)
    overviewWidgets.statusDot:SetPoint("TOPRIGHT", hero, "TOPRIGHT", -108, -21)
    SetTextureColor(overviewWidgets.statusDot, COLORS.goldMuted)
    overviewWidgets.statusLabel = gui.CreateKicker(hero, "WAITING")
    overviewWidgets.statusLabel:SetPoint("LEFT", overviewWidgets.statusDot, "RIGHT", 7, 0)
    overviewWidgets.snapshotStatus = gui.CreateValueText(hero, 13, COLORS.text)
    overviewWidgets.snapshotStatus:SetPoint("TOPRIGHT", hero, "TOPRIGHT", -17, -42)
    overviewWidgets.snapshotStatus:SetJustifyH("RIGHT")
    overviewWidgets.snapshotStatus:SetText("No snapshot yet")
    overviewWidgets.snapshotDetail = gui.CreateLabel(hero, "Save one now or wait for automatic capture", 9, COLORS.muted, FONT_BODY)
    overviewWidgets.snapshotDetail:SetPoint("TOPRIGHT", overviewWidgets.snapshotStatus, "BOTTOMRIGHT", 0, -6)
    overviewWidgets.snapshotDetail:SetJustifyH("RIGHT")

    -- Overview: metric cards
    local metricLabels = { "ITEM LEVEL", "GOLD", "MYTHIC+", "SNAPSHOTS" }
    local metricColors = { COLORS.blue, COLORS.gold, COLORS.purple, COLORS.green }
    local metricWidth = 134
    local metricGap = 6
    for index, labelText in ipairs(metricLabels) do
        local card = gui.CreatePanel(overviewPanel, metricWidth, 82, false)
        card:SetPoint("TOPLEFT", overviewPanel, "TOPLEFT", (index - 1) * (metricWidth + metricGap), -106)
        card.accent = card:CreateTexture(nil, "ARTWORK")
        card.accent:SetHeight(2)
        card.accent:SetPoint("TOPLEFT", card, "TOPLEFT", 1, -1)
        card.accent:SetPoint("TOPRIGHT", card, "TOPRIGHT", -1, -1)
        SetTextureColor(card.accent, metricColors[index], 0.82)
        card.label = gui.CreateKicker(card, labelText)
        card.label:SetPoint("TOPLEFT", card, "TOPLEFT", 12, -12)
        card.value = gui.CreateValueText(card, 21, COLORS.text)
        card.value:SetPoint("TOPLEFT", card, "TOPLEFT", 12, -30)
        card.value:SetText("—")
        card.detail = gui.CreateLabel(card, "", 9, COLORS.dim, FONT_BODY)
        card.detail:SetPoint("BOTTOMLEFT", card, "BOTTOMLEFT", 12, 9)
        metricCards[index] = card
    end

    -- Overview: schedule and controls
    local scheduleCard = gui.CreatePanel(overviewPanel, 252, 150, false)
    scheduleCard:SetPoint("TOPLEFT", overviewPanel, "TOPLEFT", 0, -198)
    local scheduleKicker = gui.CreateKicker(scheduleCard, "CAPTURE SCHEDULE")
    scheduleKicker:SetPoint("TOPLEFT", scheduleCard, "TOPLEFT", 14, -14)
    timerLabel = gui.CreateValueText(scheduleCard, 17, COLORS.text)
    timerLabel:SetPoint("TOPLEFT", scheduleCard, "TOPLEFT", 14, -38)
    timerLabel:SetText("Waiting for login")
    overviewWidgets.scheduleDetail = gui.CreateLabel(scheduleCard, "Automatic capture begins after login", 9, COLORS.muted, FONT_BODY)
    overviewWidgets.scheduleDetail:SetPoint("TOPLEFT", scheduleCard, "TOPLEFT", 14, -66)

    local progressTrack = scheduleCard:CreateTexture(nil, "BACKGROUND")
    progressTrack:SetSize(TIMER_PROGRESS_WIDTH, 5)
    progressTrack:SetPoint("BOTTOMLEFT", scheduleCard, "BOTTOMLEFT", 14, 30)
    SetTextureColor(progressTrack, COLORS.dim, 0.35)
    timerProgress = scheduleCard:CreateTexture(nil, "ARTWORK")
    timerProgress:SetSize(2, 5)
    timerProgress:SetPoint("LEFT", progressTrack, "LEFT")
    SetTextureColor(timerProgress, COLORS.gold)
    local scheduleFoot = gui.CreateLabel(scheduleCard, "Automatic  •  every 15 minutes", 9, COLORS.dim, FONT_BODY)
    scheduleFoot:SetPoint("BOTTOMLEFT", scheduleCard, "BOTTOMLEFT", 14, 12)

    local actionCard = gui.CreatePanel(overviewPanel, 294, 150, false)
    actionCard:SetPoint("TOPRIGHT", overviewPanel, "TOPRIGHT", 0, -198)
    local actionKicker = gui.CreateKicker(actionCard, "QUICK ACTIONS")
    actionKicker:SetPoint("TOPLEFT", actionCard, "TOPLEFT", 14, -14)

    refreshBtn = gui.CreatePrimaryButton(actionCard, 266, 36, "Save Snapshot")
    refreshBtn:SetPoint("TOPLEFT", actionCard, "TOPLEFT", 14, -34)
    refreshBtn:SetScript("OnClick", function()
        if GetTime() < (addon.GetRefreshCooldownUntil and addon.GetRefreshCooldownUntil() or 0) then return end
        if addon.SetRefreshCooldownUntil then addon.SetRefreshCooldownUntil(GetTime() + 15) end
        addon.RequestFreshSnapshot()
        UpdateRefreshButton()
    end)

    minimapToggle = gui.CreateToggle(actionCard, 266, "Show minimap button")
    minimapToggle:SetPoint("TOPLEFT", actionCard, "TOPLEFT", 14, -78)
    minimapToggle.onChanged = function(checked)
        if not WowDashboardDB or not WowDashboardDB.minimap then return end
        WowDashboardDB.minimap.hide = not checked
        addon.RefreshMinimapButton()
    end

    playtimeSyncToggle = gui.CreateToggle(actionCard, 266, "Sync playtime on login")
    playtimeSyncToggle:SetPoint("TOPLEFT", actionCard, "TOPLEFT", 14, -108)
    playtimeSyncToggle.onChanged = function(checked)
        if addon.SetSyncPlaytimeOnLogin then
            addon.SetSyncPlaytimeOnLogin(checked)
        end
    end

    -- Snapshots: summary
    local historySummary = gui.CreatePanel(snapshotsPanel, PANEL_W, 64, true)
    historySummary:SetPoint("TOPLEFT", snapshotsPanel, "TOPLEFT")
    local historyKicker = gui.CreateKicker(historySummary, "CAPTURE ARCHIVE")
    historyKicker:SetPoint("TOPLEFT", historySummary, "TOPLEFT", 14, -12)
    local historyCount = gui.CreateValueText(historySummary, 18, COLORS.text)
    historyCount:SetPoint("TOPLEFT", historySummary, "TOPLEFT", 14, -29)
    historyCount:SetText("0 local snapshots")
    local historyDetail = gui.CreateLabel(historySummary, "Newest captures first", 9, COLORS.muted, FONT_BODY)
    historyDetail:SetPoint("BOTTOMRIGHT", historySummary, "BOTTOMRIGHT", -14, 13)
    local localOnly = gui.CreateKicker(historySummary, "LOCAL ONLY")
    localOnly:SetPoint("TOPRIGHT", historySummary, "TOPRIGHT", -14, -13)

    local tableHeader = CreateFrame("Frame", nil, snapshotsPanel)
    tableHeader:SetSize(PANEL_W, 28)
    tableHeader:SetPoint("TOPLEFT", snapshotsPanel, "TOPLEFT", 0, -74)
    gui.CreatePanelFill(tableHeader, COLORS.surface)
    local tableHeaderLine = gui.CreateLine(tableHeader, COLORS.borderSoft)
    tableHeaderLine:SetHeight(1)
    tableHeaderLine:SetPoint("BOTTOMLEFT", tableHeader, "BOTTOMLEFT")
    tableHeaderLine:SetPoint("BOTTOMRIGHT", tableHeader, "BOTTOMRIGHT")

    local columns = {
        { label = "CHARACTER", x = 12, width = 166, justify = "LEFT" },
        { label = "CAPTURED", x = 184, width = 96, justify = "LEFT" },
        { label = "LVL", x = 286, width = 36, justify = "CENTER" },
        { label = "ITEM LVL", x = 328, width = 58, justify = "CENTER" },
        { label = "GOLD", x = 394, width = 74, justify = "RIGHT" },
        { label = "M+", x = 486, width = 52, justify = "RIGHT" },
    }

    for _, column in ipairs(columns) do
        local label = gui.CreateKicker(tableHeader, column.label)
        label:SetWidth(column.width)
        label:SetJustifyH(column.justify)
        label:SetPoint("LEFT", tableHeader, "LEFT", column.x, 0)
    end

    local scrollFrame = CreateFrame("ScrollFrame", nil, snapshotsPanel)
    scrollFrame:SetPoint("TOPLEFT", snapshotsPanel, "TOPLEFT", 0, -108)
    scrollFrame:SetPoint("BOTTOMRIGHT", snapshotsPanel, "BOTTOMRIGHT", -10, 0)
    scrollFrame:EnableMouseWheel(true)

    local scrollChild = CreateFrame("Frame", nil, scrollFrame)
    scrollChild:SetWidth(PANEL_W - 10)
    scrollChild:SetHeight(1)
    scrollFrame:SetScrollChild(scrollChild)

    local scrollTrack = CreateFrame("Frame", nil, snapshotsPanel)
    scrollTrack:SetWidth(10)
    scrollTrack:SetPoint("TOPRIGHT", snapshotsPanel, "TOPRIGHT", 0, -108)
    scrollTrack:SetPoint("BOTTOMRIGHT", snapshotsPanel, "BOTTOMRIGHT")
    scrollTrack:EnableMouse(true)
    scrollTrack:RegisterForDrag("LeftButton")
    local scrollRail = scrollTrack:CreateTexture(nil, "BACKGROUND")
    scrollRail:SetWidth(3)
    scrollRail:SetPoint("TOP", scrollTrack, "TOP")
    scrollRail:SetPoint("BOTTOM", scrollTrack, "BOTTOM")
    SetTextureColor(scrollRail, COLORS.surface)
    local scrollThumb = scrollTrack:CreateTexture(nil, "ARTWORK")
    scrollThumb:SetWidth(5)
    scrollThumb:SetPoint("TOP", scrollTrack, "TOP")
    SetTextureColor(scrollThumb, COLORS.goldMuted, 0.85)

    local function UpdateScrollThumb()
        local trackHeight = scrollTrack:GetHeight()
        if trackHeight <= 0 then return end

        local scrollRange = scrollFrame:GetVerticalScrollRange()
        if scrollRange <= 0 then
            scrollThumb:SetShown(false)
            return
        end

        local childHeight = math.max(scrollChild:GetHeight(), 1)
        local thumbHeight = math.max(28, trackHeight * math.min(1, scrollFrame:GetHeight() / childHeight))
        local maxOffset = math.max(0, trackHeight - thumbHeight)
        local offset = maxOffset * (scrollFrame:GetVerticalScroll() / scrollRange)
        scrollThumb:SetShown(true)
        scrollThumb:SetHeight(thumbHeight)
        scrollThumb:ClearAllPoints()
        scrollThumb:SetPoint("TOP", scrollTrack, "TOP", 0, -offset)
    end

    local function ScrollTrackToCursor()
        local trackTop = scrollTrack:GetTop()
        local trackHeight = scrollTrack:GetHeight()
        local scrollRange = scrollFrame:GetVerticalScrollRange()
        if not trackTop or trackHeight <= 0 or scrollRange <= 0 then return end

        local _, cursorY = GetCursorPosition()
        cursorY = cursorY / scrollTrack:GetEffectiveScale()
        local thumbHeight = scrollThumb:GetHeight()
        local travel = math.max(1, trackHeight - thumbHeight)
        local offset = math.min(math.max((trackTop - cursorY) - (thumbHeight / 2), 0), travel)
        scrollFrame:SetVerticalScroll(scrollRange * (offset / travel))
        UpdateScrollThumb()
    end

    scrollFrame:SetScript("OnMouseWheel", function(self, delta)
        local current = self:GetVerticalScroll()
        local maximum = self:GetVerticalScrollRange()
        self:SetVerticalScroll(math.min(math.max(current - (delta * 46), 0), maximum))
        UpdateScrollThumb()
    end)
    scrollFrame:SetScript("OnVerticalScroll", UpdateScrollThumb)
    scrollTrack:SetScript("OnMouseDown", ScrollTrackToCursor)
    scrollTrack:SetScript("OnMouseUp", function(self)
        self:SetScript("OnUpdate", nil)
    end)
    scrollTrack:SetScript("OnDragStart", function(self)
        self:SetScript("OnUpdate", ScrollTrackToCursor)
        ScrollTrackToCursor()
    end)
    scrollTrack:SetScript("OnDragStop", function(self)
        self:SetScript("OnUpdate", nil)
        ScrollTrackToCursor()
    end)

    local emptyState = CreateFrame("Frame", nil, snapshotsPanel)
    emptyState:SetSize(290, 112)
    emptyState:SetPoint("CENTER", snapshotsPanel, "CENTER", 0, -18)
    local emptyIcon = emptyState:CreateTexture(nil, "ARTWORK")
    emptyIcon:SetSize(38, 38)
    emptyIcon:SetPoint("TOP", emptyState, "TOP")
    emptyIcon:SetTexture(MINIMAP_ICON)
    emptyIcon:SetAlpha(0.48)
    local emptyTitle = gui.CreateLabel(emptyState, "No snapshots captured yet", 13, COLORS.muted)
    emptyTitle:SetPoint("TOP", emptyIcon, "BOTTOM", 0, -10)
    local emptyDetail = gui.CreateLabel(emptyState, "Save a snapshot from Overview to start your local history.", 10, COLORS.dim, FONT_BODY)
    emptyDetail:SetWidth(290)
    emptyDetail:SetJustifyH("CENTER")
    emptyDetail:SetPoint("TOP", emptyTitle, "BOTTOM", 0, -7)

    local rowPool = {}
    local rowCount = 0
    local LOG_ROW_H = 36
    local LOG_ROW_GAP = 2
    local ROW_W = PANEL_W - 10

    local function GetRow(index)
        if rowPool[index] then return rowPool[index] end

        local row = CreateFrame("Frame", nil, scrollChild)
        row:SetSize(ROW_W, LOG_ROW_H)
        row:SetPoint("TOPLEFT", scrollChild, "TOPLEFT", 0, -((index - 1) * (LOG_ROW_H + LOG_ROW_GAP)))
        row:EnableMouse(true)

        row.background = row:CreateTexture(nil, "BACKGROUND")
        row.background:SetAllPoints(row)
        if index % 2 == 0 then
            row.background:SetColorTexture(0.050, 0.060, 0.076, 0.78)
        else
            row.background:SetColorTexture(0.035, 0.043, 0.056, 0.72)
        end
        row.hover = row:CreateTexture(nil, "ARTWORK")
        row.hover:SetAllPoints(row)
        SetTextureColor(row.hover, COLORS.blue, 0.09)
        row.hover:Hide()
        row.accent = row:CreateTexture(nil, "BORDER")
        row.accent:SetWidth(2)
        row.accent:SetPoint("TOPLEFT", row, "TOPLEFT")
        row.accent:SetPoint("BOTTOMLEFT", row, "BOTTOMLEFT")
        SetTextureColor(row.accent, COLORS.goldMuted, 0.70)

        row.charText = gui.CreateLabel(row, "", 10, COLORS.text)
        row.charText:SetWidth(156)
        row.charText:SetJustifyH("LEFT")
        row.charText:SetPoint("TOPLEFT", row, "TOPLEFT", 12, -6)
        row.realmText = gui.CreateLabel(row, "", 9, COLORS.dim, FONT_BODY)
        row.realmText:SetWidth(156)
        row.realmText:SetJustifyH("LEFT")
        row.realmText:SetPoint("BOTTOMLEFT", row, "BOTTOMLEFT", 12, 5)

        row.timeText = gui.CreateLabel(row, "", 10, COLORS.muted, FONT_BODY)
        row.timeText:SetWidth(96)
        row.timeText:SetJustifyH("LEFT")
        row.timeText:SetPoint("LEFT", row, "LEFT", 184, 0)
        row.levelText = gui.CreateLabel(row, "", 10, COLORS.muted)
        row.levelText:SetWidth(36)
        row.levelText:SetJustifyH("CENTER")
        row.levelText:SetPoint("LEFT", row, "LEFT", 286, 0)
        row.itemLevelText = gui.CreateLabel(row, "", 10, COLORS.text)
        row.itemLevelText:SetWidth(58)
        row.itemLevelText:SetJustifyH("CENTER")
        row.itemLevelText:SetPoint("LEFT", row, "LEFT", 328, 0)
        row.goldText = gui.CreateLabel(row, "", 10, COLORS.goldMuted)
        row.goldText:SetWidth(74)
        row.goldText:SetJustifyH("RIGHT")
        row.goldText:SetPoint("LEFT", row, "LEFT", 394, 0)
        row.mplusText = gui.CreateLabel(row, "", 10, COLORS.muted)
        row.mplusText:SetWidth(52)
        row.mplusText:SetJustifyH("RIGHT")
        row.mplusText:SetPoint("LEFT", row, "LEFT", 486, 0)

        row:SetScript("OnEnter", function(self)
            self.hover:Show()
            local data = self.snapshotEntry
            if not data then return end
            local snap = data.snap
            GameTooltip:SetOwner(self, "ANCHOR_LEFT")
            GameTooltip:SetText((data.name or data.key) .. " — " .. (data.realm or "Unknown Realm"), 1, 1, 1)
            GameTooltip:AddLine(date("%A, %B %d at %H:%M", snap.takenAt), 0.62, 0.66, 0.72)
            GameTooltip:AddLine(" ")
            GameTooltip:AddDoubleLine("Level", tostring(tonumber(snap.level) or 0), 0.68, 0.72, 0.78, 1, 1, 1)
            GameTooltip:AddDoubleLine("Item level", string.format("%.1f", tonumber(snap.itemLevel) or 0), 0.68, 0.72, 0.78, 1, 1, 1)
            GameTooltip:AddDoubleLine("Gold", gui.FormatGoldAmount(snap.gold), 0.68, 0.72, 0.78, 1, 0.78, 0.24)
            GameTooltip:AddDoubleLine("Mythic+ rating", gui.FormatInteger(snap.mythicPlusScore), 0.68, 0.72, 0.78, 0.72, 0.50, 1)
            if type(snap.spec) == "string" then
                GameTooltip:AddDoubleLine("Specialization", snap.spec, 0.68, 0.72, 0.78, 1, 1, 1)
            end
            GameTooltip:Show()
        end)
        row:SetScript("OnLeave", function(self)
            self.hover:Hide()
            GameTooltip:Hide()
        end)

        rowPool[index] = row
        return row
    end

    local currentTab = "overview"

    local function UpdateTabVisuals()
        navOverview.active = currentTab == "overview"
        navSnapshots.active = currentTab == "snapshots"
        navOverview:RefreshVisual()
        navSnapshots:RefreshVisual()
    end

    local function SelectTab(which)
        currentTab = which
        overviewPanel:SetShown(which == "overview")
        snapshotsPanel:SetShown(which == "snapshots")
        if which == "overview" then
            pageTitle:SetText("Character overview")
            pageSubtitle:SetText("At-a-glance capture health and progression.")
            if addon.RefreshOverviewPanel then addon.RefreshOverviewPanel() end
        else
            pageTitle:SetText("Snapshot history")
            pageSubtitle:SetText("Browse recent local captures across your characters.")
            if addon.RefreshLog then addon.RefreshLog(true) end
        end
        UpdateTabVisuals()
    end

    navOverview:SetScript("OnClick", function() SelectTab("overview") end)
    navSnapshots:SetScript("OnClick", function() SelectTab("snapshots") end)

    addon.RefreshLog = function(force)
        if not force and (currentTab ~= "snapshots" or not MainFrame:IsShown()) then return end
        if not WowDashboardDB or not WowDashboardDB.characters then return end

        local all = {}
        local cursors = {}
        local totalSnapshots = 0
        for key, charData in pairs(WowDashboardDB.characters) do
            local snapshots = type(charData) == "table" and charData.snapshots or nil
            if type(snapshots) == "table" and #snapshots > 0 then
                totalSnapshots = totalSnapshots + #snapshots
                cursors[#cursors + 1] = {
                    key = key,
                    name = charData.name,
                    realm = charData.realm,
                    classTag = charData.class,
                    snapshots = snapshots,
                    index = #snapshots,
                }
            end
        end

        while #all < MAX_LOG_ENTRIES do
            local bestCursor = nil
            local bestSnapshot = nil
            local bestTakenAt = nil

            for _, cursor in ipairs(cursors) do
                while cursor.index > 0 do
                    local candidate = cursor.snapshots[cursor.index]
                    if type(candidate) == "table" and type(candidate.takenAt) == "number" then break end
                    cursor.index = cursor.index - 1
                end

                if cursor.index > 0 then
                    local candidate = cursor.snapshots[cursor.index]
                    if bestTakenAt == nil or candidate.takenAt > bestTakenAt then
                        bestTakenAt = candidate.takenAt
                        bestSnapshot = candidate
                        bestCursor = cursor
                    end
                end
            end

            if bestCursor == nil then break end
            all[#all + 1] = {
                key = bestCursor.key,
                name = bestCursor.name,
                realm = bestCursor.realm,
                classTag = bestCursor.classTag,
                snap = bestSnapshot,
            }
            bestCursor.index = bestCursor.index - 1
        end

        local visibleCount = #all
        for index = visibleCount + 1, rowCount do
            rowPool[index]:Hide()
        end
        rowCount = visibleCount

        for index, entry in ipairs(all) do
            local row = GetRow(index)
            local snap = entry.snap
            local name = entry.name
            local realm = entry.realm
            if type(name) ~= "string" or name == "" then
                name, realm = entry.key:match("^([^%-]+)%-(.+)$")
            end
            name = name or entry.key
            realm = realm or "Unknown Realm"

            entry.name = name
            entry.realm = realm
            row.snapshotEntry = entry
            row.charText:SetText(name)
            row.realmText:SetText(realm)
            row.timeText:SetText(date("%b %d  %H:%M", snap.takenAt))
            row.levelText:SetText(tostring(tonumber(snap.level) or 0))
            row.itemLevelText:SetText(string.format("%.1f", tonumber(snap.itemLevel) or 0))
            row.goldText:SetText(gui.FormatGoldAmount(snap.gold))
            row.mplusText:SetText(gui.FormatInteger(snap.mythicPlusScore))

            local classColor = RAID_CLASS_COLORS and entry.classTag and RAID_CLASS_COLORS[entry.classTag] or nil
            if classColor then
                row.charText:SetTextColor(classColor.r, classColor.g, classColor.b)
                row.accent:SetColorTexture(classColor.r, classColor.g, classColor.b, 0.82)
            else
                SetFontColor(row.charText, COLORS.text)
                SetTextureColor(row.accent, COLORS.goldMuted, 0.70)
            end
            row:Show()
        end

        historyCount:SetText(tostring(totalSnapshots) .. (totalSnapshots == 1 and " local snapshot" or " local snapshots"))
        if totalSnapshots > MAX_LOG_ENTRIES then
            historyDetail:SetText("Showing the newest " .. tostring(MAX_LOG_ENTRIES))
        else
            historyDetail:SetText("Newest captures first")
        end
        emptyState:SetShown(visibleCount == 0)
        tableHeader:SetShown(visibleCount > 0)
        scrollTrack:SetShown(visibleCount > 0)
        scrollChild:SetHeight(math.max(visibleCount * (LOG_ROW_H + LOG_ROW_GAP) - LOG_ROW_GAP, 1))
        scrollFrame:SetVerticalScroll(math.min(scrollFrame:GetVerticalScroll(), scrollFrame:GetVerticalScrollRange()))
        UpdateScrollThumb()
        if C_Timer and C_Timer.After then C_Timer.After(0, UpdateScrollThumb) end
    end

    function MainFrame:RefreshVisibleTab()
        if currentTab == "snapshots" then
            addon.RefreshLog(true)
        else
            addon.RefreshOverviewPanel()
        end
    end

    UpdateTabVisuals()
    addon.RefreshSettingsControls()
    return MainFrame
end

function addon.SetDashboardShown(shown)
    if not shown and not MainFrame then return end
    local frame = addon.EnsureDashboardFrame()
    if shown then RaiseDashboardFrame(frame) end
    frame:SetShown(shown)
end

function addon.ToggleDashboard()
    local frame = addon.EnsureDashboardFrame()
    local shown = not frame:IsShown()
    if shown then RaiseDashboardFrame(frame) end
    frame:SetShown(shown)
end
