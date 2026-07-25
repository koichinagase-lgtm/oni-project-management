/* app.js — 画面全体の状態管理とイベント配線 */

var ONI = window.ONI || {};
window.ONI = ONI;

ONI.app = (function () {
  "use strict";

  var M = ONI.model;
  var UI_KEY = "oni-pm/ui/v1";

  var ui = {
    tab: "gantt",
    view: "month",
    anchor: M.iso(M.today()),
    search: "",
    hiddenGroups: [],   // 非表示にするグループの id（既定は全表示）
    hiddenStatuses: [], // 非表示にするステータスの key（既定は全表示）
    channels: [],
    collapsed: {},
    taskSearch: "",
    taskView: "today",  // inbox / today / upcoming / all / done / item / member / group
    taskItem: null,     // taskView=item のときの対象（"__none"=未割り当て）
    taskMember: null,   // taskView=member のときの対象（"__none"=担当者なし）
    taskGroup: null,    // taskView=group のときの対象（"__none"=タグなし。UI表記は「タグ」）
    taskHideEmpty: false // タスクが1件もない項目・INBOXをナビから隠す
  };

  var $ = function (id) { return document.getElementById(id); };

  /* 選択中の項目（チェックボックス）。画面を閉じるまでの一時的な状態なので保存しない。 */
  var selected = {};
  function selectedIds() { return Object.keys(selected).filter(function (id) { return selected[id]; }); }

  function saveUI() {
    try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch (e) { /* 無視して続行 */ }
  }

  function loadUI() {
    try {
      var s = JSON.parse(localStorage.getItem(UI_KEY) || "null");
      if (s) Object.assign(ui, s);
    } catch (e) { /* 既定値のまま */ }
    // 「担当者」タブは廃止（アカウント管理へ移管）。保存値が残っていたらガントに戻す
    if (ui.tab === "members") ui.tab = "gantt";
  }

  /* -------------------------------------------------------------- toast */

  var toastTimer = null;
  function toast(msg) {
    var t = document.querySelector(".toast");
    if (!t) {
      t = document.createElement("div");
      t.className = "toast";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.remove(); }, 2600);
  }

  /* 新規項目を作って詳細パネルを開く。ガントの表示範囲内（なければ今日）に置く。 */
  function addItem(patch) {
    var r = ONI.gantt.rangeFor(ui.view, M.parse(ui.anchor));
    var t = M.today();
    var d = (t >= r.start && t <= r.end) ? t : r.start;
    var it = ONI.store.createItem(Object.assign({
      title: "（無題）",
      start_date: M.iso(d),
      end_date: M.iso(d)
    }, patch));
    ONI.detail.open(it.id);
    return it;
  }

  /* ------------------------------------------------------------ 絞り込み */

  function visibleItems() {
    var q = ui.search.trim().toLowerCase();
    return ONI.store.items().filter(function (it) {
      if (ui.hiddenGroups.indexOf(it.group_id) >= 0) return false;
      if (ui.hiddenStatuses.indexOf(it.status) >= 0) return false;
      if (ui.channels.length) {
        var chs = it.detail.channels || [];
        var hit = ui.channels.some(function (c) { return chs.indexOf(c) >= 0; });
        if (!hit) return false;
      }
      if (q) {
        var hay = (it.title + " " + (it.detail.body || "") + " "
          + ONI.store.memberNames(it.detail.text_owner) + " "
          + ONI.store.memberNames(it.detail.visual_owner)).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  function activeFilterCount() {
    var n = 0;
    if (ui.hiddenGroups.length) n++;
    if (ui.hiddenStatuses.length) n++;
    if (ui.channels.length) n++;
    return n;
  }

  /* -------------------------------------------------------------- 描画 */

  function renderGantt() {
    var scroller = $("gantt-scroll");
    var keepLeft = scroller.scrollLeft;
    var keepTop = scroller.scrollTop;

    // 描画範囲（前後1期間を含む連続レンジ）に重なる項目だけを行にする
    var r = ONI.gantt.renderedRangeFor(ui.view, M.parse(ui.anchor));
    var from = M.iso(r.start), to = M.iso(r.end);
    var all = visibleItems();
    var inRange = all.filter(function (it) {
      return it.end_date >= from && it.start_date <= to;
    });
    $("outside-count").textContent = all.length > inRange.length
      ? "この期間の外にあと " + (all.length - inRange.length) + " 件" : "";

    ONI.gantt.render($("gantt"), {
      view: ui.view,
      anchor: M.parse(ui.anchor),
      items: inRange,
      groups: ONI.store.groups(),
      events: ONI.store.events(),
      collapsed: ui.collapsed,
      selected: selected,
      onSelect: function (id, on) {
        if (on) selected[id] = true; else delete selected[id];
        renderGantt();
      },
      onOpen: function (id) { ONI.detail.open(id); },
      onCreate: function (dateStart, groupId, dateEnd) {
        var it = ONI.store.createItem({
          group_id: groupId || (ONI.store.groups()[0] || {}).id || null,
          title: "（無題）",
          start_date: dateStart,
          end_date: dateEnd || dateStart
        });
        ONI.detail.open(it.id);
      },
      onChange: function (id, patch) {
        if (patch) ONI.store.updateItem(id, patch);
        else renderGantt();
      },
      onMoveItem: function (itemId, target) {
        // ドロップ先の行位置から挿入インデックスを計算する
        var index;
        if (target.rowId) {
          var siblings = ONI.store.items()
            .filter(function (x) { return x.group_id === target.groupId && x.id !== itemId; })
            .sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });
          var idx = siblings.findIndex(function (x) { return x.id === target.rowId; });
          index = idx < 0 ? siblings.length : (target.before ? idx : idx + 1);
        } else {
          index = target.index || 0;
        }
        ONI.store.moveItem(itemId, target.groupId, index);
      },
      onMoveGroup: function (groupId, target) {
        ONI.store.reorderGroup(groupId, target.groupId, target.before);
      },
      onToggleGroup: function (gid) {
        ui.collapsed[gid] = !ui.collapsed[gid];
        saveUI();
        renderGantt();
      },
      onAddItem: function (groupId) { addItem({ group_id: groupId }); },
      onCreateEvent: function (date) { openEventModal(null, date); },
      onEditEvent: function (id) { openEventModal(id, null); },
      onAddGroup: function () {
        var name = prompt("新しいグループ名を入力してください");
        if (name == null || !name.trim()) return;
        ONI.store.createGroup({ name: name.trim() });
        toast("グループを追加しました");
      },
      onRenameGroup: function (gid) {
        var g = ONI.store.getGroup(gid);
        if (!g) return;
        var name = prompt("グループ名を変更", g.name);
        if (name == null || !name.trim()) return;
        ONI.store.updateGroup(gid, { name: name.trim() });
      },
      onRecolorGroup: function (gid, color) { ONI.store.updateGroup(gid, { color: color }); },
      onDeleteGroup: function (gid) {
        var g = ONI.store.getGroup(gid);
        if (!g) return;
        var count = ONI.store.items().filter(function (it) { return it.group_id === gid; }).length;
        var msg = "グループ「" + g.name + "」を削除します。"
          + (count ? "\nこのグループの項目 " + count + " 件とそのタスクも削除されます。" : "")
          + "\nよろしいですか？";
        if (!confirm(msg)) return;
        ONI.store.deleteGroup(gid);
        toast("グループを削除しました");
      }
    });

    renderLegend();
    renderBulkBar();
    syncFilterUI(); // グループ・ステータス・媒体の編集をフィルタUIにも反映
    scroller.scrollLeft = keepLeft;
    scroller.scrollTop = keepTop;
    updateRangeLabel();
  }

  /* ---------------------------------------------- 連続スクロール */

  var shiftLock = false; // 期間延長の再描画中にスクロールイベントを無視する

  /** ビューポート中央にある日付から期間ラベルを更新する */
  function updateRangeLabel() {
    var scroller = $("gantt-scroll");
    var r = ONI.gantt.renderedRangeFor(ui.view, M.parse(ui.anchor));
    var ppd = ONI.gantt.VIEWS[ui.view].pxPerDay;
    var sidebarW = 300;
    var centerPx = scroller.scrollLeft + (scroller.clientWidth - sidebarW) / 2;
    var centerDate = M.addDays(r.start, Math.round(centerPx / ppd));
    $("range-label").textContent = ONI.gantt.rangeLabel(ui.view, centerDate);
  }

  /** スクロールが端に近づいたら anchor を1期間ずらし、見た目の位置を保ったまま描き直す */
  function shiftPeriod(dir) {
    shiftLock = true;
    var scroller = $("gantt-scroll");
    var ppd = ONI.gantt.VIEWS[ui.view].pxPerDay;
    var oldStart = ONI.gantt.renderedRangeFor(ui.view, M.parse(ui.anchor)).start;
    ui.anchor = M.iso(ONI.gantt.step(ui.view, M.parse(ui.anchor), dir));
    saveUI();
    renderGantt();
    var newStart = ONI.gantt.renderedRangeFor(ui.view, M.parse(ui.anchor)).start;
    scroller.scrollLeft += M.diffDays(newStart, oldStart) * ppd;
    shiftLock = false;
  }

  function onGanttScroll() {
    if (ui.tab !== "gantt" || shiftLock) return;
    updateRangeLabel();
    var scroller = $("gantt-scroll");
    var max = scroller.scrollWidth - scroller.clientWidth;
    if (max <= 0) return;
    // 端から約半期間を切ったら描画範囲をずらす
    var threshold = Math.max(240, ONI.gantt.periodPx(ui.view, M.parse(ui.anchor)) * 0.5);
    if (scroller.scrollLeft < threshold) shiftPeriod(-1);
    else if (scroller.scrollLeft > max - threshold) shiftPeriod(1);
  }

  /** 前後ボタン・キー操作: 1期間ぶんなめらかにスライドする。
      ネイティブの smooth scroll は絶対座標に向かうため、途中で描画範囲が
      延長されると着地点がずれる。相対量を rAF で刻んで加算する方式にする。 */
  var slideAnim = null;
  function slideBy(dir) {
    var scroller = $("gantt-scroll");
    var total = dir * ONI.gantt.periodPx(ui.view, M.parse(ui.anchor));
    if (slideAnim) cancelAnimationFrame(slideAnim);
    var duration = 260;
    var t0 = performance.now();
    var moved = 0;
    function ease(t) { return t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
    function frame(now) {
      var p = Math.min(1, (now - t0) / duration);
      var want = total * ease(p);
      scroller.scrollLeft += want - moved; // 相対加算なので途中の範囲延長に影響されない
      moved = want;
      if (p < 1) slideAnim = requestAnimationFrame(frame);
      else slideAnim = null;
    }
    slideAnim = requestAnimationFrame(frame);
  }

  /** 選択中の項目があるときだけ出る一括操作バー */
  function renderBulkBar() {
    var bar = $("bulkbar");
    // 消えた項目の選択が残らないように掃除する
    selectedIds().forEach(function (id) { if (!ONI.store.getItem(id)) delete selected[id]; });
    var ids = selectedIds();
    if (!ids.length) { bar.hidden = true; bar.innerHTML = ""; return; }

    bar.hidden = false;
    bar.innerHTML = "";
    bar.appendChild(Object.assign(document.createElement("span"),
      { className: "bulkbar-count", textContent: ids.length + "件を選択中" }));

    var del = document.createElement("button");
    del.className = "btn btn-danger";
    del.textContent = "選択した項目を削除";
    del.addEventListener("click", function () {
      var taskCount = ONI.store.tasks().filter(function (t) { return ids.indexOf(t.item_id) >= 0; }).length;
      var msg = ids.length + "件の項目を削除します。"
        + (taskCount ? "\nぶら下がるタスク " + taskCount + " 件も一緒に削除されます。" : "")
        + "\nよろしいですか？";
      if (!confirm(msg)) return;
      var n = ONI.store.deleteItems(ids);
      selected = {};
      toast(n + "件を削除しました");
    });
    bar.appendChild(del);

    var clear = document.createElement("button");
    clear.className = "btn btn-ghost";
    clear.textContent = "選択を解除";
    clear.addEventListener("click", function () { selected = {}; renderGantt(); });
    bar.appendChild(clear);
  }

  function renderLegend() {
    var host = $("legend-groups");
    host.innerHTML = "";
    ONI.store.groups().forEach(function (g) {
      var span = document.createElement("span");
      var sw = document.createElement("i");
      sw.className = "swatch";
      sw.style.background = g.color;
      span.appendChild(sw);
      span.appendChild(document.createTextNode(g.name));
      host.appendChild(span);
    });
  }

  /** 今日（描画範囲外なら基準期間の先頭）が見える位置まで横スクロールする */
  function scrollToToday() {
    var scroller = $("gantt-scroll");
    var r = ONI.gantt.renderedRangeFor(ui.view, M.parse(ui.anchor));
    var ppd = ONI.gantt.VIEWS[ui.view].pxPerDay;
    var t = M.today();
    if (t < r.start || t > r.end) t = ONI.gantt.rangeFor(ui.view, M.parse(ui.anchor)).start;
    var x = M.diffDays(r.start, t) * ppd;
    shiftLock = true; // 位置合わせで端の延長判定が走らないように
    scroller.scrollLeft = Math.max(0, x - scroller.clientWidth / 3);
    shiftLock = false;
    updateRangeLabel();
  }

  /* ------------------------------------------------------ 汎用モーダル */

  function closeModal() {
    $("modal-overlay").hidden = true;
    $("modal").innerHTML = "";
  }

  /** モーダルを開いて中身のノードを返す */
  function openModal(titleText) {
    var m = $("modal");
    m.innerHTML = "";
    var h = document.createElement("div");
    h.className = "modal-title";
    h.textContent = titleText;
    m.appendChild(h);
    $("modal-overlay").hidden = false;
    return m;
  }

  /** 季節イベントの追加・編集フォーム。eventId が null なら新規作成。 */
  function openEventModal(eventId, defaultDate) {
    var ev = eventId ? ONI.store.getEvent(eventId) : null;
    var m = openModal(ev ? "イベントを編集" : "イベントを追加");

    function field(labelText, inputEl) {
      var row = document.createElement("label");
      row.className = "modal-field";
      var span = document.createElement("span");
      span.textContent = labelText;
      row.appendChild(span);
      row.appendChild(inputEl);
      m.appendChild(row);
      return inputEl;
    }

    var name = document.createElement("input");
    name.type = "text";
    name.className = "input";
    name.placeholder = "例: お盆 / 三越POP-UP";
    name.value = ev ? ev.label : "";
    field("イベント名", name);

    var kind = document.createElement("select");
    kind.className = "input";
    Object.keys(M.EVENT_KINDS).forEach(function (k) {
      var o = document.createElement("option");
      o.value = k;
      o.textContent = M.EVENT_KINDS[k];
      if (ev && ev.kind === k) o.selected = true;
      kind.appendChild(o);
    });
    field("種類", kind);

    var start = document.createElement("input");
    start.type = "date";
    start.className = "input";
    start.value = ev ? ev.date : (defaultDate || M.iso(M.today()));
    field("開始日", start);

    var end = document.createElement("input");
    end.type = "date";
    end.className = "input";
    end.value = ev ? ev.end_date : (defaultDate || M.iso(M.today()));
    field("終了日（単発は開始日と同じ）", end);

    start.addEventListener("change", function () { if (end.value < start.value) end.value = start.value; });

    var foot = document.createElement("div");
    foot.className = "modal-foot";

    if (ev) {
      var del = document.createElement("button");
      del.className = "btn btn-danger";
      del.textContent = "削除";
      del.addEventListener("click", function () {
        if (!confirm("イベント「" + ev.label + "」を削除しますか？")) return;
        ONI.store.deleteEvent(ev.id);
        closeModal();
        toast("イベントを削除しました");
      });
      foot.appendChild(del);
    }

    var spacer = document.createElement("span");
    spacer.className = "spacer";
    foot.appendChild(spacer);

    var cancel = document.createElement("button");
    cancel.className = "btn btn-ghost";
    cancel.textContent = "キャンセル";
    cancel.addEventListener("click", closeModal);
    foot.appendChild(cancel);

    var save = document.createElement("button");
    save.className = "btn btn-primary";
    save.textContent = "保存";
    save.addEventListener("click", function () {
      if (!name.value.trim()) { name.focus(); return; }
      var patch = {
        label: name.value.trim(),
        kind: kind.value,
        date: start.value,
        end_date: end.value < start.value ? start.value : end.value
      };
      if (ev) ONI.store.updateEvent(ev.id, patch);
      else ONI.store.createEvent(patch);
      closeModal();
      toast(ev ? "イベントを更新しました" : "イベントを追加しました");
    });
    foot.appendChild(save);

    m.appendChild(foot);
    setTimeout(function () { name.focus(); }, 0);
  }

  /* タスク管理: 全項目のタスク（ガント項目にぶら下がる ToDo）を横断して一覧・編集する。
     ここでの変更はガント項目の詳細内タスクと即同期する。 */
  /* ==================== タスク管理（Todoist風） ==================== */

  var taskOpenAdd = null;    // 開いているクイック追加のセクションkey
  var taskNoteOpen = {};     // メモ欄を開いているタスク id
  var taskSubOpen = {};      // サブタスク欄を開いているタスク id
  var taskSearchTimer = null;

  function tdToday() { return M.iso(M.today()); }

  function taskItemOf(t) { return ONI.store.getItem(t.item_id); }

  /** その項目に属する親タスク（子タスクは除く）。「空を隠す」の判定に使う。 */
  function topLevelForItem(itemId) {
    return ONI.store.tasksForItem(itemId).filter(function (t) { return !t.parent_id; });
  }

  function sortTasks(list) {
    return list.slice().sort(function (a, b) {
      var da = a.due_date || "9999-12-31", db = b.due_date || "9999-12-31";
      if (da !== db) return da < db ? -1 : 1;
      return (a.created_at || "") < (b.created_at || "") ? -1 : 1;
    });
  }

  /** 期限の表示ラベルと色クラス（Todoist風: 期限切れ=赤 / 今日=緑 / 明日=橙） */
  function dueMeta(t) {
    if (!t.due_date) return { label: "期限なし", cls: "due-none" };
    var d = M.parse(t.due_date);
    var diff = M.diffDays(M.today(), d);
    var label;
    if (diff === 0) label = "今日";
    else if (diff === 1) label = "明日";
    else if (diff === -1) label = "昨日";
    else if (diff > 1 && diff <= 6) label = M.weekday(d) + "曜日";
    else label = (d.getMonth() + 1) + "月" + d.getDate() + "日"
      + (d.getFullYear() !== M.today().getFullYear() ? " " + d.getFullYear() : "");
    var cls = diff < 0 ? "due-over" : diff === 0 ? "due-today" : diff === 1 ? "due-soon" : "due-later";
    return { label: label, cls: cls };
  }

  /** 現在のビューに応じたセクション一覧。add はクイック追加が新規タスクに引き継ぐ値。 */
  function taskSections() {
    var q = ui.taskSearch.trim().toLowerCase();
    var all = ONI.store.tasks().filter(function (t) {
      if (t.parent_id) return false;   // 子タスクは親行の下にだけ出す（一覧には出さない）
      if (!q) return true;
      var it = taskItemOf(t);
      var kids = ONI.store.subtasksOf(t.id).map(function (k) { return k.title; }).join(" ");
      return (t.title + " " + kids + " " + ONI.store.memberNames(t.owner) + " " + ((it && it.title) || ""))
        .toLowerCase().indexOf(q) >= 0;
    });
    var open = all.filter(function (t) { return !t.done; });
    var today = tdToday();
    var secs = [];

    if (ui.taskView === "inbox") {
      // 期限を決めていないタスクの置き場
      secs.push({
        key: "inbox", label: null,
        tasks: sortTasks(open.filter(function (t) { return !t.due_date; })),
        add: {}
      });

    } else if (ui.taskView === "today") {
      var over = sortTasks(open.filter(function (t) { return t.due_date && t.due_date < today; }));
      if (over.length) secs.push({ key: "over", label: "期限切れ", cls: "is-over", tasks: over });
      secs.push({
        key: "today", label: "今日",
        tasks: sortTasks(open.filter(function (t) { return t.due_date === today; })),
        add: { due_date: today }
      });

    } else if (ui.taskView === "upcoming") {
      var over2 = sortTasks(open.filter(function (t) { return t.due_date && t.due_date < today; }));
      if (over2.length) secs.push({ key: "over", label: "期限切れ", cls: "is-over", tasks: over2 });
      for (var i = 0; i <= 6; i++) {
        var d = M.addDays(M.today(), i);
        var iso = M.iso(d);
        var label = (d.getMonth() + 1) + "月" + d.getDate() + "日 ・ "
          + (i === 0 ? "今日" : i === 1 ? "明日" : M.weekday(d) + "曜日");
        secs.push({
          key: "d" + iso, label: label,
          tasks: sortTasks(open.filter(function (t) { return t.due_date === iso; })),
          add: { due_date: iso }
        });
      }
      var horizon = M.iso(M.addDays(M.today(), 6));
      var later = sortTasks(open.filter(function (t) { return t.due_date && t.due_date > horizon; }));
      if (later.length) secs.push({ key: "later", label: "それ以降", tasks: later });
      // 期限なしは INBOX に集約したのでここには出さない

    } else if (ui.taskView === "all") {
      var unassigned = sortTasks(open.filter(function (t) { return !taskItemOf(t); }));
      if (unassigned.length) {
        secs.push({ key: "un", label: "未割り当て", color: "#9A9187", tasks: unassigned, add: {} });
      }
      ONI.store.items().forEach(function (it) {
        // タスクが1件もない項目は、設定に応じて丸ごと省く
        if (ui.taskHideEmpty && !topLevelForItem(it.id).length) return;
        secs.push({
          key: "it" + it.id, label: it.title, color: ONI.store.colorOf(it), itemId: it.id,
          tasks: sortTasks(open.filter(function (t) { return t.item_id === it.id; })),
          add: { item_id: it.id }
        });
      });

    } else if (ui.taskView === "done") {
      secs.push({
        key: "done", label: null,
        tasks: all.filter(function (t) { return t.done; }).slice().reverse()
      });

    } else if (ui.taskView === "member") {
      var forMember = ui.taskMember === "__none"
        ? all.filter(function (t) { return !t.owner.length; })
        : all.filter(function (t) { return t.owner.indexOf(ui.taskMember) >= 0; });
      secs.push({
        key: "mopen", label: null,
        tasks: sortTasks(forMember.filter(function (t) { return !t.done; })),
        add: ui.taskMember === "__none" ? {} : { owner: [ui.taskMember] }
      });
      var doneForMember = forMember.filter(function (t) { return t.done; });
      if (doneForMember.length) {
        secs.push({ key: "mdone", label: "完了済み", tasks: doneForMember });
      }

    } else if (ui.taskView === "item") {
      var mine;
      if (ui.taskItem === "__none") {
        mine = all.filter(function (t) { return !taskItemOf(t); });
      } else {
        var target = ONI.store.getItem(ui.taskItem);
        if (!target) { ui.taskView = "all"; return taskSections(); }
        mine = all.filter(function (t) { return t.item_id === target.id; });
      }
      secs.push({
        key: "open", label: null,
        tasks: sortTasks(mine.filter(function (t) { return !t.done; })),
        add: ui.taskItem === "__none" ? {} : { item_id: ui.taskItem }
      });
      var doneMine = mine.filter(function (t) { return t.done; });
      if (doneMine.length) secs.push({ key: "donem", label: "完了済み", tasks: doneMine });

    } else if (ui.taskView === "group") {
      var mineG = ui.taskGroup === "__none"
        ? all.filter(function (t) { return !t.task_group_id; })
        : all.filter(function (t) { return t.task_group_id === ui.taskGroup; });
      secs.push({
        key: "gopen", label: null,
        tasks: sortTasks(mineG.filter(function (t) { return !t.done; })),
        add: ui.taskGroup === "__none" ? {} : { task_group_id: ui.taskGroup }
      });
      var doneG = mineG.filter(function (t) { return t.done; });
      if (doneG.length) secs.push({ key: "doneg", label: "完了済み", tasks: doneG });
    }
    return secs;
  }

  /* --- 再描画をまたいでフォーカスを保つ（data-fkey を目印にする） --- */

  function captureFocus() {
    var a = document.activeElement;
    if (a && a.dataset && a.dataset.fkey) {
      var f = { key: a.dataset.fkey, s: null, e: null };
      try { f.s = a.selectionStart; f.e = a.selectionEnd; } catch (e) { /* date入力等 */ }
      return f;
    }
    return null;
  }

  function restoreFocus(scope, f) {
    if (!f) return false;
    var n = scope.querySelector('[data-fkey="' + f.key + '"]');
    if (!n) return false;
    n.focus();
    try { if (f.s != null) n.setSelectionRange(f.s, f.e); } catch (e) { /* 対応外の入力 */ }
    return true;
  }

  function renderTasks() {
    var focus = captureFocus();
    renderTaskNav();
    renderTaskMain();
    restoreFocus($("task-main"), focus);
  }

  /* --- 左ナビ --- */

  function renderTaskNav() {
    var nav = $("task-nav");
    nav.innerHTML = "";
    // 子タスクは数えない（一覧に出るのは親タスクだけなので、件数も揃える）
    var open = ONI.store.tasks().filter(function (t) { return !t.done && !t.parent_id; });
    var today = tdToday();

    function navBtn(active, label, count, onClick) {
      var b = document.createElement("button");
      b.className = "task-nav-btn" + (active ? " is-active" : "");
      var name = document.createElement("span");
      name.className = "task-nav-name";
      name.textContent = label;
      b.appendChild(name);
      if (count) {
        b.appendChild(Object.assign(document.createElement("span"),
          { className: "task-nav-count", textContent: String(count) }));
      }
      b.addEventListener("click", onClick);
      nav.appendChild(b);
      return b;
    }

    var todayCount = open.filter(function (t) { return t.due_date && t.due_date <= today; }).length;
    var inboxCount = open.filter(function (t) { return !t.due_date; }).length;

    // INBOXは常に置いておく（空でも新しいタスクの受け皿として使うため）
    [
      { id: "inbox", label: "INBOX", count: inboxCount },
      { id: "today", label: "今日", count: todayCount },
      { id: "upcoming", label: "近日予定" },
      { id: "all", label: "すべて" },
      { id: "done", label: "完了済み" }
    ].forEach(function (v) {
      navBtn(ui.taskView === v.id, v.label, v.count, function () {
        ui.taskView = v.id;
        ui.taskItem = null;
        taskOpenAdd = null;
        saveUI();
        renderTasks();
      });
    });

    var navHead = document.createElement("div");
    navHead.className = "task-nav-head";
    navHead.appendChild(Object.assign(document.createElement("span"), { textContent: "項目" }));
    var toggle = document.createElement("button");
    toggle.className = "task-nav-toggle";
    toggle.textContent = ui.taskHideEmpty ? "すべて表示" : "空を隠す";
    toggle.title = ui.taskHideEmpty
      ? "タスクのない項目も表示する"
      : "タスクが1件もない項目を隠す";
    toggle.addEventListener("click", function () {
      ui.taskHideEmpty = !ui.taskHideEmpty;
      saveUI();
      renderTasks();
    });
    navHead.appendChild(toggle);
    nav.appendChild(navHead);

    var unassignedCount = open.filter(function (t) { return !taskItemOf(t); }).length;
    if (unassignedCount) {
      var ub = navBtn(ui.taskView === "item" && ui.taskItem === "__none",
        "未割り当て", unassignedCount, function () {
          ui.taskView = "item"; ui.taskItem = "__none"; taskOpenAdd = null;
          saveUI(); renderTasks();
        });
      var udot = document.createElement("i");
      udot.className = "g-dot";
      udot.style.background = "#9A9187";
      ub.insertBefore(udot, ub.firstChild);
    }

    var hiddenItems = 0;
    ONI.store.items().forEach(function (it) {
      var count = open.filter(function (t) { return t.item_id === it.id; }).length;
      // タスクが1件も割り当てられていない項目は隠せる（表示中のものは残す）
      var isCurrent = ui.taskView === "item" && ui.taskItem === it.id;
      if (ui.taskHideEmpty && !topLevelForItem(it.id).length && !isCurrent) {
        hiddenItems++;
        return;
      }
      var b = navBtn(isCurrent,
        it.title, count, function () {
          ui.taskView = "item"; ui.taskItem = it.id; taskOpenAdd = null;
          saveUI(); renderTasks();
        });
      var dot = document.createElement("i");
      dot.className = "g-dot";
      dot.style.background = ONI.store.colorOf(it);
      b.insertBefore(dot, b.firstChild);
    });

    if (hiddenItems) {
      nav.appendChild(Object.assign(document.createElement("div"),
        { className: "task-nav-note", textContent: "タスクなしの項目 " + hiddenItems + " 件を非表示" }));
    }

    /* --- 担当者ごとのグループ --- */
    var memberList = ONI.store.members();
    if (memberList.length) {
      nav.appendChild(Object.assign(document.createElement("div"),
        { className: "task-nav-head", textContent: "担当者" }));

      var noOwnerCount = open.filter(function (t) { return !t.owner.length; }).length;
      if (noOwnerCount || (ui.taskView === "member" && ui.taskMember === "__none")) {
        var nb = navBtn(ui.taskView === "member" && ui.taskMember === "__none",
          "担当者なし", noOwnerCount, function () {
            ui.taskView = "member"; ui.taskMember = "__none"; ui.taskItem = null; taskOpenAdd = null;
            saveUI(); renderTasks();
          });
        nb.insertBefore(ONI.ui.memberAvatar(null), nb.firstChild);
      }

      memberList.forEach(function (m) {
        var count = open.filter(function (t) { return t.owner.indexOf(m.id) >= 0; }).length;
        var isCur = ui.taskView === "member" && ui.taskMember === m.id;
        // 担当タスクが1件も無い人は、項目と同じ設定で隠せる
        if (ui.taskHideEmpty && !count && !isCur) return;
        var b = navBtn(isCur, m.name, count, function () {
          ui.taskView = "member"; ui.taskMember = m.id; ui.taskItem = null; taskOpenAdd = null;
          saveUI(); renderTasks();
        });
        b.insertBefore(ONI.ui.memberAvatar(m), b.firstChild);
      });
    }

    /* --- タスクのタグ（ガントのグループとは別。UI表記は「タグ」） --- */
    var tgHead = document.createElement("div");
    tgHead.className = "task-nav-head";
    tgHead.appendChild(Object.assign(document.createElement("span"), { textContent: "タグ" }));
    var addG = document.createElement("button");
    addG.className = "task-nav-toggle";
    addG.textContent = "＋ 追加";
    addG.title = "タグを追加";
    addG.addEventListener("click", function () {
      var name = prompt("新しいタグ名を入力してください");
      if (name == null || !name.trim()) return;
      var g = ONI.store.createTaskGroup({ name: name.trim() });
      ui.taskView = "group"; ui.taskGroup = g.id; ui.taskItem = null; ui.taskMember = null;
      taskOpenAdd = null; saveUI(); renderTasks();
    });
    tgHead.appendChild(addG);
    nav.appendChild(tgHead);

    var noGroupCount = open.filter(function (t) { return !t.task_group_id; }).length;
    if (noGroupCount || (ui.taskView === "group" && ui.taskGroup === "__none")) {
      var ng = navBtn(ui.taskView === "group" && ui.taskGroup === "__none",
        "タグなし", noGroupCount, function () {
          ui.taskView = "group"; ui.taskGroup = "__none"; ui.taskItem = null; ui.taskMember = null;
          taskOpenAdd = null; saveUI(); renderTasks();
        });
      var ndot = document.createElement("i");
      ndot.className = "g-dot"; ndot.style.background = "#C7BFB2";
      ng.insertBefore(ndot, ng.firstChild);
    }

    ONI.store.taskGroups().forEach(function (g) {
      var count = open.filter(function (t) { return t.task_group_id === g.id; }).length;
      var isCur = ui.taskView === "group" && ui.taskGroup === g.id;
      var b = navBtn(isCur, g.name, count, function () {
        ui.taskView = "group"; ui.taskGroup = g.id; ui.taskItem = null; ui.taskMember = null;
        taskOpenAdd = null; saveUI(); renderTasks();
      });
      if (g.color) {
        var gd = document.createElement("i");
        gd.className = "g-dot"; gd.style.background = g.color;
        b.insertBefore(gd, b.firstChild);
      }
      // 名前変更・削除ボタン（ホバーで表示）
      var tools = document.createElement("span");
      tools.className = "task-nav-tools";
      var ren = document.createElement("button");
      ren.className = "task-nav-tool"; ren.textContent = "✎"; ren.title = "名前を変更";
      ren.addEventListener("click", function (e) {
        e.stopPropagation();
        var name = prompt("タグ名を変更", g.name);
        if (name == null || !name.trim()) return;
        ONI.store.updateTaskGroup(g.id, { name: name.trim() });
      });
      var delb = document.createElement("button");
      delb.className = "task-nav-tool danger"; delb.textContent = "×"; delb.title = "タグを削除";
      delb.addEventListener("click", function (e) {
        e.stopPropagation();
        if (!confirm("タグ「" + g.name + "」を削除しますか？\n（中のタスクは消えず「タグなし」に戻ります）")) return;
        if (ui.taskGroup === g.id) { ui.taskView = "all"; ui.taskGroup = null; }
        ONI.store.deleteTaskGroup(g.id);
        saveUI(); renderTasks();
      });
      tools.appendChild(ren);
      tools.appendChild(delb);
      b.appendChild(tools);
    });
  }

  /* --- メインリスト --- */

  function renderTaskMain() {
    var main = $("task-main");
    main.innerHTML = "";

    var head = document.createElement("div");
    head.className = "task-main-head";
    var titleMap = { inbox: "INBOX", today: "今日", upcoming: "近日予定", all: "すべてのタスク", done: "完了済み" };
    var title;
    if (ui.taskView === "item") {
      title = ui.taskItem === "__none" ? "未割り当て"
        : ((ONI.store.getItem(ui.taskItem) || {}).title || "");
    } else if (ui.taskView === "member") {
      title = ui.taskMember === "__none" ? "担当者なし"
        : (ONI.store.memberName(ui.taskMember) || "");
    } else if (ui.taskView === "group") {
      title = ui.taskGroup === "__none" ? "タグなし"
        : ((ONI.store.getTaskGroup(ui.taskGroup) || {}).name || "");
    } else {
      title = titleMap[ui.taskView];
    }
    head.appendChild(Object.assign(document.createElement("h1"),
      { className: "task-main-title", textContent: title }));
    if (ui.taskView === "today") {
      var t0 = M.today();
      head.appendChild(Object.assign(document.createElement("span"), {
        className: "task-main-sub",
        textContent: (t0.getMonth() + 1) + "月" + t0.getDate() + "日 " + M.weekday(t0) + "曜日"
      }));
    }
    if (ui.taskView === "inbox") {
      head.appendChild(Object.assign(document.createElement("span"),
        { className: "task-main-sub", textContent: "期限が未定のタスク" }));
    }
    if (ui.taskView === "item" && ui.taskItem && ui.taskItem !== "__none") {
      var openBtn = document.createElement("button");
      openBtn.className = "btn btn-ghost";
      openBtn.textContent = "項目の詳細";
      openBtn.addEventListener("click", function () { ONI.detail.open(ui.taskItem); });
      head.appendChild(openBtn);
    }

    var search = document.createElement("input");
    search.type = "search";
    search.className = "input";
    search.placeholder = "タスクを検索…";
    search.value = ui.taskSearch;
    search.dataset.fkey = "search";
    search.addEventListener("input", function () {
      clearTimeout(taskSearchTimer);
      var v = search.value;
      taskSearchTimer = setTimeout(function () {
        ui.taskSearch = v;
        saveUI();
        renderTasks();
      }, 180);
    });
    head.appendChild(search);
    main.appendChild(head);

    var secs = taskSections();
    var totalShown = secs.reduce(function (n, s) { return n + s.tasks.length; }, 0);

    secs.forEach(function (sec) { main.appendChild(tdSection(sec)); });

    if (!totalShown && ui.taskView === "done") {
      main.appendChild(emptyState("完了したタスクはまだありません",
        "タスクを完了すると、ここに履歴として残ります。"));
    } else if (!totalShown && ui.taskView === "inbox" && !ui.taskSearch.trim()) {
      main.appendChild(emptyState("INBOXは空です",
        "期限を決めずに追加したタスクがここに集まります。日付を決めると「今日」や「近日予定」に移ります。"));
    } else if (!totalShown && ui.taskSearch.trim()) {
      main.appendChild(emptyState("見つかりませんでした",
        "「" + ui.taskSearch + "」に一致するタスクはありません。"));
    }
  }

  function tdSection(sec) {
    var wrap = document.createElement("div");
    wrap.className = "td-sec" + (sec.cls ? " " + sec.cls : "");

    if (sec.label != null) {
      var h = document.createElement("div");
      h.className = "td-sec-head";
      if (sec.color) {
        var dot = document.createElement("i");
        dot.className = "g-dot";
        dot.style.background = sec.color;
        h.appendChild(dot);
      }
      var lbl = document.createElement("span");
      lbl.className = "td-sec-label" + (sec.itemId ? " td-sec-link" : "");
      lbl.textContent = sec.label;
      if (sec.itemId) {
        lbl.title = "項目の詳細を開く";
        lbl.addEventListener("click", function () { ONI.detail.open(sec.itemId); });
      }
      h.appendChild(lbl);
      if (sec.tasks.length) {
        h.appendChild(Object.assign(document.createElement("span"),
          { className: "td-sec-count", textContent: String(sec.tasks.length) }));
      }
      wrap.appendChild(h);
    }

    sec.tasks.forEach(function (t) { wrap.appendChild(tdRow(t, sec)); });
    if (sec.add) wrap.appendChild(tdQuickAdd(sec));
    return wrap;
  }

  function tdRow(t, sec) {
    var wrap = document.createElement("div");
    wrap.className = "td-rowwrap";

    var row = document.createElement("div");
    row.className = "td-row" + (t.done ? " is-done" : "");

    var chk = document.createElement("button");
    chk.className = "td-check";
    chk.title = t.done ? "未完了に戻す" : "完了にする";
    chk.addEventListener("click", function () { ONI.store.updateTask(t.id, { done: !t.done }); });
    row.appendChild(chk);

    var bodyEl = document.createElement("div");
    bodyEl.className = "td-body";

    var titleIn = document.createElement("input");
    titleIn.type = "text";
    titleIn.className = "td-title";
    titleIn.value = t.title;
    titleIn.placeholder = "タスク名";
    titleIn.dataset.fkey = "t:" + t.id + ":title";
    bindDebouncedSave(titleIn, function () {
      ONI.store.updateTask(t.id, { title: titleIn.value });
    }, 350);
    bodyEl.appendChild(titleIn);

    var meta = document.createElement("div");
    meta.className = "td-meta";
    meta.appendChild(tdDueChip(t));
    // その項目専用のセクションでは項目チップは冗長なので出さない
    var itemBound = sec.itemId || (ui.taskView === "item" && ui.taskItem !== "__none");
    if (!itemBound) meta.appendChild(tdItemChip(t));
    // タグビュー中はタグチップは冗長なので出さない
    var groupBound = ui.taskView === "group" && ui.taskGroup !== "__none";
    if (!groupBound) meta.appendChild(tdGroupChip(t));

    meta.appendChild(ONI.ui.memberSelect(t.owner, function (v) {
      ONI.store.updateTask(t.id, { owner: v });
    }, { placeholder: "担当なし" }));

    // メモ・サブタスクのトグル
    var kids = ONI.store.subtasksOf(t.id);
    var noteBtn = document.createElement("button");
    noteBtn.className = "td-chip td-toolchip" + (t.note ? " is-on" : "");
    noteBtn.innerHTML = '<span>メモ</span>';
    noteBtn.title = t.note ? "メモを表示/編集" : "メモを追加";
    var subBtn = document.createElement("button");
    subBtn.className = "td-chip td-toolchip" + (kids.length ? " is-on" : "");
    subBtn.innerHTML = '<span>＋サブ' + (kids.length ? " " + kids.length : "") + '</span>';
    subBtn.title = "サブタスクを追加・表示";
    meta.appendChild(noteBtn);
    meta.appendChild(subBtn);

    bodyEl.appendChild(meta);
    row.appendChild(bodyEl);

    var del = document.createElement("button");
    del.className = "td-del";
    del.textContent = "×";
    del.title = "タスクを削除";
    del.addEventListener("click", function () {
      if (kids.length && !confirm("このタスクと子タスク " + kids.length + " 件を削除します。よろしいですか？")) return;
      ONI.store.deleteTask(t.id);
    });
    row.appendChild(del);
    wrap.appendChild(row);

    // --- 展開エリア（メモ・子タスク）。既に内容があれば開いておく ---
    var expand = document.createElement("div");
    expand.className = "td-expand";
    var noteOpen = taskNoteOpen[t.id] || !!t.note;
    var subOpen = taskSubOpen[t.id] || kids.length > 0;

    if (noteOpen) {
      var note = document.createElement("textarea");
      note.className = "td-note";
      note.placeholder = "メモを入力…（@名前 でメンション）";
      note.rows = 2;
      note.value = t.note || "";
      note.dataset.fkey = "t:" + t.id + ":note";
      bindDebouncedSave(note, function () {
        ONI.store.updateTask(t.id, { note: note.value });
      }, 400, function () { autoGrow(note); });
      ONI.ui.attachMention(note);   // @ で担当者の候補を出す
      expand.appendChild(note);
      setTimeout(function () { autoGrow(note); }, 0);
    }

    if (subOpen) {
      var subWrap = document.createElement("div");
      subWrap.className = "td-subs";
      kids.forEach(function (k) { subWrap.appendChild(tdSubRow(k)); });
      var addSub = document.createElement("button");
      addSub.className = "td-subadd";
      addSub.textContent = "＋ サブタスク";
      addSub.addEventListener("click", function () {
        taskSubOpen[t.id] = true;
        var nk = ONI.store.createTask({ title: "", parent_id: t.id, item_id: t.item_id || null });
        renderTasks();
        var el = $("task-main").querySelector('[data-fkey="t:' + nk.id + ':title"]');
        if (el) el.focus();
      });
      subWrap.appendChild(addSub);
      expand.appendChild(subWrap);
    }

    if (noteOpen || subOpen) wrap.appendChild(expand);

    noteBtn.addEventListener("click", function () {
      taskNoteOpen[t.id] = !noteOpen;
      renderTasks();
      if (!noteOpen) {
        var el = $("task-main").querySelector('[data-fkey="t:' + t.id + ':note"]');
        if (el) el.focus();
      }
    });
    subBtn.addEventListener("click", function () {
      taskSubOpen[t.id] = !subOpen;
      renderTasks();
    });

    return wrap;
  }

  /** 子タスクの行（シンプル: チェック・タイトル・削除のみ） */
  function tdSubRow(k) {
    var row = document.createElement("div");
    row.className = "td-subrow" + (k.done ? " is-done" : "");

    var chk = document.createElement("button");
    chk.className = "td-check td-check-sm";
    chk.title = k.done ? "未完了に戻す" : "完了にする";
    chk.addEventListener("click", function () { ONI.store.updateTask(k.id, { done: !k.done }); });
    row.appendChild(chk);

    var titleIn = document.createElement("input");
    titleIn.type = "text";
    titleIn.className = "td-title td-title-sm";
    titleIn.value = k.title;
    titleIn.placeholder = "サブタスク名";
    titleIn.dataset.fkey = "t:" + k.id + ":title";
    bindDebouncedSave(titleIn, function () {
      ONI.store.updateTask(k.id, { title: titleIn.value });
    }, 350);
    // Enter で同じ親に次のサブタスクを作成
    titleIn.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        ONI.store.updateTask(k.id, { title: titleIn.value }); // 直前の入力を確定保存
        var nk = ONI.store.createTask({ title: "", parent_id: k.parent_id, item_id: k.item_id || null });
        renderTasks();
        var el = $("task-main").querySelector('[data-fkey="t:' + nk.id + ':title"]');
        if (el) el.focus();
      }
    });
    row.appendChild(titleIn);

    var del = document.createElement("button");
    del.className = "td-del";
    del.textContent = "×";
    del.title = "サブタスクを削除";
    del.addEventListener("click", function () { ONI.store.deleteTask(k.id); });
    row.appendChild(del);
    return row;
  }

  /** タグチップ。透明の select を重ねてクリックで割り当て変更できる。 */
  function tdGroupChip(t) {
    var g = t.task_group_id ? ONI.store.getTaskGroup(t.task_group_id) : null;
    var chip = document.createElement("span");
    chip.className = "td-chip td-group" + (g ? "" : " is-empty");
    if (g && g.color) {
      var dot = document.createElement("i");
      dot.className = "g-dot"; dot.style.background = g.color;
      chip.appendChild(dot);
    }
    chip.appendChild(Object.assign(document.createElement("span"),
      { textContent: g ? g.name : "タグなし" }));

    var sel = document.createElement("select");
    sel.className = "td-chip-sel";
    sel.title = "タグに割り当てる";
    var ph = document.createElement("option");
    ph.value = ""; ph.textContent = "タグなし";
    sel.appendChild(ph);
    ONI.store.taskGroups().forEach(function (x) {
      var o = document.createElement("option");
      o.value = x.id; o.textContent = x.name;
      if (t.task_group_id === x.id) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener("change", function () {
      ONI.store.updateTask(t.id, { task_group_id: sel.value || null });
    });
    chip.appendChild(sel);
    return chip;
  }

  function autoGrow(el) {
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }

  /**
   * 入力を遅延保存する。IME変換中（isComposing）は保存＝再描画を保留し、
   * 変換確定（compositionend）後にだけ発火する。これで変換途中に
   * 再描画が入って変換が中断・確定されるのを防ぐ。
   * onInput は入力のたびに毎回呼ぶ副作用（自動リサイズ等）用。
   */
  function bindDebouncedSave(el, save, delay, onInput) {
    var timer;
    function schedule() { clearTimeout(timer); timer = setTimeout(save, delay); }
    el.addEventListener("input", function (e) {
      if (onInput) onInput();
      if (e.isComposing) return;   // 変換中は保存しない（再描画も起こさない）
      schedule();
    });
    el.addEventListener("compositionend", schedule); // 変換確定で保存
  }

  /** 期限チップ。クリックで日付ピッカーが開く。 */
  function tdDueChip(t) {
    var m = dueMeta(t);
    var chip = document.createElement("span");
    chip.className = "td-chip td-due " + m.cls;
    chip.appendChild(Object.assign(document.createElement("span"), { textContent: m.label }));

    var input = document.createElement("input");
    input.type = "date";
    input.className = "td-chip-input";
    input.value = t.due_date || "";
    input.tabIndex = -1;
    input.addEventListener("change", function () {
      ONI.store.updateTask(t.id, { due_date: input.value });
    });
    chip.appendChild(input);

    chip.addEventListener("click", function (e) {
      if (e.target.classList.contains("td-chip-clear")) return;
      if (input.showPicker) {
        try { input.showPicker(); } catch (err) { input.focus(); }
      } else {
        input.focus();
      }
    });

    if (t.due_date) {
      var clr = document.createElement("button");
      clr.className = "td-chip-clear";
      clr.textContent = "×";
      clr.title = "期限を外す";
      clr.addEventListener("click", function (e) {
        e.stopPropagation();
        ONI.store.updateTask(t.id, { due_date: "" });
      });
      chip.appendChild(clr);
    }
    return chip;
  }

  /** 項目チップ。透明の select を重ねてクリックで割り当て変更できる。 */
  function tdItemChip(t) {
    var it = taskItemOf(t);
    var chip = document.createElement("span");
    chip.className = "td-chip td-item" + (it ? "" : " is-empty");
    if (it) {
      var dot = document.createElement("i");
      dot.className = "g-dot";
      dot.style.background = ONI.store.colorOf(it);
      chip.appendChild(dot);
    }
    chip.appendChild(Object.assign(document.createElement("span"),
      { textContent: it ? it.title : "項目なし" }));

    var sel = document.createElement("select");
    sel.className = "td-chip-sel";
    sel.title = "項目を割り当てる";
    var ph = document.createElement("option");
    ph.value = ""; ph.textContent = "項目なし";
    sel.appendChild(ph);
    ONI.store.items().forEach(function (x) {
      var o = document.createElement("option");
      o.value = x.id; o.textContent = x.title;
      if (t.item_id === x.id) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener("change", function () {
      ONI.store.updateTask(t.id, { item_id: sel.value || null });
    });
    chip.appendChild(sel);
    return chip;
  }

  /** セクション末尾のクイック追加。開くとインラインフォームになる。 */
  function tdQuickAdd(sec) {
    var wrap = document.createElement("div");
    wrap.className = "td-add";

    if (taskOpenAdd !== sec.key) {
      var btn = document.createElement("button");
      btn.className = "td-add-btn";
      btn.appendChild(Object.assign(document.createElement("span"),
        { className: "td-add-plus", textContent: "＋" }));
      btn.appendChild(document.createTextNode("タスクを追加"));
      btn.addEventListener("click", function () {
        taskOpenAdd = sec.key;
        renderTasks();
        var box = $("task-main").querySelector('[data-fkey="add:' + sec.key + '"]');
        if (box) box.focus();
      });
      wrap.appendChild(btn);
      return wrap;
    }

    var form = document.createElement("div");
    form.className = "td-add-form";

    var input = document.createElement("input");
    input.type = "text";
    input.className = "td-add-input";
    input.placeholder = "タスク名を入力…";
    input.dataset.fkey = "add:" + sec.key;

    function submit() {
      if (!input.value.trim()) { input.focus(); return; }
      ONI.store.createTask(Object.assign({ title: input.value.trim() }, sec.add));
      // 追加後もフォームは開いたまま（renderTasks が fkey でフォーカスを戻す）
    }
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) submit();
      if (e.key === "Escape") { taskOpenAdd = null; renderTasks(); }
    });
    form.appendChild(input);

    var foot = document.createElement("div");
    foot.className = "td-add-foot";
    var ctxBits = [];
    if (sec.add.due_date) ctxBits.push("期限: " + dueMeta({ due_date: sec.add.due_date }).label);
    if (sec.add.item_id) {
      var target = ONI.store.getItem(sec.add.item_id);
      if (target) ctxBits.push("項目: " + target.title);
    }
    if (sec.add.owner && sec.add.owner.length) {
      ctxBits.push("担当: " + ONI.store.memberNames(sec.add.owner));
    }
    foot.appendChild(Object.assign(document.createElement("span"),
      { className: "td-add-ctx", textContent: ctxBits.join(" ・ ") }));

    var cancel = document.createElement("button");
    cancel.className = "btn btn-ghost";
    cancel.textContent = "キャンセル";
    cancel.addEventListener("click", function () { taskOpenAdd = null; renderTasks(); });
    foot.appendChild(cancel);

    var addBtn = document.createElement("button");
    addBtn.className = "btn btn-primary";
    addBtn.textContent = "追加";
    addBtn.addEventListener("click", submit);
    foot.appendChild(addBtn);

    form.appendChild(foot);
    wrap.appendChild(form);
    return wrap;
  }

  function emptyState(title, desc) {
    var box = document.createElement("div");
    box.className = "empty-state";
    box.appendChild(Object.assign(document.createElement("div"),
      { className: "empty-title", textContent: title }));
    box.appendChild(Object.assign(document.createElement("p"),
      { className: "empty-desc", textContent: desc }));
    return box;
  }

  /* 新規メモの記載者。担当者マスタから選ぶ（複数可・未選択のままでも登録できる） */
  var newIdeaAuthor = [];

  function renderIdeaAuthorPicker() {
    var host = $("idea-author-pick");
    host.innerHTML = "";
    host.appendChild(ONI.ui.memberSelect(newIdeaAuthor, function (v) {
      newIdeaAuthor = v;
      renderIdeaAuthorPicker();
    }, { placeholder: "記載者を選ぶ" }));
  }

  function renderIdeas() {
    renderIdeaAuthorPicker();
    var host = $("idea-list");
    host.innerHTML = "";
    ONI.store.ideas().forEach(function (idea) {
      var card = document.createElement("div");
      card.className = "idea-card";

      var meta = document.createElement("div");
      meta.className = "idea-meta";
      meta.appendChild(ONI.ui.memberSelect(idea.author, function (v) {
        ONI.store.updateIdea(idea.id, { author: v });
      }, { placeholder: "記載者なし" }));
      meta.appendChild(Object.assign(document.createElement("span"),
        { textContent: idea.created_at || "" }));
      if (idea.source) {
        meta.appendChild(Object.assign(document.createElement("span"),
          { textContent: idea.source }));
      }
      var del = document.createElement("button");
      del.className = "btn";
      del.style.marginLeft = "auto";
      del.style.padding = "0 6px";
      del.textContent = "×";
      del.title = "削除";
      del.addEventListener("click", function () {
        if (confirm("このメモを削除しますか？")) ONI.store.deleteIdea(idea.id);
      });
      meta.appendChild(del);
      card.appendChild(meta);

      var body = document.createElement("div");
      body.className = "idea-body";
      body.textContent = idea.body;
      card.appendChild(body);

      if (idea.ref_url) {
        var a = document.createElement("a");
        a.href = idea.ref_url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = idea.ref_url;
        a.style.fontSize = "11px";
        card.appendChild(a);
      }
      host.appendChild(card);
    });
  }

  /* ==================== 担当者マスタ ==================== */

  /* ------------------------------------------------- 通知（右サイドバー） */

  function renderNotifBadge() {
    var n = ONI.store.unreadCount();
    var b = $("notif-badge");
    b.textContent = n > 99 ? "99+" : String(n);
    b.hidden = !n;
    $("btn-notif").classList.toggle("has-unread", !!n);
  }

  function openNotif() {
    $("notif-drawer").hidden = false;
    $("notif-overlay").hidden = false;
    renderNotifDrawer();
    // 開いた時点で既読にする（一覧は残る）
    ONI.store.markAllRead();
  }
  function closeNotif() {
    $("notif-drawer").hidden = true;
    $("notif-overlay").hidden = true;
  }
  function toggleNotif() {
    if ($("notif-drawer").hidden) openNotif(); else closeNotif();
  }

  /** 通知の日時を「今日 14:30」「7/23」のように短く表す */
  function notifWhen(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    var t = M.today();
    var sameDay = d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth()
      && d.getDate() === t.getDate();
    var hm = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    if (sameDay) return "今日 " + hm;
    return (d.getMonth() + 1) + "/" + d.getDate() + " " + hm;
  }

  function renderNotifDrawer() {
    var d = $("notif-drawer");
    d.innerHTML = "";

    var head = document.createElement("div");
    head.className = "notif-head";
    head.appendChild(Object.assign(document.createElement("span"),
      { className: "notif-title", textContent: "通知" }));

    var list = ONI.store.notifications();
    if (list.length) {
      var clear = document.createElement("button");
      clear.className = "btn btn-ghost";
      clear.textContent = "すべて消す";
      clear.addEventListener("click", function () {
        if (!confirm("通知をすべて消しますか？")) return;
        ONI.store.clearNotifications();
      });
      head.appendChild(clear);
    }
    var close = document.createElement("button");
    close.className = "btn btn-icon notif-close";
    close.textContent = "×";
    close.title = "閉じる";
    close.addEventListener("click", closeNotif);
    head.appendChild(close);
    d.appendChild(head);

    var body = document.createElement("div");
    body.className = "notif-body";

    if (!list.length) {
      body.appendChild(emptyState("通知はありません",
        "担当者に設定されたときや、メモで @ でメンションされたときにここに届きます。"));
      d.appendChild(body);
      return;
    }

    list.forEach(function (n) {
      var row = document.createElement("div");
      row.className = "notif-item" + (n.read_at ? "" : " is-unread");

      var kind = document.createElement("span");
      kind.className = "notif-kind " + (n.kind === "mention" ? "is-mention" : "is-assigned");
      kind.textContent = n.kind === "mention" ? "メンション" : "担当";
      row.appendChild(kind);

      var main = document.createElement("div");
      main.className = "notif-main";
      main.appendChild(Object.assign(document.createElement("div"),
        { className: "notif-msg", textContent: n.message }));
      main.appendChild(Object.assign(document.createElement("div"), {
        className: "notif-meta",
        textContent: (n.actor_name ? n.actor_name + " ・ " : "") + notifWhen(n.created_at)
      }));
      row.appendChild(main);

      // 対象があれば押して開けるようにする
      if (n.item_id && ONI.store.getItem(n.item_id)) {
        row.classList.add("is-clickable");
        row.title = "項目の詳細を開く";
        row.addEventListener("click", function () {
          closeNotif();
          ONI.detail.open(n.item_id);
        });
      } else if (n.task_id) {
        row.classList.add("is-clickable");
        row.title = "タスク管理を開く";
        row.addEventListener("click", function () {
          closeNotif();
          setTab("tasks");
        });
      }

      body.appendChild(row);
    });
    d.appendChild(body);
  }

  function renderMembers() {
    var host = $("member-list");
    host.innerHTML = "";
    var list = ONI.store.members();

    if (!list.length) {
      host.appendChild(emptyState("担当者がまだいません",
        "上のフォームから追加すると、ガント項目・タスク・アイデアメモの担当者として選べるようになります。"));
      return;
    }

    list.forEach(function (m) {
      var use = ONI.store.memberUsage(m.id);
      var row = document.createElement("div");
      row.className = "member-row";
      row.dataset.memberId = m.id;

      var grip = document.createElement("span");
      grip.className = "member-grip";
      grip.textContent = "⠿";
      grip.title = "ドラッグで並び替え";
      row.appendChild(grip);

      // 色（12色パレット）
      row.appendChild(ONI.ui.colorButton(m.color, function (hex) {
        ONI.store.updateMember(m.id, { color: hex });
      }, { title: "担当者の色を変更" }));

      row.appendChild(ONI.ui.memberAvatar(m));

      var name = document.createElement("input");
      name.type = "text";
      name.className = "member-name";
      name.value = m.name;
      name.dataset.fkey = "m:" + m.id + ":name";
      var timer;
      name.addEventListener("input", function () {
        clearTimeout(timer);
        timer = setTimeout(function () { ONI.store.updateMember(m.id, { name: name.value }); }, 350);
      });
      row.appendChild(name);

      var note = document.createElement("input");
      note.type = "text";
      note.className = "member-note";
      note.value = m.note;
      note.placeholder = "メモ（役割など）";
      note.dataset.fkey = "m:" + m.id + ":note";
      var ntimer;
      note.addEventListener("input", function () {
        clearTimeout(ntimer);
        ntimer = setTimeout(function () { ONI.store.updateMember(m.id, { note: note.value }); }, 350);
      });
      row.appendChild(note);

      var usage = document.createElement("span");
      usage.className = "member-usage";
      usage.textContent = "項目 " + use.items + " ・ タスク " + use.tasks + " ・ メモ " + use.ideas;
      row.appendChild(usage);

      var del = document.createElement("button");
      del.className = "btn task-del";
      del.textContent = "×";
      del.title = "削除";
      del.addEventListener("click", function () {
        var total = use.items + use.tasks + use.ideas;
        var msg = "「" + m.name + "」を担当者マスタから削除します。"
          + (total ? "\n割り当て済みの " + total + " 箇所は「担当者なし」に戻ります。" : "")
          + "\nよろしいですか？";
        if (!confirm(msg)) return;
        ONI.store.deleteMember(m.id);
        toast("担当者を削除しました");
      });
      row.appendChild(del);

      host.appendChild(row);
    });

    wireMemberDrag(host);
  }

  /** 担当者リストのドラッグ並び替え */
  function wireMemberDrag(host) {
    if (host.__oniMemberDrag) return; // リスナーは一度だけ張る
    host.__oniMemberDrag = true;
    var drag = null;

    function clearMarks() {
      host.querySelectorAll(".drop-before, .drop-after").forEach(function (n) {
        n.classList.remove("drop-before", "drop-after");
      });
    }

    host.addEventListener("pointerdown", function (ev) {
      var grip = ev.target.closest(".member-grip");
      if (!grip) return;
      ev.preventDefault();
      var row = grip.closest(".member-row");
      drag = { id: row.dataset.memberId, node: row, startY: ev.clientY, active: false, target: null };
      grip.setPointerCapture(ev.pointerId);
    });

    host.addEventListener("pointermove", function (ev) {
      if (!drag) return;
      if (!drag.active && Math.abs(ev.clientY - drag.startY) > 4) {
        drag.active = true;
        drag.node.classList.add("is-memberdrag");
      }
      if (!drag.active) return;

      clearMarks();
      drag.target = null;
      var under = document.elementFromPoint(ev.clientX, ev.clientY);
      var overRow = under && under.closest ? under.closest(".member-row") : null;
      if (!overRow || overRow === drag.node) return;
      var rect = overRow.getBoundingClientRect();
      var before = ev.clientY < rect.top + rect.height / 2;
      overRow.classList.add(before ? "drop-before" : "drop-after");
      drag.target = { id: overRow.dataset.memberId, before: before };
    });

    function end() {
      if (!drag) return;
      var d = drag;
      drag = null;
      clearMarks();
      d.node.classList.remove("is-memberdrag");
      if (!d.active || !d.target) return;
      ONI.store.reorderMember(d.id, d.target.id, d.target.before);
    }

    host.addEventListener("pointerup", end);
    host.addEventListener("pointercancel", end);
  }

  function renderAll() {
    if (ui.tab === "gantt") renderGantt();
    if (ui.tab === "tasks") renderTasks();
    if (ui.tab === "ideas") renderIdeas();
    renderNotifBadge();
    if (!$("notif-drawer").hidden) renderNotifDrawer();
    ONI.detail.refresh();
  }

  /* ------------------------------------------------------------ 配線 */

  function setTab(name) {
    ui.tab = name;
    document.querySelectorAll(".tab").forEach(function (b) {
      b.classList.toggle("is-active", b.dataset.tab === name);
    });
    document.querySelectorAll(".panel").forEach(function (p) {
      p.hidden = p.dataset.panel !== name;
    });
    saveUI();
    renderAll();
  }

  function setView(view) {
    ui.view = view;
    document.querySelectorAll("#view-switch button").forEach(function (b) {
      b.classList.toggle("is-active", b.dataset.view === view);
    });
    saveUI();
    renderGantt();
    scrollToToday();
  }

  /* グループフィルタのチェックボックスはグループが増減するため毎回組み立て直す */
  function buildGroupFilter() {
    var host = $("filter-groups");
    host.innerHTML = "";
    ONI.store.groups().forEach(function (g) {
      var label = document.createElement("label");
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = g.id;
      cb.checked = ui.hiddenGroups.indexOf(g.id) < 0;
      cb.addEventListener("change", function () {
        if (cb.checked) ui.hiddenGroups = ui.hiddenGroups.filter(function (x) { return x !== g.id; });
        else if (ui.hiddenGroups.indexOf(g.id) < 0) ui.hiddenGroups.push(g.id);
        saveUI();
        syncFilterUI();
        renderGantt();
      });
      var dot = document.createElement("i");
      dot.className = "g-dot";
      dot.style.background = g.color;
      dot.style.marginRight = "2px";
      label.appendChild(cb);
      label.appendChild(dot);
      label.appendChild(document.createTextNode(g.name));
      host.appendChild(label);
    });
  }

  /** ステータス・媒体はユーザーが編集できるため、フィルタも毎回組み立て直す */
  function buildStatusFilter() {
    var host = $("filter-statuses");
    host.innerHTML = "";
    ONI.store.statuses().forEach(function (s) {
      var label = document.createElement("label");
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = s.key;
      cb.checked = ui.hiddenStatuses.indexOf(s.key) < 0;
      cb.addEventListener("change", function () {
        if (cb.checked) ui.hiddenStatuses = ui.hiddenStatuses.filter(function (x) { return x !== s.key; });
        else if (ui.hiddenStatuses.indexOf(s.key) < 0) ui.hiddenStatuses.push(s.key);
        saveUI();
        syncFilterUI();
        renderGantt();
      });
      label.appendChild(cb);
      label.appendChild(document.createTextNode(" " + s.label));
      host.appendChild(label);
    });
  }

  function buildChannelFilter() {
    var host = $("filter-channels");
    host.innerHTML = "";
    ONI.store.channels().forEach(function (c) {
      var label = document.createElement("label");
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = c.key;
      cb.checked = ui.channels.indexOf(c.key) >= 0;
      cb.addEventListener("change", function () {
        ui.channels = Array.prototype.map.call(
          document.querySelectorAll("#filter-channels input:checked"),
          function (x) { return x.value; });
        saveUI();
        syncFilterUI();
        renderGantt();
      });
      label.appendChild(cb);
      label.appendChild(document.createTextNode(" " + c.label));
      host.appendChild(label);
    });
  }

  function syncFilterUI() {
    buildGroupFilter();
    buildStatusFilter();
    buildChannelFilter();
    var badge = $("filter-count");
    var n = activeFilterCount();
    badge.textContent = n || "";
    badge.classList.toggle("on", n > 0);
  }

  function wire() {
    $("tabs").addEventListener("click", function (e) {
      var b = e.target.closest(".tab");
      // レシピ管理などのリンク（data-tab を持たない）は、そのまま遷移させる
      if (b && b.dataset.tab) setTab(b.dataset.tab);
    });

    $("view-switch").addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (b) setView(b.dataset.view);
    });

    // 前後ボタンはページ切替ではなく、なめらかな連続スライド
    $("nav-prev").addEventListener("click", function () { slideBy(-1); });
    $("nav-next").addEventListener("click", function () { slideBy(1); });
    $("nav-today").addEventListener("click", function () {
      ui.anchor = M.iso(M.today());
      saveUI();
      renderGantt();
      scrollToToday();
    });

    // タイムラインの連続スクロール（端に近づいたら描画範囲を延長）
    $("gantt-scroll").addEventListener("scroll", onGanttScroll);

    // モーダルの閉じる操作
    $("modal-overlay").addEventListener("click", function (e) {
      if (e.target === $("modal-overlay")) closeModal();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !$("modal-overlay").hidden) closeModal();
    });

    var searchTimer;
    $("search").addEventListener("input", function (e) {
      clearTimeout(searchTimer);
      var v = e.target.value;
      searchTimer = setTimeout(function () {
        ui.search = v;
        saveUI();
        renderGantt();
      }, 180);
    });

    // グループ・ステータス・媒体のフィルタは syncFilterUI が毎回組み立てる

    $("filter-reset").addEventListener("click", function () {
      ui.hiddenGroups = [];
      ui.hiddenStatuses = [];
      ui.channels = [];
      saveUI();
      syncFilterUI();
      renderGantt();
    });

    $("btn-filter").addEventListener("click", function (e) {
      e.stopPropagation();
      $("filter-popover").hidden = !$("filter-popover").hidden;
    });
    document.addEventListener("click", function (e) {
      if (!e.target.closest(".filter-menu")) $("filter-popover").hidden = true;
    });

    /* タスク管理ページは renderTasks が毎回組み立てるため、ここでの配線は不要 */

    ONI.ui.attachMention($("idea-body"));   // @ で担当者の候補を出す

    $("idea-add").addEventListener("click", function () {
      var body = $("idea-body").value.trim();
      if (!body) return;
      ONI.store.createIdea({
        author: newIdeaAuthor.slice(),   // 担当者マスタから選んだID（未選択なら空配列）
        body: body,
        ref_url: $("idea-url").value.trim()
      });
      $("idea-body").value = "";
      $("idea-url").value = "";
      toast("メモを追加しました");
    });

    /* ログイン中のアカウント表示（ログアウトはワークスペース側にある） */
    var me = ONI.auth.me();
    if (me) {
      var roleLabel = { admin: "管理者", editor: "編集可", viewer: "閲覧のみ" }[me.role] || me.role;
      $("me-badge").textContent = me.email + "（" + roleLabel + "）";
      $("me-badge").title = "ログイン中のアカウント";
    }
    /* 通知（右サイドバー） */
    $("btn-notif").addEventListener("click", function () { toggleNotif(); });
    $("notif-overlay").addEventListener("click", closeNotif);

    /* キーボード操作 */
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !$("notif-drawer").hidden) { closeNotif(); return; }
      if (e.target.matches("input, textarea, select")) return;
      if (ui.tab !== "gantt") return;
      if (e.key === "ArrowLeft") $("nav-prev").click();
      if (e.key === "ArrowRight") $("nav-next").click();
      if (e.key === "t") $("nav-today").click();
    });
  }

  function init() {
    loadUI();
    ONI.detail.init();
    ONI.store.subscribe(renderAll);
    wire();

    $("search").value = ui.search;
    document.querySelectorAll("#view-switch button").forEach(function (b) {
      b.classList.toggle("is-active", b.dataset.view === ui.view);
    });

    // Supabase からの読み込みが終わってからフィルタUI（グループ一覧）を組み立てる
    ONI.store.init(function () {
      syncFilterUI();
      setTab(ui.tab);
      scrollToToday();
    });
    setTab(ui.tab);
  }

  return { init: init, toast: toast, ui: ui, render: renderAll,
    openModal: openModal, closeModal: closeModal };
})();

/* 起動の流れ: ログイン確認 → Supabase クライアントを渡す → 画面を組み立てる */
document.addEventListener("DOMContentLoaded", function () {
  ONI.auth.start(function (client, session) {
    ONI.store.setClient(client, session && session.user && session.user.email);
    ONI.app.init();
  });
});
