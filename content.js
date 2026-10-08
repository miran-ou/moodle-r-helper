// ======================================================
// デバッグログ
// 開発中にログを見たいときだけ true にする
// ======================================================
 
const DEBUG = false;
 
const log = (...args) => {
  if (DEBUG) {
    console.log(...args);
  }
};
 
 
log("content.js 起動");

const hostname = location.hostname;


// ======================================================
// Moodle側
// ======================================================

if (hostname === "lms.ritsumei.ac.jp") {
  initMoodle();
}


// ======================================================
// シラバス側
// ======================================================

if (hostname === "syllabus.ritsumei.ac.jp") {
  initSyllabus();
}


// ======================================================
// Moodle側の処理
// ======================================================

function initMoodle() {

  const title = document.querySelector(
    ".page-header-headings h1"
  );

  if (!title) {
    return;
  }

  const text = title.textContent.trim();

  log(
    "授業タイトル:",
    text
  );

  const match = text.match(/^(\d+):/);

  if (!match) {
    return;
  }

  const courseCode = match[1];

  log(
    "授業コード:",
    courseCode
  );


  const successKey =
    "syllabus_" + courseCode;

  const failKey =
    "syllabus_fail_" + courseCode;


  chrome.storage.local.get(
    [successKey, failKey],
    (result) => {

      const url = result[successKey];


      // -------------------------
      // 成功済み
      // -------------------------

      if (url) {

        log(
          "保存済みシラバスURL:",
          url
        );

        addSyllabusLink(url);

        return;
      }


      // -------------------------
      // 失敗履歴確認
      // -------------------------

      const failedAt =
        result[failKey];

      if (failedAt) {

        const THREE_DAYS =
          3 * 24 * 60 * 60 * 1000;

        const elapsed =
          Date.now() - failedAt;


        if (elapsed < THREE_DAYS) {

          log(
            "過去3日以内に検索失敗しているため、再検索しません"
          );

          addSyllabusSearchFallback(
            courseCode
          );

          return;
        }


        log(
          "失敗から3日経過。再検索します"
        );
      }


      // -------------------------
      // 未取得なので検索
      // -------------------------

      chrome.runtime.sendMessage({
        type: "searchSyllabus",
        courseCode: courseCode
      });
    }
  );


  // -------------------------
  // backgroundからの通知
  // -------------------------

  chrome.runtime.onMessage.addListener(
    (message) => {

      // シラバスURL取得成功
      if (
        message.type === "syllabusReady"
      ) {

        log(
          "シラバスURLを受信:",
          message.url
        );

        addSyllabusLink(
          message.url
        );
      }


      // シラバス検索失敗
      else if (
        message.type === "syllabusFailed"
      ) {

        if (
          message.courseCode !== courseCode
        ) {
          return;
        }

        log(
          "シラバス検索失敗を受信:",
          message.reason
        );

        addSyllabusSearchFallback(
          courseCode
        );
      }


      // シラバス詳細取得開始中
      else if (
        message.type ===
        "syllabusDetailLoading"
      ) {

        if (
          message.courseCode !== courseCode
        ) {
          return;
        }

        showSyllabusDetailLoading();
      }


      // シラバス詳細取得成功
      else if (
        message.type ===
        "syllabusDetailReady"
      ) {

        if (
          message.courseCode !== courseCode
        ) {
          return;
        }

        log(
          "シラバス詳細を受信:",
          message.detail
        );

        displaySyllabusDetail(
          message.detail
        );
      }


      // シラバス詳細取得失敗
      else if (
        message.type ===
        "syllabusDetailFailed"
      ) {

        if (
          message.courseCode !== courseCode
        ) {
          return;
        }

        log(
          "シラバス詳細取得失敗:",
          message.reason
        );

        displaySyllabusDetailError();
      }
    }
  );
}


// ======================================================
// シラバス側の処理
// ======================================================

function initSyllabus() {

  chrome.runtime.onMessage.addListener(
    (message) => {

      // 検索ページ
      if (
        message.type ===
        "startSyllabusSearch"
      ) {

        searchSyllabus(
          message.courseCode
        );
      }


      // 詳細ページ
      else if (
        message.type ===
        "startSyllabusDetail"
      ) {

        waitForSyllabusDetail(
          message.courseCode
        );
      }
    }
  );
}


