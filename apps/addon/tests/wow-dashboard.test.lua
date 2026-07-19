local function trim(value)
    return tostring(value):match("^%s*(.-)%s*$")
end

strtrim = trim
issecretvalue = function()
    return false
end

local fixedNow = os.time({
    year = 2026,
    month = 7,
    day = 19,
    hour = 12,
    min = 0,
    sec = 0,
})
local monotonicNow = 5000

time = function(value)
    if value ~= nil then
        return os.time(value)
    end
    return fixedNow
end
date = os.date
difftime = os.difftime
GetTime = function()
    return monotonicNow
end

C_AddOns = {
    GetAddOnMetadata = function(_, fieldName)
        local values = {
            Version = "test",
            Interface = "120007",
            ["X-Expansion"] = "Midnight",
        }
        return values[fieldName]
    end,
}

local eventHandler = nil
CreateFrame = function()
    return {
        RegisterEvent = function() end,
        SetScript = function(_, scriptName, handler)
            if scriptName == "OnEvent" then
                eventHandler = handler
            end
        end,
    }
end
SlashCmdList = {}
C_Timer = {
    After = function() end,
    NewTicker = function()
        return { Cancel = function() end }
    end,
}

UnitFullName = function()
    return "Tester", "TestRealm"
end
GetRealmName = function()
    return "TestRealm"
end

local currentRegion = 3
GetCurrentRegion = function()
    return currentRegion
end
GetLocale = function()
    return "enGB"
end

C_DateAndTime = {
    GetCurrentCalendarTime = function()
        return {
            year = 2026,
            month = 7,
            monthDay = 19,
            hour = 12,
            minute = 0,
        }
    end,
}

