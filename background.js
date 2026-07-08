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
const UNPARK_ALL_MENU_ID = "discard-background-tabs-unpark-all";
const PARK_EXCEPT_CURRENT_MENU_ID = "discard-background-tabs-park-except-current";
const HIBERNATE_THIS_TAB_MENU_ID = "discard-background-tabs-hibernate-this-tab";
const UNPARK_THIS_TAB_MENU_ID = "discard-background-tabs-unpark-this-tab";
const PARK_PINNED_SEPARATOR_ID = "discard-background-tabs-park-pinned-separator";
const PARK_PINNED_MENU_ID = "discard-background-tabs-toggle-park-pinned";
const PARK_PINNED_STORAGE_KEY = "parkPinnedTabs";
const PARK_PINNED_DEFAULTS = { [PARK_PINNED_STORAGE_KEY]: true };

async function getParkPinnedEnabled() {
  const stored = await chrome.storage.local.get(PARK_PINNED_DEFAULTS);
  return stored[PARK_PINNED_STORAGE_KEY] !== false;
}

async function setParkPinnedEnabled(enabled) {
  await chrome.storage.local.set({ [PARK_PINNED_STORAGE_KEY]: enabled });
}

function isDiscardCandidate(tab, options = {}) {
  if (!tab.id) return false;
  if (tab.discarded || tab.audible) return false;
  if (tab.pinned && !options.parkPinned) return false;
  if (!tab.url) return false;
  if (tab.url === PARKED_PAGE) return false;

  return !SKIPPED_URL_PREFIXES.some((prefix) => tab.url.startsWith(prefix));
}

async function parkActiveTabs(options = {}) {
  const excludedTabId = options.excludedTabId || null;
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
      if (tab.id === excludedTabId) continue;

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

  return discardEligibleTabs();
}

async function parkAndDiscardExceptCurrentTab() {
  const [currentTab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  });
  const currentTabId = currentTab?.id || null;

  await parkActiveTabs({ excludedTabId: currentTabId });

  return discardEligibleTabs({ excludedTabId: currentTabId });
}

