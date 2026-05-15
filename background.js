// Grit — background service worker (Manifest V3)
// Responsibilities:
//   - Seed default settings on install.
//   - Update the toolbar badge with the dark-pattern count for
//     each tab (sent from content.js).
//   - Close tabs on request from content.js (Scroll Interrupt
//     overlay -> "Close tab" button).

const DEFAULT_SETTINGS = {
  purchase_pause: true,
  scroll_interrupt: true,
  send_delay: true,
  dark_pattern: true,
  weekly_mirror: true, // tracks stats
};

// Seed settings the first time the extension is installed/updated.
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[Grit] installed:', details.reason);
  const data = await chrome.storage.sync.get('settings');
  if (!data.settings) {
    await chrome.storage.sync.set({ settings: DEFAULT_SETTINGS });
  } else {
    // Backfill any new keys without overwriting user choices.
    const merged = { ...DEFAULT_SETTINGS, ...data.settings };
    await chrome.storage.sync.set({ settings: merged });
  }
});

// Receive messages from content scripts and dashboard/popup.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'darkPatternCount') {
    // Update the badge for the tab that found the patterns.
    const tabId = sender.tab && sender.tab.id;
    if (tabId == null) return;
    const text = msg.count > 0 ? String(msg.count) : '';
    chrome.action.setBadgeText({ text, tabId });
    chrome.action.setBadgeBackgroundColor({ color: '#dc2626', tabId });
    return;
  }

  if (msg.type === 'closeTab') {
    // Used by Scroll Interrupt's "Close tab" button.
    const tabId = sender.tab && sender.tab.id;
    if (tabId != null) chrome.tabs.remove(tabId);
    return;
  }

  if (msg.type === 'openDashboard') {
    // Used by the popup's "Open Dashboard" button.
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
    return;
  }
});

// Clear the badge when a tab navigates so old counts don't linger.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    chrome.action.setBadgeText({ text: '', tabId });
  }
});
