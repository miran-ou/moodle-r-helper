// ======================================================
// 科目ページに「通知ベル」と「通知タブ」を追加する
// 通知は読み取りのみ（既読にしない・外部送信しない）
// 保存するのは科目ごとの「最後に見た時刻」だけ
// ======================================================

(() => {

  if (location.hostname !== "lms.ritsumei.ac.jp") {
    return;
  }

  const nlog = (...args) => {
    try {
      if (DEBUG) {
        console.log(...args);
      }
    } catch (e) {
      // DEBUG が未定義のときは何もしない
    }
  };

  if (typeof registerCourseTab !== "function") {
    return;
  }

  const PAGE_SIZE = 50;
  const MAX_PAGES = 1;
  const CACHE_MS = 60 * 1000;
  const DROPDOWN_COUNT = 5;


  // -------------------------
  // この科目の情報
  // -------------------------

  const titleElement =
    document.querySelector(".page-header-headings h1");

  if (!titleElement) {
    return;
  }

  const titleText = titleElement.textContent.trim();

  if (!/^\d+:/.test(titleText)) {
    return;
  }

  // 科目コード（"16955:… § 16956:…" のように複数あり得る）
  const courseCodes = new Set(
    [...titleText.matchAll(/(?:^|\s)(\d+):/g)].map((m) => m[1])
  );

  // Moodle内部のコースID（科目コードとは別物）
  function getCourseId() {

    const m =
      document.body.className.match(/(?:^|\s)course-(\d+)(?:\s|$)/);

    if (m) {
      return m[1];
    }

    const id = new URLSearchParams(location.search).get("id");

    return /^\d+$/.test(id || "") ? id : "";
  }

  const courseId = getCourseId();

  const seenKey =
    "notify_seen_" + (courseId || [...courseCodes][0]);

  nlog("通知: 科目コード", [...courseCodes], "courseId", courseId);


  // -------------------------
  // sesskey / userid
  // -------------------------

  function getSesskey() {

    const a =
      document.querySelector('a[href*="logout.php?sesskey="]');

    const m = a && a.href.match(/sesskey=(\w+)/);

    return m ? m[1] : "";
  }

  function getUserId() {

    const popover =
      document.querySelector("#nav-notification-popover-container");

    if (popover && popover.dataset.userid) {
      return popover.dataset.userid;
    }

    const profile =
      document.querySelector('.usermenu a[href*="/user/profile.php?id="]');

    const m = profile && profile.href.match(/profile\.php\?id=(\d+)/);

    if (m) {
      return m[1];
    }

    const any = document.querySelector("[data-userid]");

    return any ? any.dataset.userid : "";
  }


  // -------------------------
  // 通知の取得
  // -------------------------

  async function fetchNotifications(sesskey, userid, limit, offset) {

    const res = await fetch(
      `/lib/ajax/service.php?sesskey=${sesskey}&info=message_popup_get_popup_notifications`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{
          index: 0,
          methodname: "message_popup_get_popup_notifications",
          args: {
            useridto: Number(userid),
            newestfirst: true,
            limit: limit,
            offset: offset
          }
        }])
      }
    );

    if (!res.ok) {
      throw new Error("HTTP " + res.status);
    }

    const json = await res.json();

    if (json[0] && json[0].error) {
      throw new Error("api_error");
    }

    return (json[0] && json[0].data && json[0].data.notifications) || [];
  }


  // -------------------------
  // 振り分け
  // -------------------------

  function parseJson(value) {

    if (!value) {
      return null;
    }

    if (typeof value === "object") {
      return value;
    }

    try {
      return JSON.parse(value);
    } catch (e) {
      return null;
    }
  }

  function getCmid(url) {

    if (!url) {
      return "";
    }

    try {

      const u = new URL(url, location.origin);

      if (!/\/mod\/[^/]+\/view\.php$/.test(u.pathname)) {
        return "";
      }

      return u.searchParams.get("id") || "";

    } catch (e) {
      return "";
    }
  }

  // このコースの活動ID一覧（本文とコース目次のリンクだけから集める）
  function collectCmids() {

    const ids = new Set();

    document
      .querySelectorAll(
        '#region-main a[href*="/mod/"], .courseindex a[href*="/mod/"]'
      )
      .forEach((a) => {

        if (a.closest(".my-course-panel")) {
          return;
        }

        const id = getCmid(a.href);

        if (id) {
          ids.add(id);
        }
      });

    document
      .querySelectorAll("#region-main [data-for='cmitem'][data-id]")
      .forEach((el) => {
        ids.add(el.dataset.id);
      });

    return ids;
  }

  // 目次の活動リンクが描画されるまで最大5秒待つ
  async function waitForCmids() {

    const deadline = Date.now() + 5000;

    let ids = collectCmids();

    while (ids.size === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      ids = collectCmids();
    }

    nlog("このコースの活動ID数:", ids.size);

    return ids;
  }

  // match: true=この科目 / false=別の科目 / null=判定不能
  function classify(n, cmids) {

    // ① customdata の courseid
    const data = parseJson(n.customdata);

    if (data && data.courseid != null && courseId) {
      return {
        match: String(data.courseid) === courseId,
        by: "courseid"
      };
    }

    // ② contexturl の活動ID
    //    目次に有る → この科目 / 無い → 別の科目
    //    （目次を読み取れなかった場合は判断せず、次の手がかりへ）
    const cmid = getCmid(n.contexturl);

    if (cmid && cmids.size > 0) {
      return { match: cmids.has(cmid), by: "cmid" };
    }

    // ③ 件名の (年度-科目コード-連番_種別)
    const s = String(n.subject || "").match(/\(\d{4}-(\d+)-\d+_/);

    if (s) {
      return { match: courseCodes.has(s[1]), by: "code" };
    }

    return { match: null, by: "" };
  }


  // -------------------------
  // 状態
  // -------------------------

  const state = {
    mine: [],
    unknown: [],
    total: 0,
    loaded: false,
    loading: null,
    failed: false,
    fetchedAt: 0
  };

  // 「最後に見た時刻」（秒）。null は未記録
  let seenAt = null;
  let seenReady = null;

  function nowSec() {
    return Math.floor(Date.now() / 1000);
  }

  function loadSeen() {

    if (seenReady) {
      return seenReady;
    }

    seenReady = new Promise((resolve) => {

      try {

        chrome.storage.local.get(seenKey, (result) => {

          const v = result && result[seenKey];

          if (typeof v === "number") {
            seenAt = v;
          } else {
            // 初回は件数を出さず、時刻だけ記録する
            seenAt = nowSec();
            chrome.storage.local.set({ [seenKey]: seenAt });
          }

          resolve();
        });

      } catch (e) {

        seenAt = nowSec();
        resolve();
      }
    });

    return seenReady;
  }

  function markSeen() {

    seenAt = nowSec();

    try {
      chrome.storage.local.set({ [seenKey]: seenAt });
    } catch (e) {
      // 保存できなくても表示は続ける
    }

    updateBadge();
  }

  function newCount() {

    if (seenAt === null) {
      return 0;
    }

    return state.mine.filter((n) => n.timecreated > seenAt).length;
  }


  // -------------------------
  // 取得 + 振り分け
  // -------------------------

  function load(force = false) {

    if (state.loading) {
      return state.loading;
    }

    // 60秒以内なら取得し直さず、前回の結果を使う
    if (
      !force &&
      (state.loaded || state.failed) &&
      Date.now() - state.fetchedAt < CACHE_MS
    ) {
      return Promise.resolve();
    }

    state.loading = (async () => {

      try {

        await loadSeen();

        const sesskey = getSesskey();
        const userid = getUserId();

        if (!sesskey || !userid) {
          throw new Error("sesskey/userid not found");
        }

        const all = [];

        for (let page = 0; page < MAX_PAGES; page++) {

          const part = await fetchNotifications(
            sesskey, userid, PAGE_SIZE, page * PAGE_SIZE
          );

          all.push(...part);

          if (part.length < PAGE_SIZE) {
            break;
          }
        }

        const cmids = await waitForCmids();

        const mine = [];
        const unknown = [];

        for (const n of all) {

          // 科目が分からず不要な定型通知は、振り分けずに無視する
          if (/7日以内に提出する必要のある課題/.test(n.subject || "")) {
            continue;
          }

          const result = classify(n, cmids);

          nlog("通知の振り分け:", n.subject, result);

          if (result.match === true) {
            mine.push(n);
          } else if (result.match === null) {
            unknown.push(n);
          }
        }

        state.mine = mine;
        state.unknown = unknown;
        state.total = all.length;
        state.loaded = true;
        state.failed = false;

      } catch (e) {

        nlog("通知の取得に失敗:", e);
        state.failed = true;

      } finally {

        state.fetchedAt = Date.now();
        state.loading = null;
        updateBadge();
      }
    })();

    return state.loading;
  }


  // -------------------------
  // 表示の部品
  // -------------------------

  function safeUrl(url) {

    if (!url) {
      return "";
    }

    try {

      const u = new URL(url, location.origin);

      return u.origin === location.origin ? u.href : "";

    } catch (e) {
      return "";
    }
  }

  function formatTime(sec) {

    if (!sec) {
      return "";
    }

    return new Date(sec * 1000).toLocaleString(
      "ja-JP",
      { dateStyle: "medium", timeStyle: "short" }
    );
  }

  function createItem(n, since) {

    const li = document.createElement("li");
    li.style.padding = "10px 0";
    li.style.borderBottom = "1px solid #eee";

    const subject =
      String(n.subject || "").replace(/^\[Moodle-Reminder\]\s*/, "");

    const url = safeUrl(n.contexturl);

    let titleEl;

    if (url) {
      titleEl = document.createElement("a");
      titleEl.href = url;
      titleEl.target = "_blank";
      titleEl.rel = "noopener noreferrer";
    } else {
      titleEl = document.createElement("span");
    }

    titleEl.textContent = subject;

    li.appendChild(titleEl);

    if (since !== null && n.timecreated > since) {

      const badge = document.createElement("span");
      badge.textContent = "新着";
      badge.style.marginLeft = "8px";
      badge.style.padding = "1px 6px";
      badge.style.borderRadius = "3px";
      badge.style.background = "#c62828";
      badge.style.color = "#fff";
      badge.style.fontSize = "0.75em";

      li.appendChild(badge);
    }

    const time = document.createElement("div");
    time.style.fontSize = "0.85em";
    time.style.color = "#6c757d";
    time.textContent = formatTime(n.timecreated);

    li.appendChild(time);

    return li;
  }

  function createList(items, since) {

    const ul = document.createElement("ul");
    ul.style.listStyle = "none";
    ul.style.padding = "0";
    ul.style.margin = "0";

    items.forEach((n) => ul.appendChild(createItem(n, since)));

    return ul;
  }


  // -------------------------
  // 通知タブ
  // -------------------------

  const panel = document.createElement("div");
  panel.className = "my-notify-panel";
  panel.style.marginTop = "20px";
  panel.style.padding = "20px";
  panel.style.border = "1px solid #ddd";
  panel.style.borderRadius = "5px";

  const head = document.createElement("div");
  head.style.display = "flex";
  head.style.justifyContent = "space-between";
  head.style.alignItems = "center";

  const heading = document.createElement("h3");
  heading.textContent = "この科目の通知";

  const reload = document.createElement("button");
  reload.type = "button";
  reload.className = "btn btn-secondary btn-sm";
  reload.textContent = "更新";

  head.appendChild(heading);
  head.appendChild(reload);

  const body = document.createElement("div");
  body.style.marginTop = "12px";

  panel.appendChild(head);
  panel.appendChild(body);

  function renderTab(since) {

    body.textContent = "";

    if (state.failed && !state.loaded) {
      body.textContent = "通知を取得できませんでした。";
      return;
    }

    const summary = document.createElement("p");
    summary.style.color = "#6c757d";
    summary.textContent =
      `直近${state.total}件の通知のうち、この科目の通知は` +
      `${state.mine.length}件です。`;

    body.appendChild(summary);

    if (state.mine.length === 0) {

      const p = document.createElement("p");
      p.textContent = "この科目の通知は見つかりませんでした。";
      body.appendChild(p);

    } else {

      body.appendChild(createList(state.mine, since));
    }

    if (state.unknown.length > 0) {

      const details = document.createElement("details");
      details.style.marginTop = "20px";

      const sum = document.createElement("summary");
      sum.textContent =
        `科目を判定できなかった通知（${state.unknown.length}件）`;

      details.appendChild(sum);
      details.appendChild(createList(state.unknown, null));

      body.appendChild(details);
    }
  }

  async function refreshTab(force = false) {

    body.textContent = "通知を取得しています…";

    await load(force === true);

    const since = seenAt;

    renderTab(since);
    markSeen();
  }

  reload.addEventListener("click", () => refreshTab(true));

  registerCourseTab({
    id: "notify",
    label: "通知",
    order: 20,
    panel: panel,
    onShow: () => refreshTab(false)
  });

  function openNotifyTab() {

    const link =
      document.querySelector('[data-my-tab="notify"] a');

    if (link) {
      link.click();
    }
  }


  // -------------------------
  // ベル
  // -------------------------

  function injectBellStyle() {

    if (document.querySelector("#my-bell-style")) {
      return;
    }

    const style = document.createElement("style");
    style.id = "my-bell-style";
    style.textContent = `
      .my-bell-wrap {
        position: relative;
        display: inline-flex;
        align-items: center;
        margin-right: 4px;
      }
      .my-bell-button {
        position: relative;
        display: inline-flex;
        align-items: center;
        padding: 8px;
        border: 0;
        background: transparent;
        color: inherit;
        cursor: pointer;
        line-height: 1;
      }
      .my-bell-button svg {
        width: 22px;
        height: 22px;
        fill: currentColor;
      }
      .my-bell-badge {
        position: absolute;
        top: 2px;
        right: 0;
        min-width: 16px;
        padding: 1px 4px;
        border-radius: 3px;
        background: #c62828;
        color: #fff;
        font-size: 11px;
        font-weight: bold;
        line-height: 14px;
        text-align: center;
      }
      .my-bell-dropdown {
        position: fixed;
        z-index: 10000;
        width: 360px;
        max-width: calc(100vw - 16px);
        max-height: 70vh;
        overflow-y: auto;
        padding: 12px 16px;
        background: #fff;
        color: #212529;
        border: 1px solid #ddd;
        border-radius: 6px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
      }
    `;

    document.head.appendChild(style);
  }

  function createBellIcon() {

    const ns = "http://www.w3.org/2000/svg";

    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");

    const path = document.createElementNS(ns, "path");
    path.setAttribute(
      "d",
      "M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"
    );

    svg.appendChild(path);

    return svg;
  }

  const bellWrap = document.createElement("div");
  bellWrap.className = "my-bell-wrap";

  const bellButton = document.createElement("button");
  bellButton.type = "button";
  bellButton.className = "my-bell-button";
  bellButton.title = "この科目の通知";
  bellButton.setAttribute("aria-label", "この科目の通知");
  bellButton.appendChild(createBellIcon());

  const bellBadge = document.createElement("span");
  bellBadge.className = "my-bell-badge";
  bellBadge.style.display = "none";

  bellButton.appendChild(bellBadge);
  bellWrap.appendChild(bellButton);

  const dropdown = document.createElement("div");
  dropdown.className = "my-bell-dropdown";
  dropdown.style.display = "none";

  document.body.appendChild(dropdown);

  function updateBadge() {

    const count = newCount();

    if (count > 0) {
      bellBadge.textContent = count > 99 ? "99+" : String(count);
      bellBadge.style.display = "block";
    } else {
      bellBadge.style.display = "none";
    }
  }

  function placeDropdown() {

    const rect = bellButton.getBoundingClientRect();

    const width = Math.min(360, window.innerWidth - 16);
    const left = Math.max(8, Math.min(
      rect.right - width,
      window.innerWidth - width - 8
    ));

    dropdown.style.top = rect.bottom + 6 + "px";
    dropdown.style.left = left + "px";
  }

  function closeDropdown() {
    dropdown.style.display = "none";
  }

  function renderDropdown(since) {

    dropdown.textContent = "";

    const title = document.createElement("div");
    title.style.fontWeight = "bold";
    title.style.marginBottom = "4px";
    title.textContent = "この科目の通知";
    dropdown.appendChild(title);

    if (state.failed && !state.loaded) {

      const p = document.createElement("p");
      p.textContent = "通知を取得できませんでした。";
      dropdown.appendChild(p);

      return;
    }

    if (state.mine.length === 0) {

      const p = document.createElement("p");
      p.style.margin = "8px 0";
      p.textContent = "この科目の通知はありません。";
      dropdown.appendChild(p);

    } else {

      dropdown.appendChild(
        createList(state.mine.slice(0, DROPDOWN_COUNT), since)
      );
    }

    const more = document.createElement("a");
    more.href = "#";
    more.textContent = "すべて見る";
    more.style.display = "block";
    more.style.marginTop = "10px";
    more.style.textAlign = "center";

    more.addEventListener("click", (event) => {
      event.preventDefault();
      closeDropdown();
      openNotifyTab();
    });

    dropdown.appendChild(more);
  }

  bellButton.addEventListener("click", async (event) => {

    event.stopPropagation();

    if (dropdown.style.display !== "none") {
      closeDropdown();
      return;
    }

    placeDropdown();

    dropdown.textContent = "通知を取得しています…";
    dropdown.style.display = "block";

    await load();

    const since = seenAt;

    renderDropdown(since);
    placeDropdown();
    markSeen();
  });

  dropdown.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  document.addEventListener("click", closeDropdown);

  window.addEventListener("resize", () => {
    if (dropdown.style.display !== "none") {
      placeDropdown();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeDropdown();
    }
  });

  function insertBell() {

    injectBellStyle();

    const anchor =
      document.querySelector("#nav-notification-popover-container");

    if (anchor && anchor.parentElement) {

      anchor.parentElement.insertBefore(bellWrap, anchor);
      return true;
    }

    return false;
  }

  if (!insertBell()) {

    // ベルの置き場所が見つからない場合は右上に固定表示
    injectBellStyle();

    bellWrap.style.position = "fixed";
    bellWrap.style.top = "12px";
    bellWrap.style.right = "16px";
    bellWrap.style.zIndex = "9999";

    document.body.appendChild(bellWrap);
  }

  // ページを開いたときに1回取得してバッジを出す
  load();

})();