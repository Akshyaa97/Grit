// Grit — dashboard script
// Reads stats from chrome.storage.local, paints the cards + bars,
// and provides a "Reset stats" button.

document.addEventListener('DOMContentLoaded', async () => {
  await render();

  document.getElementById('reset-btn').addEventListener('click', async () => {
    const ok = confirm('Reset all Grit stats? This cannot be undone.');
    if (!ok) return;
    await chrome.storage.local.set({ stats: {} });
    await render();
  });
});

// Pull stats from storage and update both the big-number cards
// and the relative-magnitude bars.
async function render() {
  const data = await chrome.storage.local.get('stats');
  const s = data.stats || {};

  const pp = num(s.purchases_paused);
  const si = num(s.scrolls_interrupted);
  const sd = num(s.emails_delayed);
  const dp = num(s.dark_patterns_flagged);
  const money = num(s.money_at_stake);

  // Big numbers
  document.getElementById('d-pp').textContent = pp;
  document.getElementById('d-si').textContent = si;
  document.getElementById('d-sd').textContent = sd;
  document.getElementById('d-dp').textContent = dp;
  document.getElementById('d-money').textContent =
    money > 0 ? `~$${formatMoney(money)} at stake` : '— at stake';

  // Bars
  const max = Math.max(1, pp, si, sd, dp);
  setBar('b-pp', 'bn-pp', pp, max);
  setBar('b-si', 'bn-si', si, max);
  setBar('b-sd', 'bn-sd', sd, max);
  setBar('b-dp', 'bn-dp', dp, max);
}

// Set bar width and number label for one row.
function setBar(barId, numId, value, max) {
  const pct = Math.round((value / max) * 100);
  document.getElementById(barId).style.width = pct + '%';
  document.getElementById(numId).textContent = String(value);
}

function num(v) { return Number.isFinite(+v) ? +v : 0; }

// Format money with comma separators and at most 2 decimals.
function formatMoney(n) {
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
