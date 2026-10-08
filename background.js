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
 
 
const pendingTabs =
  new Map();


// ======================================================
// 検索開始を同期的に記録するSet
// ======================================================

const pendingCourses =
  new Set();


// ======================================================
// session storage
// ======================================================

const PENDING_STORAGE_KEY =
  "pendingSyllabusTabs";


// ======================================================
// シラバスの正規URL
// ======================================================

const SYLLABUS_ORIGIN =
  "https://syllabus.ritsumei.ac.jp/";


// ======================================================
// 詳細として保存する項目
// ======================================================

const DETAIL_FIELDS = [
  "year",
  "term",
  "schedule",
  "teacher",
  "campus",
  "room",
  "evaluation",
  "overview"
];


log(
  "background.js 起動"
);


// ======================================================
// pendingCourses用キー
// ======================================================

function pendingKeyOf(
  info
) {

  return info.kind === "detail"
    ? "detail:" +
      info.courseCode
    : info.courseCode;
}


// ======================================================
// Moodleタブへ送信
// ======================================================

async function sendToMoodle(
  moodleTabId,
  message
) {

  try {

    await chrome.tabs.sendMessage(
      moodleTabId,
      message
    );

  } catch (e) {

    log(
      "Moodleタブへ送信できませんでした:",
      e
    );
  }
}


// ======================================================
// pendingTabsをsession storageへ保存
// ======================================================

async function savePendingTabs() {

  const data =
    Object.fromEntries(
      pendingTabs
    );


  await chrome.storage.session.set({
    [PENDING_STORAGE_KEY]:
      data
  });
}


// ======================================================
// pendingTabsを復元
// ======================================================

async function restorePendingTabs() {

  const result =
    await chrome.storage.session.get(
      PENDING_STORAGE_KEY
    );


  const data =
    result[
      PENDING_STORAGE_KEY
    ];


  if (!data) {
    return;
  }


  pendingTabs.clear();

  pendingCourses.clear();


  for (
    const [tabId, info]
    of Object.entries(data)
  ) {

    pendingTabs.set(
      Number(tabId),
      info
    );

    pendingCourses.add(
      pendingKeyOf(info)
    );
  }


  log(
    "pendingTabsを復元しました:",
    pendingTabs
  );
}


// ======================================================
// 復元完了を待つPromise
// ======================================================

const restorePromise =
  restorePendingTabs();


// ======================================================
// 検索・詳細取得の後始末
// ======================================================

async function finishSearch(
  tabId,
  pending
) {

  pendingTabs.delete(
    tabId
  );

  pendingCourses.delete(
    pendingKeyOf(pending)
  );


  await savePendingTabs();


  try {

    await chrome.tabs.remove(
      tabId
    );

  } catch (e) {

    // すでに閉じられている場合は何もしない
  }
}


// ======================================================
// メッセージ受信
// listener自体はasyncにしない
// ======================================================

chrome.runtime.onMessage.addListener(
  (message, sender) => {

    handleMessage(
      message,
      sender
    );
  }
);


// ======================================================
// メッセージ処理本体
// ======================================================

