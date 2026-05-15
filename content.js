// Grit — content script (v0.2)
// Single file. Each feature is gated on its setting and only runs
// on relevant hosts. Comments above every function explain intent.

(async () => {
  if (window.__frictionLoaded) return;
  window.__frictionLoaded = true;

  // ============================================================
  // Settings
  // ============================================================
  const DEFAULTS = {
    purchase_pause: true,
    scroll_interrupt: true,
    send_delay: true,
    dark_pattern: true,
    weekly_mirror: true,
  };

  // Read settings from sync storage, falling back to defaults.
  async function loadSettings() {
    try {
      const data = await chrome.storage.sync.get('settings');
      return { ...DEFAULTS, ...(data.settings || {}) };
    } catch {
      return { ...DEFAULTS };
    }
  }
  const settings = await loadSettings();

  // Keep `settings` in sync if the user toggles something while the
  // page is open. Most features check `settings.x` at call time.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !changes.settings) return;
    Object.assign(settings, DEFAULTS, changes.settings.newValue || {});
  });

  // ============================================================
  // Stats helpers (chrome.storage.local)
  // ============================================================
  // Increment a numeric stat by `by`. No-op if Weekly Mirror is off.
  async function bumpStat(key, by = 1) {
    if (!settings.weekly_mirror) return;
    try {
      const data = await chrome.storage.local.get('stats');
      const stats = data.stats || {};
      stats[key] = (stats[key] || 0) + by;
      await chrome.storage.local.set({ stats });
    } catch {}
  }

  // ============================================================
  // Hostname helpers
  // ============================================================
  const host = location.hostname.replace(/^www\./, '');

  // True if we're on an attention-trap site Scroll Interrupt covers.
  function isAttentionTrap() {
    const path = location.pathname || '/';
    if (host.endsWith('reddit.com')) return true;
    if (host === 'x.com' || host.endsWith('.x.com')) return true;
    if (host.endsWith('twitter.com')) return true;
    if (host.endsWith('instagram.com')) return true;
    if (host.endsWith('tiktok.com')) return true;
    if (host.endsWith('youtube.com') && path.startsWith('/shorts')) return true;
    return false;
  }
  // True if we're inside Gmail.
  const isGmail = host === 'mail.google.com';

  // ============================================================
  // Feature 1 — PURCHASE PAUSE  (preserved from v0.1)
  // ============================================================
  if (settings.purchase_pause) initPurchasePause();

  function initPurchasePause() {
    const COUNTDOWN_SECONDS = 10;

    // Phrases we look for in a button's text (lowercased + collapsed).
    const TRIGGER_PHRASES = [
      'buy now', 'buy it now',
      'place order', 'place your order',
      'add to cart', 'add to bag', 'add to basket',
      'checkout', 'check out', 'proceed to checkout',
      'complete purchase', 'complete order',
      'confirm order', 'confirm and pay', 'pay now',
    ];
    const BUTTON_SELECTOR =
      'button, a, [role="button"], input[type="button"], input[type="submit"]';

    // One-shot bypass flag: when true, the next click passes through.
    window.__frictionAllow = false;
    let modalOpen = false;

    // Lowercased text we use for matching.
    function getButtonText(el) {
      const parts = [
        el.innerText || el.textContent || '',
        el.getAttribute && el.getAttribute('aria-label'),
        el.getAttribute && el.getAttribute('title'),
        el.value,
      ];
      return parts.filter(Boolean).join(' ')
        .replace(/\s+/g, ' ').trim().toLowerCase();
    }

    // True if this element looks like a checkout/buy button.
    function isPurchaseButton(el) {
      const text = getButtonText(el);
      if (!text || text.length > 80) return false;
      return TRIGGER_PHRASES.some((p) => text.includes(p));
    }

    // Best-effort price detection near a button.
    const PRICE_RE = /(?:[$£€₹]\s?)\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*(?:\.\d{1,2})?\s?(?:USD|EUR|GBP|INR|JPY|AUD|CAD)/i;
    function findPriceNear(el) {
      let cur = el;
      for (let i = 0; cur && i < 6; i++) {
        const txt = (cur.innerText || '').replace(/\s+/g, ' ');
        const m = txt.match(PRICE_RE);
        if (m) return m[0].trim();
        cur = cur.parentElement;
      }
      const m = (document.body && document.body.innerText || '').match(PRICE_RE);
      return m ? m[0].trim() : null;
    }
    // Convert "$199.99" -> 199.99
    function priceToNumber(s) {
      if (!s) return 0;
      const cleaned = s.replace(/[^\d.,]/g, '').replace(/,/g, '');
      const n = parseFloat(cleaned);
      return Number.isFinite(n) ? n : 0;
    }

    // Capture-phase click listener — runs before site handlers.
    document.addEventListener('click', (event) => {
      if (!settings.purchase_pause) return;

      // Approved click? Let exactly ONE through and re-arm.
      if (window.__frictionAllow) {
        window.__frictionAllow = false;
        return;
      }
      const btn = event.target instanceof Element
        ? event.target.closest(BUTTON_SELECTOR) : null;
      if (!btn) return;
      if (btn.closest('#friction-overlay')) return;
      if (!isPurchaseButton(btn)) return;
      if (modalOpen) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      showPauseModal(btn);
    }, true);

    // Render the 10s pause overlay for a detected purchase button.
    function showPauseModal(originalButton) {
      modalOpen = true;
      const priceStr = findPriceNear(originalButton);
      const priceNum = priceToNumber(priceStr);

      bumpStat('purchases_paused', 1);
      if (priceNum > 0) bumpStat('money_at_stake', priceNum);

      const overlay = document.createElement('div');
      overlay.id = 'friction-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.innerHTML = `
        <div class="friction-card" data-testid="friction-modal">
          <div class="friction-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="40" height="40" fill="none"
                 stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round">
              <rect x="6" y="5" width="4" height="14" rx="1"></rect>
              <rect x="14" y="5" width="4" height="14" rx="1"></rect>
            </svg>
          </div>
          <h2 class="friction-title">Pause. Let's think.</h2>
          <p class="friction-sub">
            Take a breath. Do you really need this${priceStr ? ' for ' + priceStr : ''} right now?
          </p>
          <div class="friction-timer" data-testid="friction-timer">
            <span id="friction-count">${COUNTDOWN_SECONDS}</span>
            <span class="friction-timer-label">seconds</span>
          </div>
          <div class="friction-actions">
            <button type="button" class="friction-btn friction-btn-cancel"
                    id="friction-cancel" data-testid="friction-cancel-btn">
              Cancel
            </button>
            <button type="button" class="friction-btn friction-btn-buy"
                    id="friction-buy" data-testid="friction-buy-btn" disabled>
              Buy Anyway (${COUNTDOWN_SECONDS})
            </button>
          </div>
          <p class="friction-foot">Grit · purchase pause</p>
        </div>
      `;
      document.documentElement.appendChild(overlay);

      const countEl = overlay.querySelector('#friction-count');
      const buyBtn  = overlay.querySelector('#friction-buy');
      const cancelBtn = overlay.querySelector('#friction-cancel');

      let remaining = COUNTDOWN_SECONDS;
      const tick = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          clearInterval(tick);
          countEl.textContent = '0';
          buyBtn.disabled = false;
          buyBtn.textContent = 'Buy Anyway';
          buyBtn.focus();
        } else {
          countEl.textContent = String(remaining);
          buyBtn.textContent = `Buy Anyway (${remaining})`;
        }
      }, 1000);

      // ESC = Cancel
      const onKey = (e) => {
        if (e.key === 'Escape' || e.key === 'Esc') {
          e.preventDefault(); e.stopPropagation(); close();
        }
      };
      document.addEventListener('keydown', onKey, true);

      function close() {
        clearInterval(tick);
        document.removeEventListener('keydown', onKey, true);
        overlay.remove();
        modalOpen = false;
      }

      cancelBtn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation(); close();
      });
      buyBtn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (buyBtn.disabled) return;
        // Approve one pass-through, close modal, re-fire original.
        window.__frictionAllow = true;
        close();
        try { originalButton.click(); }
        catch (err) {
          window.__frictionAllow = false;
          console.warn('[Grit] re-click failed:', err);
        }
      });

      cancelBtn.focus();
    }
  }

  // ============================================================
  // Feature 2 — SCROLL INTERRUPT (attention-trap sites)
  // ============================================================
  if (settings.scroll_interrupt && isAttentionTrap()) initScrollInterrupt();

  function initScrollInterrupt() {
    // Per-site intent stored in sessionStorage so it asks once per
    // browsing session rather than nagging on every navigation.
    const INTENT_KEY = 'friction_intent_' + host;
    const ASKED_KEY = 'friction_intent_asked_' + host;

    let intent = sessionStorage.getItem(INTENT_KEY) || '';

    // Show the small intent prompt 1.5s after landing.
    if (!sessionStorage.getItem(ASKED_KEY)) {
      setTimeout(() => showIntentPrompt((saved) => {
        intent = (saved || '').trim();
        sessionStorage.setItem(INTENT_KEY, intent);
        sessionStorage.setItem(ASKED_KEY, '1');
      }), 1500);
    }

    // Active-time counter: only ticks while the tab is visible.
    let activeSec = 0;
    let nextThreshold = 600; // 10 min for the first reminder

    setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      activeSec += 1;
      if (activeSec >= nextThreshold) {
        nextThreshold = activeSec + 300; // next reminder in +5 min
        showTimeOverInterrupt(intent || sessionStorage.getItem(INTENT_KEY) || '');
      }
    }, 1000);
  }

  // Render the small bottom-right "What are you here for?" card.
  function showIntentPrompt(onDone) {
    if (document.getElementById('friction-intent')) return;
    const wrap = document.createElement('div');
    wrap.id = 'friction-intent';
    wrap.innerHTML = `
      <div class="friction-intent-card" data-testid="friction-intent-card">
        <p class="friction-intent-q">What are you here for?</p>
        <input type="text" id="friction-intent-input"
               data-testid="friction-intent-input"
               placeholder="e.g. check 1 message, then leave"
               maxlength="120" autocomplete="off" />
        <div class="friction-intent-row">
          <button type="button" id="friction-intent-skip"
                  class="friction-btn-mini friction-btn-mini-ghost"
                  data-testid="friction-intent-skip">
            Skip
          </button>
          <button type="button" id="friction-intent-save"
                  class="friction-btn-mini friction-btn-mini-primary"
                  data-testid="friction-intent-save">
            Save
          </button>
        </div>
      </div>
    `;
    document.documentElement.appendChild(wrap);

    const input = wrap.querySelector('#friction-intent-input');
    const close = (saved) => { wrap.remove(); onDone && onDone(saved); };

    wrap.querySelector('#friction-intent-skip')
      .addEventListener('click', () => close(''));
    wrap.querySelector('#friction-intent-save')
      .addEventListener('click', () => close(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') close(input.value);
      if (e.key === 'Escape') close('');
    });
    setTimeout(() => input.focus(), 50);
  }

  // Render the centered "10 min check-in" overlay.
  function showTimeOverInterrupt(intent) {
    if (document.getElementById('friction-time')) return;
    bumpStat('scrolls_interrupted', 1);

    const overlay = document.createElement('div');
    overlay.id = 'friction-time';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    const intentLine = intent
      ? `<p class="friction-sub">You came for: <b>"${escapeHtml(intent)}"</b></p>`
      : `<p class="friction-sub">You didn't set an intent. Maybe time to step away?</p>`;
    overlay.innerHTML = `
      <div class="friction-card" data-testid="friction-time-card">
        <div class="friction-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="40" height="40" fill="none"
               stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="9"></circle>
            <path d="M12 7v5l3 2"></path>
          </svg>
        </div>
        <h2 class="friction-title">You've been here 10 min.</h2>
        ${intentLine}
        <p class="friction-sub friction-sub-soft">Still on track?</p>
        <div class="friction-actions">
          <button type="button" class="friction-btn friction-btn-cancel"
                  id="friction-time-close" data-testid="friction-time-close">
            Close tab
          </button>
          <button type="button" class="friction-btn friction-btn-buy"
                  id="friction-time-stay" data-testid="friction-time-stay">
            Yes, 5 more min
          </button>
        </div>
        <p class="friction-foot">Grit · scroll interrupt</p>
      </div>
    `;
    document.documentElement.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('#friction-time-stay')
      .addEventListener('click', close);
    overlay.querySelector('#friction-time-close')
      .addEventListener('click', () => {
        // Ask the background script to close this tab.
        try { chrome.runtime.sendMessage({ type: 'closeTab' }); } catch {}
        close();
      });
  }

  // Tiny HTML escaper used when echoing user intent.
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // ============================================================
  // Feature 3 — SEND DELAY (Gmail only)
  // ============================================================
  if (settings.send_delay && isGmail) initSendDelay();

  function initSendDelay() {
    let modalOpen = false;
    let allowOnce = false; // local one-shot bypass for the Send btn

    document.addEventListener('click', (e) => {
      if (!settings.send_delay) return;

      // Approved? Let it through and re-arm.
      if (allowOnce) { allowOnce = false; return; }

      const btn = e.target instanceof Element
        ? e.target.closest('[role="button"], button') : null;
      if (!btn) return;
      const aria = (btn.getAttribute('aria-label') || '').trim();
      // Gmail's Send button aria-label starts with "Send" (e.g.,
      // "Send ‪(Ctrl-Enter)‬"). We avoid matching "Send to ...".
      if (!/^send\b/i.test(aria)) return;
      if (modalOpen) {
        e.preventDefault(); e.stopImmediatePropagation();
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      showSendDelayModal(btn);
    }, true);

    // Find compose body and assess emotional language.
    function analyzeBody(btn) {
      const dialog = btn.closest('[role="dialog"]') || document;
      const body = dialog.querySelector('[contenteditable="true"][role="textbox"]')
                || dialog.querySelector('[contenteditable="true"]');
      const text = body ? (body.innerText || '') : '';
      // ALL-CAPS words of length 4+ (skip common acronyms).
      const SKIP = new Set(['LOL','OMG','BTW','FYI','ASAP','TBH','IMO','IIRC','TLDR','YMMV','ICYMI']);
      const allCaps = (text.match(/\b[A-Z]{4,}\b/g) || []).filter(w => !SKIP.has(w));
      const exclaims = (text.match(/!/g) || []).length;
      const isEmotional = allCaps.length >= 1 || exclaims >= 3;
      return { isEmotional, capsSample: allCaps.slice(0, 3), exclaims };
    }

    // Render the 30s send-delay overlay.
    function showSendDelayModal(originalButton) {
      modalOpen = true;
      bumpStat('emails_delayed', 1);

      const { isEmotional, capsSample, exclaims } = analyzeBody(originalButton);
      const COUNTDOWN_SECONDS = 30;

      const overlay = document.createElement('div');
      overlay.id = 'friction-send';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');

      let warningHtml = '';
      if (isEmotional) {
        const reasons = [];
        if (capsSample.length) reasons.push(`ALL-CAPS words (${capsSample.join(', ')})`);
        if (exclaims >= 3) reasons.push(`${exclaims} exclamation marks`);
        warningHtml = `
          <div class="friction-warn" data-testid="friction-send-warning">
            <strong>This reads as emotional.</strong>
            <span>${reasons.join(' · ')} — re-read before sending?</span>
          </div>
        `;
      }

      overlay.innerHTML = `
        <div class="friction-card" data-testid="friction-send-card">
          <div class="friction-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="40" height="40" fill="none"
                 stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round">
              <path d="m22 2-7 20-4-9-9-4z"></path>
              <path d="M22 2 11 13"></path>
            </svg>
          </div>
          <h2 class="friction-title">Hold the send.</h2>
          <p class="friction-sub">
            30 seconds to reconsider. Cancel any time.
          </p>
          ${warningHtml}
          <div class="friction-timer" data-testid="friction-send-timer">
            <span id="friction-send-count">${COUNTDOWN_SECONDS}</span>
            <span class="friction-timer-label">seconds</span>
          </div>
          <div class="friction-actions">
            <button type="button" class="friction-btn friction-btn-cancel"
                    id="friction-send-cancel" data-testid="friction-send-cancel">
              Cancel
            </button>
            <button type="button" class="friction-btn friction-btn-buy"
                    id="friction-send-go" data-testid="friction-send-go" disabled>
              Send Anyway (${COUNTDOWN_SECONDS})
            </button>
          </div>
          <p class="friction-foot">Grit · send delay</p>
        </div>
      `;
      document.documentElement.appendChild(overlay);

      const countEl = overlay.querySelector('#friction-send-count');
      const goBtn   = overlay.querySelector('#friction-send-go');
      const cancelBtn = overlay.querySelector('#friction-send-cancel');

      let remaining = COUNTDOWN_SECONDS;
      const tick = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          clearInterval(tick);
          countEl.textContent = '0';
          goBtn.disabled = false;
          goBtn.textContent = 'Send Anyway';
          goBtn.focus();
        } else {
          countEl.textContent = String(remaining);
          goBtn.textContent = `Send Anyway (${remaining})`;
        }
      }, 1000);

      const onKey = (e) => {
        if (e.key === 'Escape' || e.key === 'Esc') {
          e.preventDefault(); e.stopPropagation(); close();
        }
      };
      document.addEventListener('keydown', onKey, true);

      function close() {
        clearInterval(tick);
        document.removeEventListener('keydown', onKey, true);
        overlay.remove();
        modalOpen = false;
      }
      cancelBtn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation(); close();
      });
      goBtn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (goBtn.disabled) return;
        allowOnce = true;
        close();
        try { originalButton.click(); }
        catch (err) {
          allowOnce = false;
          console.warn('[Grit] re-click send failed:', err);
        }
      });
      cancelBtn.focus();
    }
  }

  // ============================================================
  // Feature 4 — DARK PATTERN DETECTOR
  // ============================================================
  if (settings.dark_pattern) initDarkPatternDetector();

  function initDarkPatternDetector() {
    let pageCount = 0; // count of patterns flagged on THIS page

    // Push the badge value to the background service worker.
    function pushBadge() {
      try {
        chrome.runtime.sendMessage({ type: 'darkPatternCount', count: pageCount });
      } catch {}
    }

    // Highlight an element with a dotted red outline + tooltip.
    function flag(el, reason) {
      if (!el || !(el instanceof Element)) return;
      if (el.dataset.frictionFlagged) return;
      // Skip our own UI.
      if (el.closest('#friction-overlay, #friction-intent, #friction-time, #friction-send')) return;
      el.dataset.frictionFlagged = '1';
      el.style.outline = '2px dotted #dc2626';
      el.style.outlineOffset = '2px';
      const prev = el.title ? '\n\n' + el.title : '';
      el.title = `[Grit] ${reason}${prev}`;
      pageCount += 1;
      bumpStat('dark_patterns_flagged', 1);
      pushBadge();
    }

    // --- Heuristic regexes ---
    const COUNTDOWN_RE = /\b\d{1,2}:\d{2}(?::\d{2})?\b/;
    const URGENCY_RE = /\b(left|ends?|expires?|hurry|only|remaining|deal|sale|offer|countdown|in)\b/i;
    const PEOPLE_RE = /\b\d{1,4}\s+(?:people|others|users|shoppers|guests|members)\s+(?:are\s+)?(?:viewing|looking|watching|interested|browsing|considering)\b/i;
    const SHAME_RE = /\b(no\s+thanks?|i'?d\s+rather|i'?ll\s+pass|no,?\s+i)\b[^.]*\b(hate|don'?t|miss|rather|happy\s+pay|love\s+pay|prefer|enjoy|like\s+pay)/i;
    const SHAME_RE2 = /\bi\s+don'?t\s+(?:want|need|like|deserve)\s+(?:to\s+)?(?:save|win|grow|improve|succeed)/i;

    // Walk text nodes once, flagging countdowns and "X viewing" lines.
    function scanText() {
      const walker = document.createTreeWalker(
        document.body, NodeFilter.SHOW_TEXT,
        { acceptNode: (n) => {
            if (!n.nodeValue) return NodeFilter.FILTER_REJECT;
            const t = n.nodeValue.trim();
            if (!t || t.length > 200) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          } }
      );
      let n, iter = 0;
      while ((n = walker.nextNode()) && iter++ < 4000) {
        const t = n.nodeValue.trim();
        const el = n.parentElement;
        if (!el) continue;
        if (el.dataset.frictionFlagged) continue;

        // "X people viewing"
        if (PEOPLE_RE.test(t)) {
          flag(el, '"X people viewing" — often fabricated');
          continue;
        }
        // Countdown timer (short text + urgency context)
        if (t.length < 24 && COUNTDOWN_RE.test(t)) {
          const ctx = (el.parentElement && el.parentElement.innerText || '').slice(0, 200);
          if (URGENCY_RE.test(t) || URGENCY_RE.test(ctx)) {
            flag(el, 'Countdown timer — may be fake to create urgency');
            continue;
          }
        }
      }
    }

    // Pre-checked subscription / marketing checkboxes.
    function scanCheckboxes() {
      const boxes = document.querySelectorAll('input[type="checkbox"]:checked');
      boxes.forEach((cb) => {
        let label = cb.closest('label');
        let labelTxt = label ? (label.innerText || '') : '';
        if (!labelTxt && cb.id) {
          const l = document.querySelector(`label[for="${CSS.escape(cb.id)}"]`);
          if (l) labelTxt = l.innerText || '';
        }
        if (!labelTxt) return;
        if (/(subscribe|newsletter|deals?|offers?|marketing|promot|email\s+me|sign\s+me\s+up|opt[\s-]?in|mailing\s+list)/i.test(labelTxt)) {
          flag(label || cb, 'Pre-checked subscription opt-in');
        }
      });
    }

    // Confirmshaming text on opt-out links/buttons.
    function scanConfirmShaming() {
      const els = document.querySelectorAll('a, button, [role="button"], label');
      els.forEach((el) => {
        if (el.dataset.frictionFlagged) return;
        const txt = (el.innerText || '').trim();
        if (!txt || txt.length > 140) return;
        if (SHAME_RE.test(txt) || SHAME_RE2.test(txt)) {
          flag(el, 'Confirmshaming language');
        }
      });
    }

    function scan() {
      try {
        scanText();
        scanCheckboxes();
        scanConfirmShaming();
      } catch (err) {
        console.warn('[Grit] dark-pattern scan error:', err);
      }
    }

    // Initial scan after the page settles.
    setTimeout(scan, 1500);

    // Re-scan when the page mutates, debounced.
    let pending = false;
    const obs = new MutationObserver(() => {
      if (pending) return;
      pending = true;
      setTimeout(() => { pending = false; scan(); }, 1500);
    });
    if (document.body) {
      obs.observe(document.body, { childList: true, subtree: true });
    }
  }
})();