local requestMapInfoCalls = 0
local runHistoryCalls = {}
C_MythicPlus = {
    RequestMapInfo = function()
        requestMapInfoCalls = requestMapInfoCalls + 1
    end,
    GetCurrentSeason = function()
        return 17
    end,
    GetRunHistory = function(...)
        runHistoryCalls[#runHistoryCalls + 1] = { ... }
        return {}
    end,
}

C_ChallengeMode = {
    GetMapUIInfo = function(mapID)
        return "Map " .. tostring(mapID)
    end,
    GetStartTime = function()
        return 4400
    end,
    GetChallengeCompletionInfo = function()
        return {
            mapChallengeModeID = 503,
            level = 12,
            time = 1234567,
            onTime = true,
            keystoneUpgradeLevels = 2,
            members = {},
        }
    end,
}

local addon = {}
local chunk, loadError = loadfile("wow-dashboard.lua")
assert(chunk, loadError)
chunk("wow-dashboard", addon)
assert(type(eventHandler) == "function", "addon event handler was not registered")

local hooks = assert(addon.testHooks, "addon test hooks are unavailable")

local function assertEqual(actual, expected, message)
    if actual ~= expected then
        error((message or "values differ")
            .. ": expected " .. tostring(expected)
            .. ", received " .. tostring(actual), 2)
    end
end

local function assertNear(actual, expected, tolerance, message)
    if type(actual) ~= "number" or math.abs(actual - expected) > tolerance then
        error((message or "values are not close")
            .. ": expected " .. tostring(expected)
            .. " +/- " .. tostring(tolerance)
            .. ", received " .. tostring(actual), 2)
    end
end

addon.cachedRegion = nil
assertEqual(addon.GetRegion(), "eu", "EU region mapping")
currentRegion = 2
addon.cachedRegion = nil
assertEqual(addon.GetRegion(), "kr", "KR region mapping")
currentRegion = 4
addon.cachedRegion = nil
assertEqual(addon.GetRegion(), "tw", "TW region mapping")

local completionCalendar = {
    year = 2026,
    month = 7,
    monthDay = 19,
    hour = 11,
    minute = 30,
}
local normalizedCompletionDate = hooks.NormalizeMythicPlusDate(completionCalendar)
assertNear(normalizedCompletionDate, fixedNow - 30 * 60, 1, "CalendarTime conversion")

local completedRun = hooks.NormalizeMythicPlusRun({
    mapChallengeModeID = 503,
    level = 10,
    thisWeek = true,
    completed = true,
    runScore = 215.5,
    durationSec = 600,
    completionDate = completionCalendar,
    season = 17,
}, 99)
assertEqual(completedRun.seasonID, 17, "run-provided season must win")
assertEqual(completedRun.status, "completed", "completed history status")
assertEqual(completedRun.completed, true, "completed history flag")
assertNear(completedRun.startDate, fixedNow - 40 * 60, 1, "derived completed start")

local incompleteRun = hooks.NormalizeMythicPlusRun({
    mapChallengeModeID = 503,
    level = 10,
    thisWeek = true,
    completed = false,
    runScore = 0,
    durationSec = 900,
    completionDate = completionCalendar,
    season = 17,
}, 17)
assertEqual(incompleteRun.status, "abandoned", "incomplete history status")
assertEqual(incompleteRun.completed, false, "incomplete history flag")
assertEqual(incompleteRun.completedAt, nil, "incomplete history completion timestamp")
assertEqual(incompleteRun.abandonReason, "history_incomplete", "incomplete history reason")
assertNear(incompleteRun.startDate, fixedNow - 45 * 60, 1, "derived incomplete start")

local secretValue = {}
issecretvalue = function(value)
    return value == secretValue
end
local secretSafeRun = hooks.NormalizeMythicPlusRun({
    mapChallengeModeID = 503,
    level = 10,
    completed = true,
    runScore = secretValue,
    durationSec = 600,
    completionDate = completionCalendar,
    season = 17,
}, 17)
assertEqual(secretSafeRun.runScore, nil, "secret history fields must be omitted")
issecretvalue = function()
    return false
end

local completionMembers, completionInfo = hooks.CaptureCompletionInfoMembers()
assertEqual(completionMembers, nil, "empty completion member normalization")
assertEqual(completionInfo.apiName, "GetChallengeCompletionInfo", "current completion API")
assertEqual(completionInfo.mapChallengeModeID, 503, "completion map ID")
assertEqual(completionInfo.durationMs, 1234567, "completion duration")

local challengeStart = hooks.GetChallengeModeStartTimestamp()
assertNear(challengeStart, fixedNow - 600, 1, "GetTime-domain challenge start")

WowDashboardDB = {
    version = 4,
    characters = {},
    mythicPlusDebug = {},
}
runHistoryCalls = {}
C_MythicPlus.GetRunHistory = function(...)
    runHistoryCalls[#runHistoryCalls + 1] = { ... }
    return {
        {
            mapChallengeModeID = 503,
            level = 10,
            completed = true,
            durationSec = 600,
            completionDate = completionCalendar,
            season = 17,
        },
    }
end
local history = hooks.CollectMythicPlusHistory()
assertEqual(#history, 1, "history normalization count")
assertEqual(#runHistoryCalls, 1, "history API call count")
assertEqual(runHistoryCalls[1][1], true, "history includes previous weeks")
assertEqual(runHistoryCalls[1][2], true, "history includes incomplete runs")
assertEqual(runHistoryCalls[1][3], true, "history is current-season only")
assertEqual(requestMapInfoCalls, 1, "map info should only be requested once")

local snapshots = {}
for index = 1, 300 do
    snapshots[index] = { takenAt = index }
end
local runs = {}
for index = 1, 1200 do
    runs[index] = {
        observedAt = fixedNow - index,
        seasonID = 17,
        mapChallengeModeID = 503,
        level = 10,
        startDate = fixedNow - index * 3600,
    }
end
WowDashboardDB = {
    version = 3,
    characters = {
        ["Old-TestRealm"] = {
            snapshots = snapshots,
            mythicPlusRuns = runs,
            mythicPlusRunKeys = { legacy = true },
            mythicPlusStorageVersion = 1,
        },
    },
    pendingMythicPlusMembers = {
        ["Expired-TestRealm"] = { capturedAt = fixedNow - 3600 },
    },
}
hooks.MigrateDatabase()
local migrated = WowDashboardDB.characters["Old-TestRealm"]
assertEqual(WowDashboardDB.version, 4, "database version")
assertEqual(migrated.region, "tw", "stored character region correction")
assertEqual(#migrated.snapshots, 256, "snapshot retention")
assertEqual(migrated.snapshots[1].takenAt, 45, "oldest retained snapshot")
assert(type(migrated.snapshots[1].addonSignature) == "table", "corrected snapshots must be re-signed")
assertEqual(#migrated.mythicPlusRuns, 1000, "Mythic+ retention")
assert(type(migrated.mythicPlusRuns[1].addonSignature) == "table", "migrated runs must be re-signed")
assertEqual(migrated.mythicPlusRunKeys, nil, "legacy fingerprint index removal")
assertEqual(
    migrated.mythicPlusStorageVersion,
    hooks.MYTHIC_PLUS_STORAGE_VERSION,
    "Mythic+ migration marker"
)
assertEqual(WowDashboardDB.pendingMythicPlusMembers["Expired-TestRealm"], nil, "transient cleanup")

WowDashboardDB.version = 9
hooks.MigrateDatabase()
assertEqual(WowDashboardDB.version, 9, "future database version must not be downgraded")

print("WoW addon regression tests passed.")
