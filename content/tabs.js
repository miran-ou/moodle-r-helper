// ======================================================
// 科目ページの共通タブ管理
// ======================================================

const tabLog = (...args) => {
  try {
    if (DEBUG) {
      console.log(...args);
    }
  } catch (e) {
    // DEBUG が未定義のときは何もしない
  }
};

let myTabInfra = null;


// 自前タブ行の見た目（Moodle標準タブに合わせる）
function injectOwnTabStyle() {

  if (document.querySelector("#my-tabs-style")) {
    return;
  }

  const sample =
    document.querySelector(".my-syllabus-link") ||
    document.querySelector("#region-main a") ||
    document.querySelector("a");

  const themeColor =
    sample ? getComputedStyle(sample).color : "#990000";

  const style = document.createElement("style");
  style.id = "my-tabs-style";
  style.textContent = `
    .my-course-tabs {
      display: flex;
      margin: 0 0 16px;
      padding: 0;
      list-style: none;
      border-bottom: 1px solid #dee2e6;
    }
    .my-course-tabs a {
      display: block;
      padding: 12px 20px;
      margin-bottom: -1px;
      color: ${themeColor};
      text-decoration: none;
      border-bottom: 3px solid transparent;
    }
    .my-course-tabs a:hover {
      text-decoration: none;
      border-bottom-color: #dee2e6;
    }
    .my-course-tabs a.active {
      color: #495057;
      border-bottom-color: ${themeColor};
    }
  `;

  document.head.appendChild(style);
}


// タブの土台（本物のタブ行 or 自前のタブ行）を1回だけ用意する
function ensureTabInfra() {

  if (myTabInfra) {
    return myTabInfra;
  }

  const titleElement =
    document.querySelector(".page-header-headings h1");

  const host =
    document.querySelector("#region-main") ||
    document.querySelector("[role='main']") ||
    document.querySelector("#page-content");

  if (!titleElement || !host) {
    tabLog("タブの土台を作れません");
    return null;
  }

  const infra = {
    host: host,
    tabs: [],
    mode: "",
    row: null,
    courseTab: null,
    moreButton: null,
    baseHidden: false,
    savedActive: []
  };

  const nativeRow =
    document.querySelector("ul.nav.more-nav.nav-tabs");

  if (nativeRow) {

    infra.mode = "native";
    infra.row = nativeRow;

    const more =
      nativeRow.querySelector('[data-region="morebutton"]');

    infra.moreButton =
      more && more.parentNode === nativeRow ? more : null;

    const courseLink =
      nativeRow.querySelector('[data-key="coursehome"] > a');

    if (courseLink) {
      courseLink.addEventListener("click", () => {
        showCourseContent(infra);
      });
    }

  } else {

    injectOwnTabStyle();

    infra.mode = "own";

    const row = document.createElement("ul");
    row.className = "my-course-tabs";

    const li = document.createElement("li");

    const a = document.createElement("a");
    a.href = "#";
    a.className = "active";
    a.textContent = "コース";

    a.addEventListener("click", (event) => {
      event.preventDefault();
      showCourseContent(infra);
    });

    li.appendChild(a);
    row.appendChild(li);

    infra.row = row;
    infra.courseTab = a;

    const header =
      titleElement.closest("#page-header") ||
      titleElement.closest(".page-header") ||
      titleElement.parentElement;

    header.insertAdjacentElement("afterend", row);
  }

  tabLog("タブの土台を作成:", infra.mode);

  myTabInfra = infra;

  return infra;
}


// ------------------------------------------------------
// 本文の表示・非表示
// ------------------------------------------------------

function hostContentElements(infra) {

  return [...infra.host.querySelectorAll(":scope > *")]
    .filter((el) => !el.classList.contains("my-course-panel"));
}

function hideHostContent(infra) {

  for (const el of hostContentElements(infra)) {

    if (!("myPrevDisplay" in el.dataset)) {
      el.dataset.myPrevDisplay = el.style.display;
    }

    el.style.display = "none";
  }
}

function restoreHostContent(infra) {

  for (const el of hostContentElements(infra)) {

    if ("myPrevDisplay" in el.dataset) {
      el.style.display = el.dataset.myPrevDisplay;
      delete el.dataset.myPrevDisplay;
    }
  }
}


// ------------------------------------------------------
// タブの切り替え
// ------------------------------------------------------

function showMyTab(infra, tab) {

  hideHostContent(infra);

  for (const t of infra.tabs) {
    const active = t === tab;
    t.panel.style.display = active ? "block" : "none";
    t.link.classList.toggle("active", active);
  }

  if (!infra.baseHidden) {

    infra.baseHidden = true;

    if (infra.mode === "own") {

      infra.courseTab.classList.remove("active");

    } else {

      infra.savedActive =
        [...infra.row.querySelectorAll(".nav-link.active")]
          .filter((a) => !a.closest("[data-my-tab]"));

      infra.savedActive.forEach((a) => a.classList.remove("active"));
    }
  }

  if (typeof tab.onShow === "function") {
    tab.onShow();
  }
}

function showCourseContent(infra) {

  restoreHostContent(infra);

  for (const t of infra.tabs) {
    t.panel.style.display = "none";
    t.link.classList.remove("active");
  }

  if (infra.baseHidden) {

    infra.baseHidden = false;

    if (infra.mode === "own") {

      infra.courseTab.classList.add("active");

    } else {

      infra.savedActive.forEach((a) => a.classList.add("active"));
      infra.savedActive = [];
    }
  }
}


// order の小さい順に並べ直す
function reorderMyTabs(infra) {

  const sorted =
    [...infra.tabs].sort((a, b) => a.order - b.order);

  for (const t of sorted) {
    infra.row.insertBefore(t.li, infra.moreButton);
  }
}


// ------------------------------------------------------
// タブの登録（content.js / notifications.js から呼ぶ）
// ------------------------------------------------------

function registerCourseTab({ id, label, order = 100, panel, onShow }) {

  if (document.querySelector(`[data-my-tab="${id}"]`)) {
    return;
  }

  const infra = ensureTabInfra();

  if (!infra) {
    return;
  }

  panel.classList.add("my-course-panel");
  panel.style.display = "none";
  infra.host.appendChild(panel);

  const li = document.createElement("li");
  li.dataset.myTab = id;

  const link = document.createElement("a");
  link.href = "#";
  link.textContent = label;

  if (infra.mode === "native") {
    li.className = "nav-item";
    link.className = "nav-link";
  }

  li.appendChild(link);
  infra.row.appendChild(li);

  const tab = { id, order, li, link, panel, onShow };

  infra.tabs.push(tab);
  reorderMyTabs(infra);

  link.addEventListener("click", (event) => {
    event.preventDefault();
    showMyTab(infra, tab);
  });

  tabLog("タブを登録:", id);
}