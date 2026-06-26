# Tab Parking Controls

A tiny Vivaldi/Chromium extension that toggles browser windows between parked and restored states from the extension toolbar button.

Discarding is Chromium's built-in tab hibernation mechanism: the tab remains in the tab strip, but its page is unloaded from memory and reloads when selected again.

## Behavior

- Left-clicking the extension button is intentionally inert to avoid accidental discards.
- Right-click the extension button and choose **Park all tabs** to run the smart behavior: real tab parks/re-parks, parked tab restores.
- Right-click the extension button and choose **Park all but current tab** to keep the focused tab active while discarding every other eligible tab.
- Right-click the extension button and choose **Unpark all tabs** to restore parked windows.
- Right-click the extension button and choose **Park again - discard tabs** to re-run parking without restoring first.
- Right-click the extension button and choose **Hibernate this tab** to discard just the current tab in place, without creating a parked placeholder. Focus briefly moves to a neighboring tab so the active tab can be discarded.
- Right-click the extension button and choose **Unpark this tab** to restore only the current window from its parked state.
- Falls back to another real tab in the same window if the previously active tab no longer exists.
- Discards tabs across all browser windows, including the previously active tab in the current window.
- Skips pinned tabs.
- Skips audible tabs.
- Skips tabs that are already discarded.
- Skips browser/internal pages such as `vivaldi://`, `chrome://`, extension pages, and DevTools.
- Shows a short badge count with the number of tabs it discarded.

## Install In Vivaldi

1. Open `vivaldi://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder: `vivaldi-discard-background-tabs`.
5. Pin the extension button if you want it visible in the toolbar.

## Notes

Discarded tabs reload when focused. Unsaved page state can be lost if the website does not preserve it, so pinned and audible tabs are skipped by default.

Chromium requires every browser window to have one active tab. To discard active real tabs, the extension activates its own lightweight `parked.html` tab in each window first.
