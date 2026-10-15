// ======================================================
// 予定カレンダー
//  - ダッシュボード: 既存のカレンダーブロックを隠して置き換える
//  - 科目ページ: 「予定」タブで、その科目の予定だけを表示する
// 予定は Moodle 自身のAPIから読み取るだけ（保存・外部送信はしない）
// ======================================================

(() => {

  if (location.hostname !== "lms.ritsumei.ac.jp") {
    return;
  }

  const clog = (...args) => {
    try {
      if (DEBUG) {
        console.log(...args);
      }
    } catch (e) {
      // DEBUG が未定義のときは何もしない
    }
  };

  const CACHE_MS = 60 * 1000;
  const PAGE_LIMIT = 50;
  const MAX_PAGES = 3;
  const LIST_PAST_DAYS = 7;
  const LIST_FUTURE_DAYS = 14;
  const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

  const isDashboard =
    document.body.id === "page-my-index" ||
    location.pathname.replace(/\/$/, "") === "/my";

  const titleElement =
    document.querySelector(".page-header-headings h1");

  const isCoursePage =
    !isDashboard &&
    !!titleElement &&
    /^\d+:/.test(titleElement.textContent.trim());

  if (!isDashboard && !isCoursePage) {
    return;
  }


  // -------------------------
  // 日付の補助
  // -------------------------

  const nowSec = () => Math.floor(Date.now() / 1000);

  function monthStartSec(offset) {

    const d = new Date();

    return Math.floor(
      new Date(d.getFullYear(), d.getMonth() + offset, 1).getTime() / 1000
    );
  }

  const rangeFrom =
    Math.min(monthStartSec(0), nowSec() - LIST_PAST_DAYS * 86400);

  const rangeTo = monthStartSec(4);

  function monthIndex(date) {
    return date.getFullYear() * 12 + date.getMonth();
  }

  function dayKey(date) {
    return date.getFullYear() + "-" + date.getMonth() + "-" + date.getDate();
  }

  function formatClock(sec) {

    return new Date(sec * 1000).toLocaleTimeString(
      "ja-JP",
      { hour: "2-digit", minute: "2-digit" }
    );
  }

  function formatDay(date) {

    return (
      (date.getMonth() + 1) + "月" +
      date.getDate() + "日(" +
      WEEKDAYS[date.getDay()] + ")"
    );
  }


  // -------------------------
  // sesskey / コースID
  // -------------------------

  function getSesskey() {

    const a =
      document.querySelector('a[href*="logout.php?sesskey="]');

    const m = a && a.href.match(/sesskey=(\w+)/);

    return m ? m[1] : "";
  }

  function getCourseId() {

    const m =
      document.body.className.match(/(?:^|\s)course-(\d+)(?:\s|$)/);

    if (m) {
      return m[1];
    }

    const id = new URLSearchParams(location.search).get("id");

    return /^\d+$/.test(id || "") ? id : "";
  }

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


  // -------------------------
  // 予定の取得（Moodle自身のAPI・読み取りのみ）
  // -------------------------

  const cache = {
    events: [],
    loaded: false,
    failed: false,
    loading: null,
    fetchedAt: 0
  };

  async function fetchPage(sesskey, afterId) {

    const args = {
      timesortfrom: rangeFrom,
      timesortto: rangeTo,
      limitnum: PAGE_LIMIT
    };

    if (afterId) {
      args.aftereventid = afterId;
    }

    const res = await fetch(
      `/lib/ajax/service.php?sesskey=${sesskey}&info=core_calendar_get_action_events_by_timesort`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{
          index: 0,
          methodname: "core_calendar_get_action_events_by_timesort",
          args: args
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

    return (json[0] && json[0].data && json[0].data.events) || [];
  }

  function normalize(e) {

    const course = e.course || {};
    const fullname = String(course.fullname || "");

    return {
      id: e.id,
      name: String(e.name || ""),
      time: e.timesort || e.timestart || 0,
      type: String(e.eventtype || ""),
      courseId: course.id != null ? String(course.id) : "",
      courseName: fullname.replace(/^\d+:/, ""),
      url: safeUrl(e.url || (e.action && e.action.url))
    };
  }

  function loadEvents(force) {

    if (cache.loading) {
      return cache.loading;
    }

    if (
      !force &&
      (cache.loaded || cache.failed) &&
      Date.now() - cache.fetchedAt < CACHE_MS
    ) {
      return Promise.resolve();
    }

    cache.loading = (async () => {

      try {

        const sesskey = getSesskey();

        if (!sesskey) {
          throw new Error("sesskey not found");
        }

        const all = [];
        const seen = new Set();
        let afterId = 0;

        for (let page = 0; page < MAX_PAGES; page++) {

          const part = await fetchPage(sesskey, afterId);

          for (const e of part) {

            if (!seen.has(e.id)) {
              seen.add(e.id);
              all.push(normalize(e));
            }
          }

          if (part.length < PAGE_LIMIT) {
            break;
          }

          afterId = part[part.length - 1].id;
        }

        all.sort((a, b) => a.time - b.time || a.id - b.id);

        cache.events = all;
        cache.loaded = true;
        cache.failed = false;

        clog("予定を取得:", all.length);

      } catch (e) {

        clog("予定の取得に失敗:", e);
        cache.failed = true;

      } finally {

        cache.fetchedAt = Date.now();
        cache.loading = null;
      }
    })();

    return cache.loading;
  }


  // -------------------------
  // 見た目
  // -------------------------

  function injectStyle() {

    if (document.querySelector("#my-cal-style")) {
      return;
    }

    const style = document.createElement("style");
    style.id = "my-cal-style";
    style.textContent = `
      .my-cal { font-size: 14px; }
      .my-cal-head {
        display: flex; align-items: center; justify-content: space-between;
        gap: 8px; flex-wrap: wrap; margin-bottom: 10px;
      }
      .my-cal-head h3 { margin: 0; font-size: 1.15rem; }
      .my-cal-tools { display: flex; gap: 6px; }
      .my-cal-btn {
        border: 1px solid #ced4da; background: #fff; color: inherit;
        border-radius: 4px; padding: 3px 10px; cursor: pointer; font-size: 12px;
      }
      .my-cal-btn:disabled { opacity: 0.4; cursor: default; }
      .my-cal-btn.active { background: #495057; color: #fff; border-color: #495057; }
      .my-cal-day-h { font-weight: bold; margin: 14px 0 6px; font-size: 13px; color: #495057; }
      .my-cal-day-h.today { color: #c62828; }
      .my-cal-item { border-left: 4px solid; border-radius: 4px; padding: 6px 10px; margin-bottom: 6px; }
      .my-cal-title { font-weight: bold; }
      .my-cal-meta { font-size: 12px; color: #6c757d; }
      .my-cal-tag {
        display: inline-block; padding: 0 6px; border-radius: 3px;
        font-size: 11px; margin-left: 6px; color: #fff;
      }
      .my-cal-nav { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
      .my-cal-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 2px; }
      .my-cal-wd { text-align: center; font-size: 12px; color: #6c757d; padding: 2px 0; }
      .my-cal-cell {
        display: block; width: 100%; min-height: 64px; padding: 2px; text-align: left;
        border: 1px solid #e9ecef; border-radius: 4px; background: #fff;
        color: inherit; cursor: pointer; overflow: hidden;
      }
      .my-cal-cell.out { background: #f8f9fa; color: #adb5bd; }
      .my-cal-cell.sel { outline: 2px solid #495057; }
      .my-cal-num { display: inline-block; min-width: 18px; text-align: center; font-size: 11px; }
      .my-cal-cell.today .my-cal-num { background: #c62828; color: #fff; border-radius: 9px; }
      .my-cal-chip {
        display: block; margin-top: 2px; padding: 0 3px; border-radius: 2px;
        font-size: 10px; line-height: 1.3;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .my-cal-more { font-size: 10px; color: #6c757d; }
      .my-cal-note { font-size: 12px; color: #6c757d; margin-top: 10px; }
    `;

    document.head.appendChild(style);
  }

  function h(tag, className, text) {

    const e = document.createElement(tag);

    if (className) {
      e.className = className;
    }

    if (text != null) {
      e.textContent = text;
    }

    return e;
  }

  function makeButton(label) {

    const b = h("button", "my-cal-btn", label);
    b.type = "button";

    return b;
  }

  function hueOf(courseId) {

    const n = parseInt(courseId, 10);

    return Number.isFinite(n) ? (n * 47) % 360 : 210;
  }

  const TYPE_LABELS = {
    due: "提出期限",
    close: "受験期間終了",
    open: "公開",
    gradingdue: "採点期限",
    expectcompletionon: "完了期限"
  };

  function urgency(time) {

    const diff = time - nowSec();

    if (diff < 0) {
      return { label: "期限超過", color: "#6c757d" };
    }

    if (diff < 86400) {
      return { label: "24時間以内", color: "#c62828" };
    }

    if (diff < 3 * 86400) {
      return { label: "3日以内", color: "#e65100" };
    }

    return null;
  }

  function createEvent(e, showCourse) {

    const hue = hueOf(e.courseId);

    const box = h("div", "my-cal-item");
    box.style.borderLeftColor = `hsl(${hue}, 55%, 45%)`;
    box.style.background = `hsl(${hue}, 70%, 96%)`;

    const meta = h("div", "my-cal-meta");
    meta.textContent = formatClock(e.time);

    const typeLabel = TYPE_LABELS[e.type];

    if (typeLabel) {
      meta.textContent += "　" + typeLabel;
    }

    const u = urgency(e.time);

    if (u) {
      const tag = h("span", "my-cal-tag", u.label);
      tag.style.background = u.color;
      meta.appendChild(tag);
    }

    box.appendChild(meta);

    const title = h("div", "my-cal-title");

    if (e.url) {

      const a = h("a", null, e.name);
      a.href = e.url;
      title.appendChild(a);

    } else {

      title.textContent = e.name;
    }

    box.appendChild(title);

    if (showCourse && e.courseName) {
      box.appendChild(h("div", "my-cal-meta", e.courseName));
    }

    return box;
  }


  // -------------------------
  // カレンダー本体
  // -------------------------

  function createWidget({ title, courseId }) {

    injectStyle();

    const root = h("div", "my-cal");

    const head = h("div", "my-cal-head");
    head.appendChild(h("h3", null, title));

    const tools = h("div", "my-cal-tools");
    const listBtn = makeButton("リスト");
    const monthBtn = makeButton("月");
    const reloadBtn = makeButton("更新");

    tools.appendChild(listBtn);
    tools.appendChild(monthBtn);
    tools.appendChild(reloadBtn);
    head.appendChild(tools);

    const body = h("div");

    root.appendChild(head);
    root.appendChild(body);

    const today = new Date();

    const state = {
      view: "list",
      year: today.getFullYear(),
      month: today.getMonth(),
      selected: dayKey(today)
    };

    const showCourse = !courseId;

    function myEvents() {

      return cache.events.filter(
        (e) => !courseId || e.courseId === String(courseId)
      );
    }


    // ----- リスト -----

    function renderList() {

      const now = nowSec();
      const from = now - LIST_PAST_DAYS * 86400;
      const to = now + LIST_FUTURE_DAYS * 86400;

      const items =
        myEvents().filter((e) => e.time >= from && e.time <= to);

      if (items.length === 0) {
        body.appendChild(
          h("p", null, "直近の予定はありません。")
        );
      }

      const overdue = items.filter((e) => e.time < now);
      const upcoming = items.filter((e) => e.time >= now);

      if (overdue.length > 0) {

        body.appendChild(
          h("div", "my-cal-day-h", `期限超過（直近${LIST_PAST_DAYS}日）`)
        );

        overdue.forEach((e) => body.appendChild(createEvent(e, showCourse)));
      }

      let lastKey = "";

      for (const e of upcoming) {

        const d = new Date(e.time * 1000);
        const key = dayKey(d);

        if (key !== lastKey) {

          lastKey = key;

          const dh = h(
            "div",
            "my-cal-day-h" + (key === dayKey(new Date()) ? " today" : ""),
            formatDay(d)
          );

          body.appendChild(dh);
        }

        body.appendChild(createEvent(e, showCourse));
      }

      body.appendChild(
        h(
          "div",
          "my-cal-note",
          `今日から${LIST_FUTURE_DAYS}日先までの予定です。それより先は「月」で確認できます。`
        )
      );
    }


    // ----- 月 -----

    function renderMonth() {

      const minIdx = monthIndex(new Date(rangeFrom * 1000));
      const maxIdx = monthIndex(new Date()) + 3;
      const curIdx = state.year * 12 + state.month;

      const nav = h("div", "my-cal-nav");

      const prev = makeButton("◀");
      prev.disabled = curIdx <= minIdx;
      prev.addEventListener("click", () => moveMonth(-1));

      const next = makeButton("▶");
      next.disabled = curIdx >= maxIdx;
      next.addEventListener("click", () => moveMonth(1));

      nav.appendChild(prev);
      nav.appendChild(
        h("strong", null, state.year + "年" + (state.month + 1) + "月")
      );
      nav.appendChild(next);
      body.appendChild(nav);

      const byDay = new Map();

      for (const e of myEvents()) {

        const key = dayKey(new Date(e.time * 1000));

        if (!byDay.has(key)) {
          byDay.set(key, []);
        }

        byDay.get(key).push(e);
      }

      const grid = h("div", "my-cal-grid");

      ["月", "火", "水", "木", "金", "土", "日"].forEach((w) => {
        grid.appendChild(h("div", "my-cal-wd", w));
      });

      const first = new Date(state.year, state.month, 1);
      const offset = (first.getDay() + 6) % 7;
      const daysInMonth =
        new Date(state.year, state.month + 1, 0).getDate();
      const weeks = Math.ceil((offset + daysInMonth) / 7);
      const todayKey = dayKey(new Date());

      for (let i = 0; i < weeks * 7; i++) {

        const date = new Date(state.year, state.month, 1 - offset + i);
        const key = dayKey(date);
        const out = date.getMonth() !== state.month;

        const cell = h("button", "my-cal-cell");
        cell.type = "button";

        if (out) {
          cell.classList.add("out");
        }

        if (key === todayKey) {
          cell.classList.add("today");
        }

        if (key === state.selected) {
          cell.classList.add("sel");
        }

        cell.appendChild(h("span", "my-cal-num", String(date.getDate())));

        const list = byDay.get(key) || [];

        list.slice(0, 2).forEach((e) => {

          const hue = hueOf(e.courseId);
          const chip = h("span", "my-cal-chip", e.name.replace(/[「」]/g, ""));
          chip.style.background = `hsl(${hue}, 70%, 90%)`;
          chip.style.color = `hsl(${hue}, 50%, 25%)`;
          cell.appendChild(chip);
        });

        if (list.length > 2) {
          cell.appendChild(h("span", "my-cal-more", `+${list.length - 2}件`));
        }

        cell.addEventListener("click", () => {
          state.selected = key;
          render();
        });

        grid.appendChild(cell);
      }

      body.appendChild(grid);

      // 選んだ日の予定
      const dayList = byDay.get(state.selected) || [];

      const parts = state.selected.split("-").map(Number);
      const selDate = new Date(parts[0], parts[1], parts[2]);

      body.appendChild(h("div", "my-cal-day-h", formatDay(selDate)));

      if (dayList.length === 0) {
        body.appendChild(h("p", "my-cal-meta", "この日の予定はありません。"));
      }

      dayList.forEach((e) => body.appendChild(createEvent(e, showCourse)));

      if (curIdx === minIdx && minIdx === monthIndex(new Date())) {
        // 今月より前の予定は取得していない
        body.appendChild(
          h("div", "my-cal-note", "今月より前の予定は表示されません。")
        );
      }
    }

    function moveMonth(delta) {

      const d = new Date(state.year, state.month + delta, 1);

      state.year = d.getFullYear();
      state.month = d.getMonth();
      state.selected = "";

      render();
    }


    // ----- 共通 -----

    function render() {

      listBtn.classList.toggle("active", state.view === "list");
      monthBtn.classList.toggle("active", state.view === "month");

      body.textContent = "";

      if (cache.failed && !cache.loaded) {
        body.textContent = "予定を取得できませんでした。";
        return;
      }

      if (state.view === "list") {
        renderList();
      } else {
        renderMonth();
      }
    }

    async function show(force) {

      body.textContent = "予定を取得しています…";

      await loadEvents(force === true);

      render();
    }

    listBtn.addEventListener("click", () => {
      state.view = "list";
      render();
    });

    monthBtn.addEventListener("click", () => {
      state.view = "month";
      render();
    });

    reloadBtn.addEventListener("click", () => show(true));

    return { root, show };
  }


  // -------------------------
  // ダッシュボード: 既存のカレンダーを置き換える
  // -------------------------

  function initDashboard() {

    const deadline = Date.now() + 5000;

    const timer = setInterval(() => {

      const block =
        document.querySelector("section.block_calendar_month") ||
        document.querySelector('[data-block="calendar_month"]');

      if (block && block.parentElement) {

        clearInterval(timer);
        placeOnDashboard(block);

        return;
      }

      if (Date.now() > deadline) {

        clearInterval(timer);
        clog("カレンダーブロックが見つかりません");
      }

    }, 250);
  }

  function placeOnDashboard(block) {

    const widget = createWidget({ title: "予定", courseId: "" });

    const card = h("div");
    card.className = "my-cal-card";
    card.style.padding = "16px";
    card.style.marginBottom = "16px";
    card.style.border = "1px solid #ddd";
    card.style.borderRadius = "8px";
    card.style.background = "#fff";

    card.appendChild(widget.root);

    // 元のカレンダーは消さずに隠すだけ（リンクで戻せる）
    const toggle = h("a", "my-cal-note", "元のカレンダーを表示");
    toggle.href = "#";
    toggle.style.display = "block";

    toggle.addEventListener("click", (event) => {

      event.preventDefault();

      const hidden = block.style.display === "none";

      block.style.display = hidden ? "" : "none";
      toggle.textContent =
        hidden ? "元のカレンダーを隠す" : "元のカレンダーを表示";
    });

    card.appendChild(toggle);

    block.parentElement.insertBefore(card, block);
    block.style.display = "none";

    widget.show(false);

    clog("ダッシュボードのカレンダーを置き換えました");
  }


  // -------------------------
  // 科目ページ: 「予定」タブ
  // -------------------------

  function initCourse() {

    if (typeof registerCourseTab !== "function") {
      return;
    }

    const courseId = getCourseId();

    if (!courseId) {
      return;
    }

    const widget = createWidget({ title: "この科目の予定", courseId });

    const panel = h("div", "my-cal-panel");
    panel.style.marginTop = "20px";
    panel.style.padding = "20px";
    panel.style.border = "1px solid #ddd";
    panel.style.borderRadius = "5px";

    panel.appendChild(widget.root);

    registerCourseTab({
      id: "calendar",
      label: "予定",
      order: 15,
      panel: panel,
      onShow: () => widget.show(false)
    });
  }

  if (isDashboard) {
    initDashboard();
  } else {
    initCourse();
  }

})();