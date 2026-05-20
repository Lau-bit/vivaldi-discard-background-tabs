const SKIPPED_URL_PREFIXES = [
  "chrome://",
  "chrome-extension://",
  "edge://",
  "vivaldi://",
  "about:",
  "devtools://"
];

const PARKED_PAGE = chrome.runtime.getURL("parked.html");
const PARKED_STATE_KEY = "parkedState";
const SMART_TOGGLE_MENU_ID = "discard-background-tabs-smart-toggle";
const PARK_AGAIN_MENU_ID = "discard-background-tabs-park-again";

function isDiscardCandidate(tab) {
  if (!tab.id) return false;
  if (tab.discarded || tab.pinned || tab.audible) return false;
  if (!tab.url) return false;
  if (tab.url === PARKED_PAGE) return false;

  return !SKIPPED_URL_PREFIXES.some((prefix) => tab.url.startsWith(prefix));
}

async function parkActiveTabs() {
  const parkedState = await getParkedState();
  const tabs = await chrome.tabs.query({});
  const activeTabsByWindow = new Map();
  const parkedTabsByWindow = new Map();
  const previousActiveTabs = {
    ...(parkedState?.previousActiveTabs || {})
  };

  for (const tab of tabs) {
    if (!tab.windowId) continue;

    if (tab.url === PARKED_PAGE) {
      parkedTabsByWindow.set(tab.windowId, tab);
    }

    if (tab.active) {
      activeTabsByWindow.set(tab.windowId, tab);
      if (tab.id && tab.url !== PARKED_PAGE) {
        previousActiveTabs[tab.windowId] = tab.id;
      }
    }
  }

  for (const [windowId, tab] of activeTabsByWindow) {
    if (tab.url === PARKED_PAGE) continue;

    const parkedTab = parkedTabsByWindow.get(windowId);

    if (parkedTab?.id) {
      await chrome.tabs.update(parkedTab.id, { active: true });
    } else {
      await chrome.tabs.create({
        windowId,
        url: PARKED_PAGE,
        active: true
      });
    }
  }

  await chrome.storage.session.set({
    [PARKED_STATE_KEY]: {
      previousActiveTabs,
      parkedAt: Date.now()
    }
  });
}

async function parkAndDiscardTabs() {
  await parkActiveTabs();

  const tabs = await chrome.tabs.query({});
  let discardedCount = 0;

  for (const tab of tabs) {
    if (!isDiscardCandidate(tab)) continue;

    try {
      await chrome.tabs.discard(tab.id);
      discardedCount += 1;
    } catch (error) {
      console.debug("Could not discard tab", tab.id, tab.url, error);
    }
  }

  await chrome.action.setBadgeBackgroundColor({ color: "#1f7a4d" });
  await chrome.action.setBadgeText({
    text: discardedCount > 0 ? String(discardedCount) : "0"
  });

  await chrome.alarms.create("clear-badge", { delayInMinutes: 0.05 });
}

async function getParkedState() {
  const result = await chrome.storage.session.get(PARKED_STATE_KEY);
  return result[PARKED_STATE_KEY] || null;
}

async function closeParkedTabs(parkedTabs) {
  for (const tab of parkedTabs) {
    if (!tab.id) continue;

    try {
      await chrome.tabs.remove(tab.id);
    } catch (error) {
      console.debug("Could not close parked tab", tab.id, error);
    }
  }
}

async function restoreParkedWindows() {
  const parkedState = await getParkedState();
  const tabs = await chrome.tabs.query({});
  const tabsById = new Map();
  const tabsByWindow = new Map();
  const parkedTabs = [];

  for (const tab of tabs) {
    if (tab.id) {
      tabsById.set(tab.id, tab);
    }

    if (tab.windowId) {
      if (!tabsByWindow.has(tab.windowId)) {
        tabsByWindow.set(tab.windowId, []);
      }
      tabsByWindow.get(tab.windowId).push(tab);
    }

    if (tab.url === PARKED_PAGE) {
      parkedTabs.push(tab);
    }
  }

  for (const [windowId, windowTabs] of tabsByWindow) {
    const previousTabId = parkedState?.previousActiveTabs?.[windowId];
    const previousTab = previousTabId ? tabsById.get(previousTabId) : null;
    const fallbackTab = windowTabs.find((tab) => tab.url !== PARKED_PAGE);
    const tabToActivate = previousTab || fallbackTab;

    if (!tabToActivate?.id) continue;

    try {
      await chrome.tabs.update(tabToActivate.id, { active: true });
    } catch (error) {
      console.debug("Could not restore tab", tabToActivate.id, error);
    }
  }

  const remainingTabs = await chrome.tabs.query({});
  const windowsWithRealTabs = new Set(
    remainingTabs
      .filter((tab) => tab.windowId && tab.url !== PARKED_PAGE)
      .map((tab) => tab.windowId)
  );
  const removableParkedTabs = parkedTabs.filter((tab) =>
    tab.windowId && windowsWithRealTabs.has(tab.windowId)
  );

  await closeParkedTabs(removableParkedTabs);
  await chrome.storage.session.remove(PARKED_STATE_KEY);
  await chrome.action.setBadgeBackgroundColor({ color: "#355c9a" });
  await chrome.action.setBadgeText({ text: "UP" });
  await chrome.alarms.create("clear-badge", { delayInMinutes: 0.05 });
}

function createContextMenus() {
  chrome.contextMenus.removeAll(() => {
    createActionMenu(SMART_TOGGLE_MENU_ID, "Discard background tabs", ["action"]);
    createActionMenu(PARK_AGAIN_MENU_ID, "Park again - discard tabs", ["action"]);
  });
}

function createActionMenu(id, title, contexts) {
  chrome.contextMenus.create(
    {
      id,
      title,
      contexts
    },
    () => {
      const error = chrome.runtime.lastError;

      if (error && contexts.includes("action")) {
        createActionMenu(id, title, ["browser_action"]);
      }
    }
  );
}

async function smartToggleParking() {
  const [activeTab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  });

  if (activeTab?.url === PARKED_PAGE) {
    return restoreParkedWindows();
  }

  return parkAndDiscardTabs();
}

chrome.action.onClicked.addListener(() => {
  // Intentionally empty: commands live in the right-click menu.
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setTitle({
    title: "Tab parking controls"
  });
  createContextMenus();
});

chrome.runtime.onStartup.addListener(() => {
  createContextMenus();
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === SMART_TOGGLE_MENU_ID) {
    smartToggleParking();
  } else if (info.menuItemId === PARK_AGAIN_MENU_ID) {
    parkAndDiscardTabs();
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "clear-badge") {
    chrome.action.setBadgeText({ text: "" });
  }
});