async function handleMessage(
  message,
  sender
) {

  await restorePromise;


  // ====================================================
  // Moodleからシラバス検索開始
  // ====================================================

  if (
    message.type ===
    "searchSyllabus"
  ) {

    const courseCode =
      message.courseCode;

    const moodleTabId =
      sender.tab?.id;


    if (!moodleTabId) {
      return;
    }


    if (
      pendingCourses.has(
        courseCode
      )
    ) {

      log(
        "同じ科目の検索がすでに実行中:",
        courseCode
      );

      return;
    }


    pendingCourses.add(
      courseCode
    );


    log(
      "シラバス検索開始:",
      courseCode
    );


    try {

      const tab =
        await chrome.tabs.create({
          url:
            "https://syllabus.ritsumei.ac.jp/syllabus/s/?language=ja",
          active:
            false
        });


      log(
        "検索用タブ:",
        tab.id
      );


      pendingTabs.set(
        tab.id,
        {
          moodleTabId:
            moodleTabId,

          courseCode:
            courseCode
        }
      );


      await savePendingTabs();

    } catch (e) {

      log(
        "検索用タブの作成に失敗しました:",
        e
      );


      pendingCourses.delete(
        courseCode
      );
    }


    return;
  }


  // ====================================================
  // シラバス検索成功
  // ====================================================

  if (
    message.type ===
    "syllabusFound"
  ) {

    const tabId =
      sender.tab?.id;


    if (!tabId) {
      return;
    }


    const pending =
      pendingTabs.get(
        tabId
      );


    if (!pending) {

      log(
        "対応する検索情報がありません"
      );

      return;
    }


    log(
      "シラバスURL取得:",
      message.url
    );


    // URL保存
    await chrome.storage.local.set({
      [
        "syllabus_" +
        pending.courseCode
      ]:
        message.url
    });


    // 過去の失敗記録削除
    await chrome.storage.local.remove([
      "syllabus_fail_" +
      pending.courseCode
    ]);


    // Moodleへ通知
    await sendToMoodle(
      pending.moodleTabId,
      {
        type:
          "syllabusReady",

        url:
          message.url
      }
    );


    await finishSearch(
      tabId,
      pending
    );


    return;
  }


  // ====================================================
  // シラバス検索失敗
  // ====================================================

  if (
    message.type ===
    "syllabusNotFound"
  ) {

    const tabId =
      sender.tab?.id;


    if (!tabId) {
      return;
    }


    const pending =
      pendingTabs.get(
        tabId
      );


    if (!pending) {

      log(
        "失敗した検索に対応する情報がありません"
      );

      return;
    }


    log(
      "シラバスが見つかりませんでした:",
      pending.courseCode,
      message.reason
    );


    await chrome.storage.local.set({
      [
        "syllabus_fail_" +
        pending.courseCode
      ]:
        Date.now()
    });


    await sendToMoodle(
      pending.moodleTabId,
      {
        type:
          "syllabusFailed",

        courseCode:
          pending.courseCode,

        reason:
          message.reason
      }
    );


    await finishSearch(
      tabId,
      pending
    );


    return;
  }


  // ====================================================
  // Moodleからシラバス詳細取得依頼
  // ====================================================

  if (
    message.type ===
    "fetchSyllabusDetail"
  ) {

    const courseCode =
      message.courseCode;

    const moodleTabId =
      sender.tab?.id;


    if (
      !moodleTabId ||
      !/^\d+$/.test(
        String(courseCode)
      )
    ) {

      return;
    }


    const key =
      "detail:" +
      courseCode;


    if (
      pendingCourses.has(key)
    ) {

      log(
        "同じ科目の詳細取得がすでに実行中:",
        courseCode
      );

      return;
    }


    pendingCourses.add(
      key
    );


    log(
      "シラバス詳細の取得開始:",
      courseCode
    );


    // Moodleへ取得中通知
    await sendToMoodle(
      moodleTabId,
      {
        type:
          "syllabusDetailLoading",

        courseCode:
          courseCode
      }
    );


    try {

      // 保存済みURLを取得
      const storageKey =
        "syllabus_" +
        courseCode;


      const result =
        await chrome.storage.local.get(
          storageKey
        );


      const url =
        result[storageKey];


      if (
        typeof url !== "string" ||
        !url.startsWith(
          SYLLABUS_ORIGIN
        )
      ) {

        log(
          "保存済みシラバスURLがありません:",
          courseCode
        );


        pendingCourses.delete(
          key
        );


        await sendToMoodle(
          moodleTabId,
          {
            type:
              "syllabusDetailFailed",

            courseCode:
              courseCode,

            reason:
              "no_saved_url"
          }
        );


        return;
      }


      // 詳細取得用タブ
      const tab =
        await chrome.tabs.create({
          url:
            url,
          active:
            false
        });


      log(
        "詳細取得用タブ:",
        tab.id
      );


      pendingTabs.set(
        tab.id,
        {
          moodleTabId:
            moodleTabId,

          courseCode:
            courseCode,

          kind:
            "detail"
        }
      );


      await savePendingTabs();

    } catch (e) {

      log(
        "詳細取得用タブの作成に失敗しました:",
        e
      );


      pendingCourses.delete(
        key
      );


      await sendToMoodle(
        moodleTabId,
        {
          type:
            "syllabusDetailFailed",

          courseCode:
            courseCode,

          reason:
            "tab_create_failed"
        }
      );
    }


    return;
  }


  // ====================================================
  // シラバス詳細取得成功
  // ====================================================

  if (
    message.type ===
    "syllabusDetailFound"
  ) {

    const tabId =
      sender.tab?.id;


    if (!tabId) {
      return;
    }


    const pending =
      pendingTabs.get(
        tabId
      );


    if (
      !pending ||
      pending.kind !== "detail"
    ) {

      log(
        "対応する詳細取得情報がありません"
      );

      return;
    }


    // -------------------------
    // 必要な項目だけ保存
    // -------------------------

    const source =
      message.detail || {};


    const detail = {
      savedAt:
        Date.now()
    };


    for (
      const field of DETAIL_FIELDS
    ) {

      detail[field] =
        String(
          source[field] || ""
        ).slice(
          0,
          5000
        );
    }


    await chrome.storage.local.set({
      [
        "syllabus_detail_" +
        pending.courseCode
      ]:
        detail
    });


    log(
      "シラバス詳細を保存しました:",
      pending.courseCode
    );


    await sendToMoodle(
      pending.moodleTabId,
      {
        type:
          "syllabusDetailReady",

        courseCode:
          pending.courseCode,

        detail:
          detail
      }
    );


    await finishSearch(
      tabId,
      pending
    );


    return;
  }


  // ====================================================
  // シラバス詳細取得失敗
  // ====================================================

  if (
    message.type ===
    "syllabusDetailNotFound"
  ) {

    const tabId =
      sender.tab?.id;


    if (!tabId) {
      return;
    }


    const pending =
      pendingTabs.get(
        tabId
      );


    if (
      !pending ||
      pending.kind !== "detail"
    ) {

      log(
        "失敗した詳細取得に対応する情報がありません"
      );

      return;
    }


    log(
      "シラバス詳細を取得できませんでした:",
      pending.courseCode,
      message.reason
    );


    await sendToMoodle(
      pending.moodleTabId,
      {
        type:
          "syllabusDetailFailed",

        courseCode:
          pending.courseCode,

        reason:
          message.reason
      }
    );


    await finishSearch(
      tabId,
      pending
    );


    return;
  }
}