async function discardEligibleTabs(options = {}) {
  const excludedTabId = options.excludedTabId || null;
  const parkPinned = await getParkPinnedEnabled();
  const tabs = await chrome.tabs.query({});
  let discardedCount = 0;

  for (const tab of tabs) {
    if (tab.id === excludedTabId) continue;
    if (!isDiscardCandidate(tab, { parkPinned })) continue;

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

async function hibernateSingleTab(tab) {
  const targetTab = tab || (await getActiveTab());

  if (!targetTab?.id || !targetTab.windowId) return;

  const parkPinned = await getParkPinnedEnabled();
  if (!isDiscardCandidate(targetTab, { parkPinned })) {
    console.debug("Tab is not a discard candidate", targetTab.id, targetTab.url);
    return;
  }

  // The active tab can't be discarded directly. Briefly switch focus to a
  // neighboring real tab in the same window (no parked placeholder created),
  // then discard this one in place. A background tab is discarded immediately.
  if (targetTab.active) {
    const neighbor = await findNeighborTab(targetTab);

    if (!neighbor?.id) {
      console.debug("No neighbor tab to focus before hibernating", targetTab.id);
      return;
    }

    try {
      await chrome.tabs.update(neighbor.id, { active: true });
    } catch (error) {
      console.debug("Could not focus neighbor tab", neighbor.id, error);
      return;
    }
  }

  try {
    await chrome.tabs.discard(targetTab.id);
  } catch (error) {
    console.debug("Could not hibernate tab", targetTab.id, targetTab.url, error);
  }
}

async function findNeighborTab(targetTab) {
  const windowTabs = await chrome.tabs.query({ windowId: targetTab.windowId });
  const candidates = windowTabs.filter(
    (tab) => tab.id && tab.id !== targetTab.id && tab.url !== PARKED_PAGE
  );

  if (candidates.length === 0) return null;

  // Prefer an already-loaded tab so we don't wake a discarded one just to focus.
  return candidates.find((tab) => !tab.discarded) || candidates[0];
}

async function unparkSingleTab(tab) {
  const targetTab = tab || (await getActiveTab());

  if (!targetTab?.id || !targetTab.windowId) return;

  // If this window is showing the parked placeholder, restore it. Otherwise
  // just reload the discarded tab in place.
  if (targetTab.url === PARKED_PAGE) {
    return restoreParkedWindows({ windowId: targetTab.windowId });
  }

  if (!targetTab.discarded) return;

  try {
    await chrome.tabs.reload(targetTab.id);
  } catch (error) {
    console.debug("Could not unpark tab", targetTab.id, targetTab.url, error);
  }
}

async function getActiveTab() {
  const [activeTab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  });

  return activeTab || null;
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

async function restoreParkedWindows(options = {}) {
  const onlyWindowId = options.windowId || null;
  const parkedState = await getParkedState();
  const tabs = await chrome.tabs.query({});
  const tabsById = new Map();
  const tabsByWindow = new Map();
  const parkedTabs = [];

  for (const tab of tabs) {
    if (tab.id) {
      tabsById.set(tab.id, tab);
    }

    if (tab.windowId && (!onlyWindowId || tab.windowId === onlyWindowId)) {
      if (!tabsByWindow.has(tab.windowId)) {
        tabsByWindow.set(tab.windowId, []);
      }
      tabsByWindow.get(tab.windowId).push(tab);

      if (tab.url === PARKED_PAGE) {
        parkedTabs.push(tab);
      }
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

  if (onlyWindowId) {
    const previousActiveTabs = { ...(parkedState?.previousActiveTabs || {}) };
    delete previousActiveTabs[onlyWindowId];

    if (Object.keys(previousActiveTabs).length > 0) {
      await chrome.storage.session.set({
        [PARKED_STATE_KEY]: { ...parkedState, previousActiveTabs }
      });
    } else {
      await chrome.storage.session.remove(PARKED_STATE_KEY);
    }
  } else {
    await chrome.storage.session.remove(PARKED_STATE_KEY);
  }

  await chrome.action.setBadgeBackgroundColor({ color: "#355c9a" });
  await chrome.action.setBadgeText({ text: "UP" });
  await chrome.alarms.create("clear-badge", { delayInMinutes: 0.05 });
}

function createContextMenus() {
  chrome.contextMenus.removeAll(async () => {
    createActionMenu(SMART_TOGGLE_MENU_ID, "Park all tabs", ["action"]);
    createActionMenu(PARK_EXCEPT_CURRENT_MENU_ID, "Park all but current tab", ["action"]);
    createActionMenu(UNPARK_ALL_MENU_ID, "Unpark all tabs", ["action"]);
    createActionMenu(PARK_AGAIN_MENU_ID, "Park again - discard tabs", ["action"]);
    createActionMenu(HIBERNATE_THIS_TAB_MENU_ID, "Hibernate this tab", ["action"]);
    createActionMenu(UNPARK_THIS_TAB_MENU_ID, "Unpark this tab", ["action"]);
    createSeparatorMenu(PARK_PINNED_SEPARATOR_ID, ["action"]);
    const parkPinned = await getParkPinnedEnabled();
    createCheckboxMenu(PARK_PINNED_MENU_ID, "Park pinned tabs", parkPinned, ["action"]);
  });
}

function createActionMenu(id, title, contexts) {
  createMenuItem({ id, title }, contexts);
}

function createSeparatorMenu(id, contexts) {
  createMenuItem({ id, type: "separator" }, contexts);
}

function createCheckboxMenu(id, title, checked, contexts) {
  createMenuItem({ id, title, type: "checkbox", checked }, contexts);
}

function createMenuItem(props, contexts) {
  chrome.contextMenus.create(
    { ...props, contexts },
    () => {
      const error = chrome.runtime.lastError;

      if (!error) return;

      // Some Chromium builds use "browser_action" instead of "action".
      const fallbackContexts = contexts.map((context) =>
        context === "action" ? "browser_action" : context
      );

      if (fallbackContexts.some((context, index) => context !== contexts[index])) {
        createMenuItem(props, fallbackContexts);
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

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === SMART_TOGGLE_MENU_ID) {
    smartToggleParking();
  } else if (info.menuItemId === PARK_EXCEPT_CURRENT_MENU_ID) {
    parkAndDiscardExceptCurrentTab();
  } else if (info.menuItemId === UNPARK_ALL_MENU_ID) {
    restoreParkedWindows();
  } else if (info.menuItemId === PARK_AGAIN_MENU_ID) {
    parkAndDiscardTabs();
  } else if (info.menuItemId === HIBERNATE_THIS_TAB_MENU_ID) {
    hibernateSingleTab(tab);
  } else if (info.menuItemId === UNPARK_THIS_TAB_MENU_ID) {
    unparkSingleTab(tab);
  } else if (info.menuItemId === PARK_PINNED_MENU_ID) {
    setParkPinnedEnabled(info.checked);
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "clear-badge") {
    chrome.action.setBadgeText({ text: "" });
  }
});