// ======================================================
// シラバスリンク追加
// ======================================================

function addSyllabusLink(url) {

  if (
    document.querySelector(
      ".my-syllabus-link"
    )
  ) {
    return;
  }


  const link =
    document.createElement("a");

  link.className =
    "my-syllabus-link";

  link.textContent =
    "シラバスを見る";

  link.href = url;

  link.target = "_blank";

  link.rel =
    "noopener noreferrer";

  link.style.marginLeft =
    "10px";


  const title =
    document.querySelector(
      ".page-header-headings h1"
    );

  if (!title) {
    return;
  }


  title.parentElement.appendChild(
    link
  );


  log(
    "シラバスリンクを追加しました"
  );


  addSyllabusTab(url);
}


// ======================================================
// シラバス検索失敗時のフォールバック
// ======================================================

function addSyllabusSearchFallback(
  courseCode
) {

  if (
    document.querySelector(
      ".my-syllabus-fallback"
    )
  ) {
    return;
  }


  const title =
    document.querySelector(
      ".page-header-headings h1"
    );

  if (!title) {
    return;
  }


  const link =
    document.createElement("a");

  link.className =
    "my-syllabus-fallback";

  link.textContent =
    "シラバスを検索する";

  link.href =
    "https://syllabus.ritsumei.ac.jp/syllabus/s/?language=ja";

  link.target = "_blank";

  link.rel =
    "noopener noreferrer";

  link.style.marginLeft =
    "10px";


  title.parentElement.appendChild(
    link
  );


  log(
    "シラバス検索用リンクを追加しました:",
    courseCode
  );
}


// ======================================================
// シラバス情報タブ
// ======================================================

function addSyllabusTab(url) {

  if (
    document.querySelector(
      ".my-syllabus-tab"
    )
  ) {
    return;
  }


  const navTabs =
    document.querySelector(
      "ul.nav.more-nav.nav-tabs"
    );

  if (!navTabs) {

    log(
      "タブ一覧が見つかりません"
    );

    return;
  }


  const moreButton =
    navTabs.querySelector(
      '[data-region="morebutton"]'
    );

  if (!moreButton) {

    log(
      "「さらに」が見つかりません"
    );

    return;
  }


  const tab =
    document.createElement("li");

  tab.className =
    "nav-item my-syllabus-tab";


  const link =
    document.createElement("a");

  link.href = "#";

  link.className =
    "nav-link";

  link.textContent =
    "シラバス情報";


  tab.appendChild(link);


  navTabs.insertBefore(
    tab,
    moreButton
  );


  const panel =
    document.createElement("div");

  panel.className =
    "my-syllabus-panel";

  panel.style.display =
    "none";

  panel.style.marginTop =
    "20px";

  panel.style.padding =
    "20px";

  panel.style.border =
    "1px solid #ddd";

  panel.style.borderRadius =
    "5px";


  // -------------------------
  // 授業情報
  // -------------------------

  const titleElement =
    document.querySelector(
      ".page-header-headings h1"
    );

  const titleText =
    titleElement
      ? titleElement.textContent.trim()
      : "";

  const titleMatch =
    titleText.match(/^(\d+):(.*)$/);

  const courseCode =
    titleMatch
      ? titleMatch[1]
      : "";

  const courseName =
    titleMatch
      ? titleMatch[2].trim()
      : "";


  const heading =
    document.createElement("h3");

  heading.textContent =
    "シラバス情報";


  const codeLine =
    document.createElement("p");

  codeLine.textContent =
    "授業コード: " +
    courseCode;


  const nameLine =
    document.createElement("p");

  nameLine.textContent =
    "授業名: " +
    courseName;


  const openButton =
    document.createElement("a");

  openButton.className =
    "btn btn-primary";

  openButton.textContent =
    "シラバスを開く";

  openButton.href =
    url;

  openButton.target =
    "_blank";

  openButton.rel =
    "noopener noreferrer";


  panel.appendChild(heading);
  panel.appendChild(codeLine);
  panel.appendChild(nameLine);
  panel.appendChild(openButton);


  const detailArea =
    document.createElement("div");

  detailArea.className =
    "my-syllabus-detail";

  detailArea.style.marginTop =
    "20px";


  panel.appendChild(
    detailArea
  );


  const regionMain =
    document.querySelector(
      "#region-main"
    );

  if (!regionMain) {

    log(
      "region-mainが見つかりません"
    );

    return;
  }


  regionMain.appendChild(
    panel
  );


  // -------------------------
  // シラバス情報タブ
  // -------------------------

  link.addEventListener(
    "click",
    (event) => {

      event.preventDefault();


      regionMain
        .querySelectorAll(
          ":scope > *"
        )
        .forEach((element) => {

          if (
            !element.classList.contains(
              "my-syllabus-panel"
            )
          ) {

            element.style.display =
              "none";
          }
        });


      panel.style.display =
        "block";

      link.classList.add(
        "active"
      );


      loadSyllabusDetail(
        courseCode
      );
    }
  );


  // -------------------------
  // コースタブ
  // -------------------------

  const courseLink =
    navTabs.querySelector(
      '[data-key="coursehome"] > a'
    );

  if (courseLink) {

    courseLink.addEventListener(
      "click",
      () => {

        regionMain
          .querySelectorAll(
            ":scope > *"
          )
          .forEach((element) => {

            if (
              !element.classList.contains(
                "my-syllabus-panel"
              )
            ) {

              element.style.display =
                "";
            }
          });


        panel.style.display =
          "none";

        link.classList.remove(
          "active"
        );
      }
    );
  }


  log(
    "シラバス情報タブを追加しました"
  );
}


