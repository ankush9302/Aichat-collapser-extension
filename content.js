// ============================================================
// Chat Collapser - Content Script
// Collapses AI responses in chat threads, keeping user messages visible.
// Supports: claude.ai, chatgpt.com, chat.openai.com
// ============================================================

(function () {
  "use strict";

  const VISIBLE_RECENT_PAIRS = 2;
  const DEBOUNCE_MS = 500;
  const DEBUG = true;

  function log(...args) {
    if (DEBUG) console.log("[Chat Collapser]", ...args);
  }

  log("Script loaded at", window.location.href);

  // ============================================================
  // 1. Platform Detection
  // ============================================================

  function detectPlatform() {
    const host = window.location.hostname;
    if (host.includes("claude.ai")) return "claude";
    if (host.includes("chatgpt.com") || host.includes("chat.openai.com"))
      return "chatgpt";
    return null;
  }

  const PLATFORM = detectPlatform();
  if (!PLATFORM) return;
  log("Platform detected:", PLATFORM);

  // ============================================================
  // 2. Guard flag to prevent MutationObserver infinite loop
  // ============================================================

  let isProcessing = false;

  // ============================================================
  // 3. Find conversation pairs (platform-specific)
  // ============================================================
  //
  // Claude.ai DOM structure (discovered via inspection):
  //
  //   div.conversation-container
  //     ├── div[data-test-render-count]   ← Turn wrapper: USER
  //     │     └── div.mb-1.mt-6.group
  //     │           └── ...bubble... → div[data-testid="user-message"]
  //     │
  //     ├── div[data-test-render-count]   ← Turn wrapper: AI RESPONSE
  //     │     └── ... (no data-testid="user-message" inside)
  //     │
  //     ├── div[data-test-render-count]   ← Turn wrapper: USER
  //     ├── div[data-test-render-count]   ← Turn wrapper: AI RESPONSE
  //     ...
  //
  // Strategy:
  //   1. Select ALL turn wrappers: div[data-test-render-count]
  //   2. A turn is a "user turn" if it contains [data-testid="user-message"]
  //   3. The next sibling turn is the AI response
  //   4. We only collapse the AI response div, user turn stays visible

  function findPairsClaude() {
    // Step 1: Get all turn wrapper divs
    const allTurns = Array.from(
      document.querySelectorAll("div[data-test-render-count]")
    );

    if (allTurns.length < 2) {
      log("Not enough turns found:", allTurns.length);
      return [];
    }

    const pairs = [];
  
    // Step 2: Walk through turns and pair user turns with their AI responses
    for (let i = 0; i < allTurns.length; i++) {
      const turn = allTurns[i];
      const isUserTurn = !!turn.querySelector('[data-testid="user-message"]');

      if (isUserTurn && i + 1 < allTurns.length) {
        const nextTurn = allTurns[i + 1];
        const nextIsUser = !!nextTurn.querySelector('[data-testid="user-message"]');

        if (!nextIsUser) {
          // This is a valid pair: user turn + AI response
          pairs.push({
            index: pairs.length,
            userTurn: turn,
            aiResponse: nextTurn,
          });
          i++; // Skip the AI response turn, move to next user turn
        }
        // If next is also a user turn, skip (user sent multiple messages)
      }
    }
    log(`Found ${pairs.length} user→AI pairs out of ${allTurns.length} total turns`);

    return pairs;
  }

  function findPairsChatGPT() {
    // ChatGPT uses article[data-testid="conversation-turn-N"]
    // or similar turn containers
    const turns = document.querySelectorAll(
      'article[data-testid^="conversation-turn"], [data-testid^="conversation-turn"]'
    );

    if (turns.length === 0) {
      // Fallback: try article tags
      const articles = document.querySelectorAll("main article");
      return groupArticlesIntoPairs(Array.from(articles));
    }

    return groupArticlesIntoPairs(Array.from(turns));
  }

  function groupArticlesIntoPairs(turns) {
    // ChatGPT alternates: user turn, assistant turn, user turn, ...
    const pairs = [];
    for (let i = 0; i < turns.length; i += 2) {
      if (i + 1 < turns.length) {
        pairs.push({
          index: pairs.length,
          userTurn: turns[i],
          aiResponse: turns[i + 1],
        });
      }
    }
    return pairs;
  }

  function findPairs() {
    if (PLATFORM === "claude") return findPairsClaude();
    if (PLATFORM === "chatgpt") return findPairsChatGPT();
    return [];
  }

  // ============================================================
  // 4. Collapse/Expand state
  // ============================================================

  const collapsedState = new Map();

  function setCollapsed(pair, collapsed) {
    collapsedState.set(pair.index, collapsed);

    // Only hide the AI response, user message stays visible
    if (pair.aiResponse) {
      pair.aiResponse.style.display = collapsed ? "none" : "";
    }

    const btn = document.getElementById(`cc-btn-${pair.index}`);
    if (btn) {
      btn.setAttribute("data-collapsed", collapsed ? "true" : "false");
      btn.querySelector(".cc-label").textContent = collapsed
        ? "Response collapsed (click to expand)"
        : "Collapse response";
    }
    updateCounter();
    saveState();
  }

  // ============================================================
  // 5. Toggle button creation
  // ============================================================

  function createToggleButton(pair, isCollapsed) {
    const id = `cc-btn-${pair.index}`;
    const existing = document.getElementById(id);
    if (existing) return existing;

    const btn = document.createElement("button");
    btn.className = "cc-toggle-btn";
    btn.id = id;
    btn.setAttribute("data-pair-index", pair.index);
    btn.setAttribute("data-collapsed", isCollapsed ? "true" : "false");
    btn.title = "Toggle AI response visibility";

    const arrow = document.createElement("span");
    arrow.className = "cc-arrow";
    arrow.textContent = "\u25BC";

    const label = document.createElement("span");
    label.className = "cc-label";
    label.textContent = isCollapsed
      ? "Response collapsed (click to expand)"
      : "Collapse response";

    btn.appendChild(arrow);
    btn.appendChild(label);

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const currentlyCollapsed = collapsedState.get(pair.index);
      setCollapsed(pair, !currentlyCollapsed);
    });

    return btn;
  }

  // ============================================================
  // 6. Toolbar
  // ============================================================

  let toolbar = null;

  function createToolbar() {
    if (document.getElementById("cc-toolbar")) {
      toolbar = document.getElementById("cc-toolbar");
      return toolbar;
    }

    toolbar = document.createElement("div");
    toolbar.className = "cc-toolbar";
    toolbar.id = "cc-toolbar";

    const collapseAllBtn = document.createElement("button");
    collapseAllBtn.textContent = "Collapse All";
    collapseAllBtn.addEventListener("click", () => {
      findPairs().forEach((pair) => setCollapsed(pair, true));
    });

    const expandAllBtn = document.createElement("button");
    expandAllBtn.textContent = "Expand All";
    expandAllBtn.addEventListener("click", () => {
      findPairs().forEach((pair) => setCollapsed(pair, false));
    });

    const counter = document.createElement("span");
    counter.className = "cc-counter";
    counter.id = "cc-counter";

    toolbar.appendChild(collapseAllBtn);
    toolbar.appendChild(expandAllBtn);
    toolbar.appendChild(counter);

    document.body.appendChild(toolbar);
    log("Toolbar created");
    return toolbar;
  }

  function updateCounter() {
    const counter = document.getElementById("cc-counter");
    if (!counter) return;
    const total = collapsedState.size;
    let collapsed = 0;
    collapsedState.forEach((v) => { if (v) collapsed++; });
    counter.textContent = collapsed > 0
      ? `${collapsed}/${total} collapsed`
      : `${total} responses`;
  }

  // ============================================================
  // 7. State persistence
  // ============================================================

  function getStorageKey() {
    return `cc-state-${window.location.pathname}`;
  }

  function saveState() {
    const obj = {};
    collapsedState.forEach((val, idx) => { obj[idx] = val; });
    try {
      chrome.storage.local.set({ [getStorageKey()]: obj });
    } catch {}
  }

  function loadState(callback) {
    try {
      chrome.storage.local.get(getStorageKey(), (result) => {
        const saved = result[getStorageKey()];
        if (saved) {
          Object.entries(saved).forEach(([idx, val]) => {
            collapsedState.set(parseInt(idx), val);
          });
        }
        callback();
      });
    } catch {
      callback();
    }
  }

  // ============================================================
  // 8. Main processing (with re-entry guard)
  // ============================================================

  let lastPairCount = 0;

  function processMessages() {
    if (isProcessing) return;
    isProcessing = true;

    try {
      const pairs = findPairs();

      if (pairs.length === 0) {
        if (toolbar) toolbar.style.display = "none";
        return;
      }

      if (pairs.length !== lastPairCount) {
        log(`Pair count changed: ${lastPairCount} → ${pairs.length}`);
        lastPairCount = pairs.length;
      }

      createToolbar();
      toolbar.style.display = "flex";

      pairs.forEach((pair) => {
        // Determine collapse state
        let shouldCollapse;
        if (collapsedState.has(pair.index)) {
          shouldCollapse = collapsedState.get(pair.index);
        } else {
          const isRecent = pair.index >= pairs.length - VISIBLE_RECENT_PAIRS;
          shouldCollapse = !isRecent;
          collapsedState.set(pair.index, shouldCollapse);
        }

        // Insert toggle button between user turn and AI response
        const btn = createToggleButton(pair, shouldCollapse);
        if (!btn.parentNode && pair.aiResponse.parentNode) {
          pair.aiResponse.parentNode.insertBefore(btn, pair.aiResponse);
        }

        // Apply visibility — only collapse the AI response
        pair.aiResponse.style.display = shouldCollapse ? "none" : "";
      });

      updateCounter();
      saveState();
    } finally {
      setTimeout(() => { isProcessing = false; }, 100);
    }
  }

  // ============================================================
  // 9. MutationObserver
  // ============================================================

  let debounceTimer = null;

  function debouncedProcess() {
    if (isProcessing) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(processMessages, DEBOUNCE_MS);
  }

  function startObserving() {
    const observer = new MutationObserver((mutations) => {
      if (isProcessing) return;
      const relevant = mutations.some((m) => {
        if (m.target.closest && (
          m.target.closest(".cc-toolbar") ||
          m.target.closest(".cc-toggle-btn")
        )) return false;
        return m.addedNodes.length > 0 || m.removedNodes.length > 0;
      });
      if (relevant) debouncedProcess();
    });

    observer.observe(document.body, { childList: true, subtree: true });
    log("MutationObserver started");
  }

  // ============================================================
  // 10. Keyboard shortcuts (Alt+C / Alt+E)
  // ============================================================

  document.addEventListener("keydown", (e) => {
    if (
      e.target.tagName === "INPUT" ||
      e.target.tagName === "TEXTAREA" ||
      e.target.isContentEditable
    ) return;

    if (e.altKey && e.key === "c") {
      e.preventDefault();
      findPairs().forEach((p) => setCollapsed(p, true));
    } else if (e.altKey && e.key === "e") {
      e.preventDefault();
      findPairs().forEach((p) => setCollapsed(p, false));
    }
  });

  // ============================================================
  // 11. SPA navigation detection
  // ============================================================

  let lastUrl = window.location.href;

  function watchForUrlChanges() {
    setInterval(() => {
      if (window.location.href !== lastUrl) {
        log("URL changed → re-processing");
        lastUrl = window.location.href;
        collapsedState.clear();
        lastPairCount = 0;
        document.querySelectorAll(".cc-toggle-btn").forEach((b) => b.remove());
        loadState(() => setTimeout(processMessages, 800));
      }
    }, 1000);
  }

  // ============================================================
  // 12. Init
  // ============================================================

  function init() {
    log("=== INITIALIZING ===");

    loadState(() => {
      processMessages();
      setTimeout(processMessages, 2000);
      startObserving();
      watchForUrlChanges();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