// ======================================================
// シラバスページの読み込み完了
// ======================================================

chrome.tabs.onUpdated.addListener(
  async (
    tabId,
    changeInfo
  ) => {

    if (
      changeInfo.status !==
      "complete"
    ) {

      return;
    }


    await restorePromise;


    const pending =
      pendingTabs.get(
        tabId
      );


    if (!pending) {
      return;
    }


    log(
      "シラバスページ読み込み完了:",
      pending.courseCode
    );


    const startType =
      pending.kind === "detail"
        ? "startSyllabusDetail"
        : "startSyllabusSearch";


    try {

      await chrome.tabs.sendMessage(
        tabId,
        {
          type:
            startType,

          courseCode:
            pending.courseCode
        }
      );

    } catch (e) {

      log(
        "開始メッセージを送れませんでした:",
        e
      );
    }
  }
);


// ======================================================
// 検索中・詳細取得中のタブが手動で閉じられた場合
// ======================================================

chrome.tabs.onRemoved.addListener(
  async (tabId) => {

    await restorePromise;


    const pending =
      pendingTabs.get(
        tabId
      );


    if (!pending) {
      return;
    }


    log(
      "検索中のタブが閉じられました:",
      pending.courseCode
    );


    pendingTabs.delete(
      tabId
    );

    pendingCourses.delete(
      pendingKeyOf(pending)
    );


    await savePendingTabs();


    // 詳細取得中だった場合
    if (
      pending.kind ===
      "detail"
    ) {

      await sendToMoodle(
        pending.moodleTabId,
        {
          type:
            "syllabusDetailFailed",

          courseCode:
            pending.courseCode,

          reason:
            "tab_closed"
        }
      );
    }
  }
);