// ======================================================
// シラバス詳細の表示
// ======================================================

function getSyllabusDetailArea() {

  return document.querySelector(
    ".my-syllabus-detail"
  );
}


function showSyllabusDetailLoading() {

  const area =
    getSyllabusDetailArea();

  if (!area) {
    return;
  }

  area.textContent =
    "シラバス情報を取得しています…";
}


function displaySyllabusDetailError() {

  const area =
    getSyllabusDetailArea();

  if (!area) {
    return;
  }

  area.textContent =
    "シラバス情報を取得できませんでした。";
}


function displaySyllabusDetail(
  detail
) {

  const area =
    getSyllabusDetailArea();

  if (!area) {
    return;
  }


  area.textContent = "";


  const fields = [
    ["年度", detail.year],
    ["学期", detail.term],
    ["開講曜日・時限", detail.schedule],
    ["担当教員", detail.teacher],
    ["キャンパス", detail.campus],
    ["授業施設", detail.room],
    ["成績評価", detail.evaluation],
    ["授業の概要と方法", detail.overview]
  ];


  for (const [label, value] of fields) {

    if (!value) {
      continue;
    }


    const wrapper =
      document.createElement("div");

    wrapper.style.marginBottom =
      "16px";


    const labelElement =
      document.createElement("strong");

    labelElement.textContent =
      label;


    const valueElement =
      document.createElement("div");

    valueElement.textContent =
      value;

    valueElement.style.whiteSpace =
      "pre-wrap";

    valueElement.style.marginTop =
      "4px";


    wrapper.appendChild(
      labelElement
    );

    wrapper.appendChild(
      valueElement
    );


    area.appendChild(
      wrapper
    );
  }
}


// ======================================================
// シラバス詳細の取得
// ======================================================

let syllabusDetailLoading =
  false;


function loadSyllabusDetail(
  courseCode
) {

  if (syllabusDetailLoading) {
    return;
  }


  syllabusDetailLoading =
    true;


  chrome.storage.local.get(
    "syllabus_detail_" + courseCode,
    (result) => {

      const detail =
        result[
          "syllabus_detail_" +
          courseCode
        ];


      if (
        detail &&
        Object.prototype.hasOwnProperty.call(
          detail,
          "evaluation"
        )
      ) {

        log(
          "保存済みシラバス詳細を表示:",
          detail
        );

        displaySyllabusDetail(
          detail
        );

        syllabusDetailLoading =
          false;

        return;
      }


      showSyllabusDetailLoading();


      chrome.runtime.sendMessage({
        type:
          "fetchSyllabusDetail",
        courseCode:
          courseCode
      });
    }
  );
}


