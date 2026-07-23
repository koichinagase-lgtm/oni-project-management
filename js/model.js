/* model.js — スキーマ定義と日付ユーティリティ
 * ビルド不要にするため ES modules は使わず、グローバル ONI 名前空間に載せる。 */

var ONI = window.ONI || {};
window.ONI = ONI;

ONI.model = (function () {
  "use strict";

  /* 年度は4月始まり */
  var FISCAL_START_MONTH = 4;

  /* グループ（ガント縦軸の分類）はデータとして持ち、編集・追加・削除できる。
     ここは初回起動時に入れておく既定グループと、新規グループ用の色候補。 */
  var DEFAULT_GROUPS = [
    { name: "商品開発", color: "#8C1D23" },
    { name: "販促・イベント", color: "#C2703A" },
    { name: "SNS投稿", color: "#A8894B" },
    { name: "撮影・素材準備", color: "#6B7A5A" }
  ];
  /* 選択できる12色。ブランド指針に合わせ暖色・低彩度でまとめ、青紫系は入れない。
     グループの色にも項目ごとのバー色にも、この同じパレットを使う。 */
  var COLOR_PALETTE = [
    { hex: "#8C1D23", name: "鬼赤" },
    { hex: "#A8443C", name: "弁柄" },
    { hex: "#C2703A", name: "照柿" },
    { hex: "#D69A4C", name: "山吹" },
    { hex: "#A8894B", name: "芥子" },
    { hex: "#7E7A3C", name: "鶯茶" },
    { hex: "#6B7A5A", name: "苔緑" },
    { hex: "#4F6B57", name: "深緑" },
    { hex: "#6E5A46", name: "焦茶" },
    { hex: "#8A6D5D", name: "胡桃" },
    { hex: "#B4818A", name: "桜鼠" },
    { hex: "#5A5550", name: "墨灰" }
  ];
  var GROUP_COLORS = COLOR_PALETTE.map(function (c) { return c.hex; });

  function colorName(hex) {
    var c = COLOR_PALETTE.filter(function (x) {
      return x.hex.toLowerCase() === String(hex).toLowerCase();
    })[0];
    return c ? c.name : hex;
  }

  var STATUSES = {
    todo: "未着手",
    doing: "進行中",
    review: "確認待ち",
    done: "完了"
  };

  var CHANNELS = {
    insta: { label: "Instagram", short: "IG" },
    insta_stories: { label: "IG ストーリー", short: "ST" },
    insta_IGTV: { label: "IG リール/IGTV", short: "RL" },
    x_threads: { label: "X / Threads", short: "X" },
    facebook: { label: "Facebook", short: "FB" },
    youtube: { label: "YouTube", short: "YT" }
  };
  var CHANNEL_ORDER = ["insta", "insta_stories", "insta_IGTV", "x_threads", "facebook", "youtube"];

  var PRIORITIES = ["高", "中", "低"];

  /* 既定の組み込みプロパティ設定。store が複製して保持し、ユーザーが編集できる。 */
  var DEFAULT_FIELDS = {
    labels: {
      group: "グループ",
      dates: "期間",
      status: "ステータス",
      priority: "優先度",
      channels: "配信媒体",
      text_owner: "テキスト担当",
      visual_owner: "ビジュアル担当",
      color: "バーの色"
    },
    hidden: {},
    statuses: Object.keys(STATUSES).map(function (k) { return { key: k, label: STATUSES[k] }; }),
    priorities: PRIORITIES.slice(),
    channels: CHANNEL_ORDER.map(function (k) {
      return { key: k, label: CHANNELS[k].label, short: CHANNELS[k].short };
    })
  };
  var FIELD_ORDER = ["group", "dates", "status", "priority", "channels", "text_owner", "visual_owner", "color"];

  /* -------------------------------------------------------------- 日付 */

  var DAY_MS = 86400000;
  var WD = ["日", "月", "火", "水", "木", "金", "土"];

  /** "YYYY-MM-DD" → ローカル時刻の Date（UTCずれを避けるため手で組み立てる） */
  function parse(iso) {
    var p = String(iso).split("-");
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }

  function iso(d) {
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return d.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
  }

  function today() {
    var n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }

  function addDays(d, n) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  }

  function addMonths(d, n) {
    return new Date(d.getFullYear(), d.getMonth() + n, d.getDate());
  }

  /** 日数差（時刻・夏時間の影響を受けないよう正午基準で丸める） */
  function diffDays(a, b) {
    var ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
    var ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
    return Math.round((ub - ua) / DAY_MS);
  }

  function startOfWeek(d) {
    return addDays(d, -d.getDay()); // 日曜始まり
  }

  function startOfMonth(d) {
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }

  function endOfMonth(d) {
    return new Date(d.getFullYear(), d.getMonth() + 1, 0);
  }

  /** 年度（7月始まり）の開始日 */
  function startOfFiscalYear(d) {
    var y = d.getMonth() + 1 >= FISCAL_START_MONTH ? d.getFullYear() : d.getFullYear() - 1;
    return new Date(y, FISCAL_START_MONTH - 1, 1);
  }

  /** 年度内の四半期（Q1 = 7-9月）の開始日 */
  function startOfFiscalQuarter(d) {
    var fy = startOfFiscalYear(d);
    var offset = (d.getFullYear() - fy.getFullYear()) * 12 + (d.getMonth() - fy.getMonth());
    return addMonths(fy, Math.floor(offset / 3) * 3);
  }

  function fiscalQuarterNo(d) {
    var fy = startOfFiscalYear(d);
    var offset = (d.getFullYear() - fy.getFullYear()) * 12 + (d.getMonth() - fy.getMonth());
    return Math.floor(offset / 3) + 1;
  }

  function weekday(d) {
    return WD[d.getDay()];
  }

  /* 日本の祝日（2026年7月〜2027年6月）。年度が変わったら追記する。 */
  var HOLIDAYS = {
    "2026-07-20": "海の日",
    "2026-08-11": "山の日",
    "2026-09-21": "敬老の日",
    "2026-09-22": "国民の休日",
    "2026-09-23": "秋分の日",
    "2026-10-12": "スポーツの日",
    "2026-11-03": "文化の日",
    "2026-11-23": "勤労感謝の日",
    "2027-01-01": "元日",
    "2027-01-11": "成人の日",
    "2027-02-11": "建国記念の日",
    "2027-02-23": "天皇誕生日",
    "2027-03-21": "春分の日",
    "2027-03-22": "振替休日",
    "2027-04-29": "昭和の日",
    "2027-05-03": "憲法記念日",
    "2027-05-04": "みどりの日",
    "2027-05-05": "こどもの日"
  };

  function isHoliday(d) {
    return HOLIDAYS[iso(d)] || null;
  }

  function isNonWorkday(d) {
    return d.getDay() === 0 || d.getDay() === 6 || !!isHoliday(d);
  }

  /* -------------------------------------------------------- 項目の正規化 */

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  /** 担当者マスタ。ガント項目・タスク・アイデアメモから id で参照する。 */
  function normalizeMember(raw) {
    var m = Object.assign({}, raw);
    m.id = m.id || uuid();
    m.name = (m.name || "").trim() || "名称未設定";
    m.color = /^#[0-9a-fA-F]{6}$/.test(m.color) ? m.color : GROUP_COLORS[0];
    m.note = m.note || "";
    if (typeof m.sort_order !== "number") m.sort_order = 0;
    return m;
  }

  /**
   * 担当者の割り当ては複数人ぶんの配列で持つ。
   * 旧データ（1人ぶんの文字列）もここで配列に揃える。
   */
  function memberList(v) {
    if (Array.isArray(v)) {
      return v.filter(function (x) { return typeof x === "string" && x.trim(); })
        .map(function (x) { return x.trim(); });
    }
    if (typeof v === "string" && v.trim()) return [v.trim()];
    return [];
  }

  /** アバターに出す1文字（英字なら大文字、日本語はそのまま） */
  function memberInitial(name) {
    var s = (name || "").trim();
    if (!s) return "?";
    return s.charAt(0).toUpperCase();
  }

  function normalizeGroup(raw) {
    var g = Object.assign({}, raw);
    g.id = g.id || uuid();
    g.name = (g.name || "").trim() || "新しいグループ";
    g.color = /^#[0-9a-fA-F]{6}$/.test(g.color) ? g.color : GROUP_COLORS[0];
    if (typeof g.sort_order !== "number") g.sort_order = 0;
    return g;
  }

  /** 保存前・読込後の両方で通す。欠けたフィールドを埋め、期間の前後を直す。 */
  function normalizeItem(raw) {
    var it = Object.assign({}, raw);
    it.id = it.id || uuid();
    it.group_id = it.group_id || null; // 実在チェックは store 側で行う
    it.title = (it.title || "").trim() || "（無題）";
    it.start_date = it.start_date || iso(today());
    it.end_date = it.end_date || it.start_date;
    if (it.end_date < it.start_date) it.end_date = it.start_date;
    // ステータス・優先度・媒体の選択肢はユーザーが編集できるため、
    // ここでは固定リストと突き合わせず、値をそのまま保つ。
    it.status = it.status || "todo";
    // バーの色。空ならグループの色を継承する
    it.color = /^#[0-9a-fA-F]{6}$/.test(it.color) ? it.color : "";
    it.progress = Math.min(100, Math.max(0, +it.progress || 0));
    if (typeof it.sort_order !== "number") it.sort_order = 0;

    var d = Object.assign({}, it.detail);
    d.channels = (d.channels || []).filter(function (c) { return typeof c === "string" && c; });
    d.refs = d.refs || [];
    d.body = d.body || "";
    d.text_owner = memberList(d.text_owner);
    d.visual_owner = memberList(d.visual_owner);
    d.priority = d.priority || "";
    d.props = (d.props && typeof d.props === "object") ? d.props : {}; // カスタムプロパティの値 {propId: value}
    it.detail = d;
    return it;
  }

  var EVENT_KINDS = { season: "季節イベント", popup: "出店・POP-UP", holiday: "祝日・休業" };

  /* カスタムプロパティ（Notion風）。項目の詳細画面で追加・削除できる。 */
  var PROP_TYPES = {
    select: "選択",
    multiselect: "マルチセレクト",
    text: "テキスト",
    number: "数字",
    daterange: "期間",
    status: "ステータス",
    url: "URL"
  };

  function normalizePropDef(raw) {
    var p = Object.assign({}, raw);
    p.id = p.id || uuid();
    p.name = (p.name || "").trim() || "プロパティ";
    p.type = PROP_TYPES[p.type] ? p.type : "text";
    p.options = Array.isArray(p.options) ? p.options : [];
    if (p.type === "status" && !p.options.length) {
      p.options = ["未着手", "進行中", "完了"];
    }
    if (typeof p.sort_order !== "number") p.sort_order = 0;
    return p;
  }

  /** 季節イベント・出店（ガント上部の帯）。 */
  function normalizeEvent(raw) {
    var e = Object.assign({}, raw);
    e.id = e.id || uuid();
    e.label = (e.label || "").trim() || "（無題のイベント）";
    e.date = e.date || iso(today());
    e.end_date = e.end_date || e.date;
    if (e.end_date < e.date) e.end_date = e.date;
    e.kind = EVENT_KINDS[e.kind] ? e.kind : "season";
    return e;
  }

  /** タスク: ガント項目（item_id）にぶら下がる ToDo。 */
  function normalizeTask(raw) {
    var t = Object.assign({}, raw);
    t.id = t.id || uuid();
    t.item_id = t.item_id || null;
    t.parent_id = t.parent_id || null;         // 子タスクの親（null=トップレベル）
    t.task_group_id = t.task_group_id || null; // タスク独自グループ（null=未分類）
    t.note = t.note || "";                     // テキストメモ
    t.title = (t.title || "").trim();          // 空のままでも可（入力欄にプレースホルダを出す）
    t.done = !!t.done;
    t.owner = memberList(t.owner);
    t.due_date = t.due_date || "";
    if (typeof t.sort_order !== "number") t.sort_order = 0;
    return t;
  }

  function normalizeTaskGroup(raw) {
    var g = Object.assign({}, raw);
    g.id = g.id || uuid();
    g.name = (g.name || "").trim() || "新しいグループ";
    g.color = g.color || null;
    if (typeof g.sort_order !== "number") g.sort_order = 0;
    return g;
  }

  function normalizeIdea(raw) {
    var i = Object.assign({}, raw);
    i.id = i.id || uuid();
    i.author = memberList(i.author);
    i.body = i.body || "";
    i.ref_url = i.ref_url || "";
    i.created_at = i.created_at || iso(today());
    return i;
  }

  function durationDays(it) {
    return diffDays(parse(it.start_date), parse(it.end_date)) + 1;
  }

  return {
    FISCAL_START_MONTH: FISCAL_START_MONTH,
    DEFAULT_GROUPS: DEFAULT_GROUPS,
    GROUP_COLORS: GROUP_COLORS,
    COLOR_PALETTE: COLOR_PALETTE,
    colorName: colorName,
    STATUSES: STATUSES,
    CHANNELS: CHANNELS,
    CHANNEL_ORDER: CHANNEL_ORDER,
    PRIORITIES: PRIORITIES,
    DEFAULT_FIELDS: DEFAULT_FIELDS,
    FIELD_ORDER: FIELD_ORDER,
    HOLIDAYS: HOLIDAYS,
    parse: parse,
    iso: iso,
    today: today,
    addDays: addDays,
    addMonths: addMonths,
    diffDays: diffDays,
    startOfWeek: startOfWeek,
    startOfMonth: startOfMonth,
    endOfMonth: endOfMonth,
    startOfFiscalYear: startOfFiscalYear,
    startOfFiscalQuarter: startOfFiscalQuarter,
    fiscalQuarterNo: fiscalQuarterNo,
    weekday: weekday,
    isHoliday: isHoliday,
    isNonWorkday: isNonWorkday,
    uuid: uuid,
    EVENT_KINDS: EVENT_KINDS,
    PROP_TYPES: PROP_TYPES,
    normalizePropDef: normalizePropDef,
    normalizeMember: normalizeMember,
    normalizeIdea: normalizeIdea,
    memberList: memberList,
    memberInitial: memberInitial,
    normalizeGroup: normalizeGroup,
    normalizeItem: normalizeItem,
    normalizeEvent: normalizeEvent,
    normalizeTask: normalizeTask,
    normalizeTaskGroup: normalizeTaskGroup,
    durationDays: durationDays
  };
})();
