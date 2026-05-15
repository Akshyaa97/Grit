// Grit — popup script
// Wires up the stats display, the 5 feature toggles, and the
// "Open Dashboard" button.

const DEFAULT_SETTINGS = {
  purchase_pause: true,
  scroll_interrupt: true,
  send_delay: true,
  dark_pattern: true,
  weekly_mirror: true,
};

document.addEventListener('DOMContentLoaded', async () => {
  await renderStats();
  await renderSettings();
  bindDashboardButton();
});

// Pull current stats from chrome.storage.local and paint them in.
async function renderStats() {
  const data = await chrome.storage.local.get('stats');
  const stats = data.stats || {};
  document.getElementById('s-pp').textContent = fmt(stats.purchases_paused);
  document.getElementById('s-si').textContent = fmt(stats.scrolls_interrupted);
  document.getElementById('s-sd').textContent = fmt(stats.emails_delayed);
  document.getElementById('s-dp').textContent = fmt(stats.dark_patterns_flagged);
}
function fmt(n) { return String(n || 0); }

// Pull current toggle state from chrome.storage.sync, set checkboxes,
// and write back any change to storage immediately.
async function renderSettings() {
  const data = await chrome.storage.sync.get('settings');
  const current = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };

  document.querySelectorAll('.row-toggle').forEach((cb) => {
    const key = cb.dataset.key;
    cb.checked = !!current[key];
    cb.addEventListener('change', async () => {
      const fresh = await chrome.storage.sync.get('settings');
      const merged = { ...DEFAULT_SETTINGS, ...(fresh.settings || {}) };
      merged[key] = cb.checked;
      await chrome.storage.sync.set({ settings: merged });
    });
  });
}

// Open the dashboard in a new tab via the background worker so the
// chrome:// scheme rules and popup-close behaviour are handled
// uniformly.
function bindDashboardButton() {
  const btn = document.getElementById('open-dashboard');
  btn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'openDashboard' });
    window.close();
  });
}