// ======================================================
// シラバス検索
// ======================================================

function searchSyllabus(
  courseCode
) {

  log(
    "シラバス検索開始:",
    courseCode
  );


  const input =
    findSearchInput();

  if (!input) {

    log(
      "検索欄が見つかりません"
    );


    chrome.runtime.sendMessage({
      type:
        "syllabusNotFound",
      reason:
        "search_input_not_found"
    });

    return;
  }


  input.value =
    courseCode;


  input.dispatchEvent(
    new Event(
      "input",
      {
        bubbles: true
      }
    )
  );


  log(
    "検索欄に入力:",
    courseCode
  );


  const button =
    findSearchButton();

  if (!button) {

    log(
      "検索ボタンが見つかりません"
    );


    chrome.runtime.sendMessage({
      type:
        "syllabusNotFound",
      reason:
        "search_button_not_found"
    });

    return;
  }


  log(
    "検索ボタンを発見"
  );


  button.click();


  waitForSyllabusLink(
    courseCode
  );
}


// ======================================================
// 検索欄を探す
// Shadow DOMにも対応
// ======================================================

function findSearchInput() {

  const candidates = [
    "input[name='keyword-search']",
    "input[placeholder*='授業コード']",
    "input[type='search']",
    "input[name*='search' i]"
  ];


  for (
    const selector of candidates
  ) {

    const element =
      findInShadowRoots(
        document,
        selector
      );

    if (element) {
      return element;
    }
  }


  return null;
}


// ======================================================
// 検索ボタンを探す
// Shadow DOMにも対応
// ======================================================

function findSearchButton() {

  const candidates = [
    "button",
    "input[type='submit']",
    "input[type='button']"
  ];


  for (
    const selector of candidates
  ) {

    const elements =
      findAllInShadowRoots(
        document,
        selector
      );


    for (
      const element of elements
    ) {

      const text =
        (
          element.textContent ||
          element.value ||
          ""
        ).trim();


      if (
        text.includes("検索") ||
        text.includes("Search")
      ) {

        return element;
      }
    }
  }


  return null;
}


// ======================================================
// Shadow DOMを含めて最初の要素を探す
// ======================================================

function findInShadowRoots(
  root,
  selector
) {

  const element =
    root.querySelector(
      selector
    );

  if (element) {
    return element;
  }


  const all =
    root.querySelectorAll("*");


  for (
    const el of all
  ) {

    if (el.shadowRoot) {

      const result =
        findInShadowRoots(
          el.shadowRoot,
          selector
        );

      if (result) {
        return result;
      }
    }
  }


  return null;
}


// ======================================================
// Shadow DOMを含めて全要素を探す
// ======================================================

function findAllInShadowRoots(
  root,
  selector
) {

  const results = [
    ...root.querySelectorAll(
      selector
    )
  ];


  for (
    const el of
    root.querySelectorAll("*")
  ) {

    if (el.shadowRoot) {

      results.push(
        ...findAllInShadowRoots(
          el.shadowRoot,
          selector
        )
      );
    }
  }


  return results;
}


// ======================================================
// シラバスリンクを15秒間探す
// ======================================================

function waitForSyllabusLink(
  courseCode
) {

  const startTime =
    Date.now();


  const timer =
    setInterval(
      () => {

        const url =
          findSyllabusLink(
            document,
            courseCode
          );


        if (url) {

          clearInterval(
            timer
          );


          log(
            "シラバスURL発見:",
            url
          );


          chrome.runtime.sendMessage({
            type:
              "syllabusFound",
            url:
              url
          });


          return;
        }


        const elapsed =
          Date.now() -
          startTime;


        if (
          elapsed >= 15000
        ) {

          clearInterval(
            timer
          );


          log(
            "15秒経過しました。シラバスURLが見つかりませんでした"
          );


          chrome.runtime.sendMessage({
            type:
              "syllabusNotFound",
            reason:
              "syllabus_link_not_found"
          });
        }

      },
      500
    );
}


// ======================================================
// シラバスリンクをShadow DOMまで探索
// ======================================================

function findSyllabusLink(
  root,
  courseCode
) {

  const links =
    root.querySelectorAll(
      "a"
    );


  for (
    const link of links
  ) {

    const text =
      link.textContent.trim();


    if (
      text.startsWith(
        courseCode + ":"
      )
    ) {

      return link.href;
    }
  }


  for (
    const el of
    root.querySelectorAll("*")
  ) {

    if (el.shadowRoot) {

      const result =
        findSyllabusLink(
          el.shadowRoot,
          courseCode
        );

      if (result) {
        return result;
      }
    }
  }


  return null;
}


// ======================================================
// シラバス詳細ページの本文を切り出す
// ======================================================

function parseSyllabusText(
  text
) {

  const lines =
    text
      .split("\n")
      .map(
        (l) => l.trim()
      )
      .filter(
        (l) => l !== ""
      );


  const labels = [
    "授業科目名",
    "年度",
    "学期",
    "開講曜日・時限",
    "学部・研究科",
    "全担当教員",
    "単位数"
  ];


  const start =
    lines.indexOf(
      "授業科目名"
    );

  if (start === -1) {
    return null;
  }


  const labelsOk =
    labels.every(
      (label, k) =>
        lines[start + k] ===
        label
    );


  const valuesStart =
    start + labels.length;

  const valuesEnd =
    valuesStart +
    labels.length;


  if (
    !labelsOk ||
    lines[valuesEnd] !==
      "キャンパス"
  ) {

    return null;
  }


  const values =
    lines.slice(
      valuesStart,
      valuesEnd
    );


  const sectionLabels = [
    "キャンパス",
    "授業施設",
    "授業で利用する言語",
    "授業の概要と方法",
    "受講生の到達目標",
    "成績評価方法",
    "成績評価方法(備考)"
  ];


  const after = (
    label
  ) => {

    const i =
      lines.indexOf(label);

    if (i === -1) {
      return "";
    }


    const next =
      lines[i + 1] || "";


    return sectionLabels.includes(
      next
    )
      ? ""
      : next;
  };


  const between = (
    startLabel,
    endLabels
  ) => {

    const s =
      lines.indexOf(
        startLabel
      );

    if (s === -1) {
      return "";
    }


    let e = -1;


    for (
      const endLabel of endLabels
    ) {

      const index =
        lines.indexOf(
          endLabel,
          s + 1
        );

      if (
        index !== -1 &&
        (e === -1 ||
          index < e)
      ) {

        e = index;
      }
    }


    if (e === -1) {
      return "";
    }


    return lines
      .slice(
        s + 1,
        e
      )
      .join("\n");
  };


  return {

    title:
      values[0],

    year:
      values[1],

    term:
      values[2],

    schedule:
      values[3],

    teacher:
      values[5],

    campus:
      after("キャンパス"),

    room:
      after("授業施設"),

    overview:
      between(
        "授業の概要と方法",
        [
          "受講生の到達目標",
          "成績評価方法"
        ]
      ),

    evaluation:
      parseEvaluation(lines)
  };
}


// ======================================================
// 成績評価を必要な情報だけに変換
// ======================================================

function parseEvaluation(
  lines
) {

  const start =
    lines.indexOf(
      "成績評価方法"
    );


  const end =
    lines.indexOf(
      "成績評価方法(備考)",
      start + 1
    );


  if (
    start === -1 ||
    end === -1
  ) {

    return "";
  }


  const section =
    lines.slice(
      start + 1,
      end
    );


  const results = [];


  // -------------------------
  // 表の「評価項目 + 割合」
  // -------------------------

  for (
    let i = 0;
    i < section.length;
    i++
  ) {

    const line =
      section[i];


    // 例:
    // 100
    // 50
    // 25.5
    if (
      /^\d+(?:\.\d+)?$/.test(
        line
      )
    ) {

      const percentage =
        line + "%";


      let name = "";


      for (
        let j = i - 1;
        j >= 0;
        j--
      ) {

        if (
          section[j] &&
          section[j] !== "種別" &&
          section[j] !== "割合(%)" &&
          section[j] !== "評価基準等"
        ) {

          name =
            section[j];

          break;
        }
      }


      if (name) {

        results.push(
          `${name}：${percentage}`
        );
      }
    }
  }


  // -------------------------
  // 評価基準等の文章から
  // 埋め込まれた割合を抽出
  // -------------------------

  for (
    let i = 0;
    i < section.length;
    i++
  ) {

    const line =
      section[i];


    const normalized =
      line.replace(
        /％/g,
        "%"
      );


    if (
      !normalized.includes("%")
    ) {
      continue;
    }


    const match =
      normalized.match(
        /(\d+(?:\.\d+)?)%/
      );


    if (!match) {
      continue;
    }


    const percentage =
      match[1] + "%";


    let name =
      "";


    /*
     * 同じ行に評価対象がある場合
     */
    if (
      normalized.includes(
        "小テスト"
      )
    ) {

      name =
        "小テスト";

      if (
        normalized.includes(
          "感想"
        ) ||
        normalized.includes(
          "質問"
        )
      ) {

        name =
          "小テスト・感想・質問";
      }
    }


    if (
      normalized.includes(
        "期末課題"
      )
    ) {

      name =
        "期末課題";
    }


    if (
      normalized.includes(
        "レポート"
      ) &&
      !name
    ) {

      name =
        "レポート";
    }


    if (
      normalized.includes(
        "定期試験"
      ) &&
      !name
    ) {

      name =
        "定期試験";
    }


    /*
     * 同じ行だけでは分からない場合、
     * 直前2行程度も見る
     */
    if (!name) {

      const previous =
        section
          .slice(
            Math.max(
              0,
              i - 2
            ),
            i
          )
          .join(" ");


      if (
        previous.includes(
          "小テスト"
        )
      ) {

        name =
          "小テスト";

        if (
          previous.includes(
            "感想"
          ) ||
          previous.includes(
            "質問"
          )
        ) {

          name =
            "小テスト・感想・質問";
        }
      }


      else if (
        previous.includes(
          "期末課題"
        )
      ) {

        name =
          "期末課題";
      }


      else if (
        previous.includes(
          "レポート"
        )
      ) {

        name =
          "レポート";
      }


      else if (
        previous.includes(
          "試験"
        )
      ) {

        name =
          "試験";
      }
    }


    /*
     * 対象が特定できない場合は、
     * 原文を丸ごと表示しない。
     *
     * 「評価項目不明」と割合だけ表示。
     */
    if (!name) {

      name =
        "評価基準";
    }


    results.push(
      `${name}：${percentage}`
    );
  }


  // -------------------------
  // 重複削除
  // -------------------------

  return [
    ...new Set(results)
  ].join("\n");
}


// ======================================================
// 詳細ページの本文がそろうのを最大15秒待つ
// ======================================================

let syllabusDetailTimer =
  null;


function waitForSyllabusDetail(
  courseCode
) {

  if (
    syllabusDetailTimer
  ) {

    return;
  }


  const startTime =
    Date.now();


  syllabusDetailTimer =
    setInterval(
      () => {

        const parsed =
          parseSyllabusText(
            document.body.innerText
          );


        const isTarget =
          parsed !== null &&
          parsed.title.startsWith(
            courseCode + ":"
          );


        const timeout =
          Date.now() -
          startTime >=
          15000;


        if (
          isTarget &&
          (
            parsed.overview !== "" ||
            parsed.evaluation !== "" ||
            timeout
          )
        ) {

          clearInterval(
            syllabusDetailTimer
          );

          syllabusDetailTimer =
            null;


          log(
            "シラバス詳細を取得:",
            parsed
          );


          chrome.runtime.sendMessage({
            type:
              "syllabusDetailFound",

            detail:
              parsed
          });


          return;
        }


        if (timeout) {

          clearInterval(
            syllabusDetailTimer
          );

          syllabusDetailTimer =
            null;


          log(
            "シラバス詳細を認識できませんでした"
          );


          chrome.runtime.sendMessage({
            type:
              "syllabusDetailNotFound",

            reason:
              "detail_not_recognized"
          });
        }

      },
      500
    );
}
