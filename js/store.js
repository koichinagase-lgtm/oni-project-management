/* store.js — データの保存・取得（Supabase 版）
 *
 * 画面側は今までどおり同期的に使える（items() を呼べばすぐ配列が返る）。
 * 実体はメモリ上のキャッシュで、
 *   起動時   … Supabase から全件読み込む
 *   変更時   … 先にメモリを更新して即描画し、裏で Supabase に書き込む
 *   他の人の変更 … Realtime で受け取ってキャッシュに反映する
 * という流れ。UI コードには手を入れなくて済むようにしている。
 *
 * データの単位:
 *   member … 担当者マスタ（割り当て先）
 *   group  … ガント縦軸の分類
 *   item   … ガントのバー1本。group に属す
 *   task   … item にぶら下がる ToDo
 *   event  … 季節イベント・出店
 *   idea   … アイデアmemo
 */

var ONI = window.ONI || {};
window.ONI = ONI;

ONI.store = (function () {
  "use strict";

  var M = ONI.model;
  var sb = null;
  var ready = false;
  // 初回読み込みに失敗したか。true の間は一切書き込まない。
  var loadFailed = false;

  var state = {
    groups: [], items: [], tasks: [], events: [], ideas: [],
    propDefs: [], fields: null, members: [], taskGroups: [],
    profiles: [],       // pm_workspace_users（表示名・アイコン・担当者紐付け）
    notifications: []   // 自分あての通知
  };
  var myEmail = "";     // ログイン中のメールアドレス（通知の送り主判定に使う）
  var listeners = [];

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function emit() { listeners.forEach(function (fn) { fn(state); }); }

  function subscribe(fn) {
    listeners.push(fn);
    return function () { listeners = listeners.filter(function (f) { return f !== fn; }); };
  }

  /* ------------------------------------------------- Supabase への書き込み */

  var pending = 0;
  function onError(label) {
    return function (res) {
      if (res && res.error) {
        console.error("同期に失敗しました:", label, res.error);
        ONI.app && ONI.app.toast("保存できませんでした（" + label + "）");
      }
      pending = Math.max(0, pending - 1);
    };
  }

  /** 読み込みに失敗した状態では一切書き込まない。
   *  空の state を正しいものと誤認して DB に書くと、重複や欠落の原因になる。 */
  function canWrite() {
    if (!sb) return false;
    if (loadFailed) {
      ONI.app && ONI.app.toast("データを読み込めていないため保存できません。再読み込みしてください");
      return false;
    }
    return true;
  }

  /** 1行を書き込む（挿入・更新のどちらでも） */
  function push(table, row, label) {
    if (!canWrite()) return;
    pending++;
    sb.from(table).upsert(row).then(onError(label || table), onError(label || table));
  }

  /** まとめて書き込む（並び替えなど複数行が動くとき） */
  function pushMany(table, rows, label) {
    if (!canWrite() || !rows.length) return;
    pending++;
    sb.from(table).upsert(rows).then(onError(label || table), onError(label || table));
  }

  function remove(table, id, label) {
    if (!canWrite()) return;
    pending++;
    sb.from(table).delete().eq("id", id).then(onError(label || table), onError(label || table));
  }

  function removeMany(table, ids, label) {
    if (!canWrite() || !ids.length) return;
    pending++;
    sb.from(table).delete().in("id", ids).then(onError(label || table), onError(label || table));
  }

  /* ------------------------------------------------------- 行の詰め替え */

  function itemRow(it) {
    return {
      id: it.id, group_id: it.group_id, title: it.title,
      start_date: it.start_date, end_date: it.end_date,
      status: it.status, color: it.color || "", progress: it.progress || 0,
      sort_order: it.sort_order || 0, detail: it.detail || {},
      updated_at: new Date().toISOString()
    };
  }
  function taskRowOf(t) {
    return {
      id: t.id, item_id: t.item_id || null, title: t.title, done: !!t.done,
      owner: t.owner || [], due_date: t.due_date || null,
      parent_id: t.parent_id || null, task_group_id: t.task_group_id || null,
      note: t.note || "",
      sort_order: t.sort_order || 0, updated_at: new Date().toISOString()
    };
  }
  function taskGroupRow(g) {
    return { id: g.id, name: g.name, color: g.color || null,
      sort_order: g.sort_order || 0, updated_at: new Date().toISOString() };
  }
  function groupRow(g) {
    return { id: g.id, name: g.name, color: g.color, sort_order: g.sort_order || 0,
      updated_at: new Date().toISOString() };
  }
  function memberRow(m) {
    return { id: m.id, name: m.name, color: m.color, note: m.note || "",
      email: m.email || null, sort_order: m.sort_order || 0,
      updated_at: new Date().toISOString() };
  }
  function eventRow(e) {
    return { id: e.id, label: e.label, date: e.date, end_date: e.end_date, kind: e.kind,
      updated_at: new Date().toISOString() };
  }
  function ideaRow(i) {
    return { id: i.id, author: i.author || [], body: i.body || "", ref_url: i.ref_url || "" };
  }
  function propRow(p) {
    return { id: p.id, name: p.name, type: p.type, options: p.options || [],
      sort_order: p.sort_order || 0 };
  }
  function saveFields() {
    push("pm_settings", { id: 1, fields: state.fields, updated_at: new Date().toISOString() }, "設定");
  }

  /* ------------------------------------------------------------ 読み込み */

  function normalizeFields(raw) {
    var d = clone(M.DEFAULT_FIELDS);
    if (!raw || !Object.keys(raw).length) return d;
    var f = {
      labels: Object.assign({}, d.labels, raw.labels || {}),
      hidden: Object.assign({}, raw.hidden || {}),
      statuses: (raw.statuses && raw.statuses.length) ? raw.statuses.slice() : d.statuses,
      priorities: Array.isArray(raw.priorities) ? raw.priorities.slice() : d.priorities,
      channels: (raw.channels && raw.channels.length) ? raw.channels.slice() : d.channels,
      order: Array.isArray(raw.order) ? raw.order.slice() : []
    };
    f.statuses = f.statuses.filter(function (s) { return s && s.key; });
    if (!f.statuses.length) f.statuses = d.statuses;
    f.channels = f.channels.filter(function (c) { return c && c.key; });
    return f;
  }

  function setClient(client, email) { sb = client; myEmail = (email || "").toLowerCase(); }

  /** Supabase から全件読み込む。読み終わったら onDone を呼ぶ。 */
  function init(onDone) {
    if (!sb) { console.error("Supabase クライアントが未設定です"); return; }

    Promise.all([
      sb.from("pm_groups").select("*"),
      sb.from("pm_items").select("*"),
      sb.from("pm_tasks").select("*"),
      sb.from("pm_events").select("*"),
      sb.from("pm_ideas").select("*"),
      sb.from("pm_members").select("*"),
      sb.from("pm_prop_defs").select("*"),
      sb.from("pm_settings").select("*").eq("id", 1).maybeSingle(),
      sb.from("pm_task_groups").select("*"),
      sb.from("pm_workspace_users").select("id, email, display_name, avatar, member_id"),
      sb.from("pm_notifications").select("*").order("created_at", { ascending: false }).limit(100)
    ]).then(function (r) {
      var err = r.filter(function (x) { return x.error; })[0];
      if (err) {
        // 1つでも読めていなければ、以降の書き込みを止める。
        // 空の state のまま続行すると「まっさらなワークスペース」と誤認して
        // 既定グループを DB に書き込んでしまうし、利用者が作り直して重複が生まれる。
        console.error("読み込みに失敗しました", err.error);
        loadFailed = true;
        ONI.app && ONI.app.toast("データを読み込めませんでした。保存を停止しています。再読み込みしてください");
      }
      state.groups = (r[0].data || []).map(M.normalizeGroup);
      state.items = (r[1].data || []).map(M.normalizeItem);
      state.tasks = (r[2].data || []).map(M.normalizeTask);
      state.events = (r[3].data || []).map(M.normalizeEvent);
      state.ideas = (r[4].data || []).map(M.normalizeIdea);
      state.members = (r[5].data || []).map(M.normalizeMember);
      state.propDefs = (r[6].data || []).map(M.normalizePropDef);
      state.fields = normalizeFields(r[7].data ? r[7].data.fields : null);
      state.taskGroups = (r[8].data || []).map(M.normalizeTaskGroup);
      state.profiles = (r[9].data || []);
      state.notifications = (r[10].data || []);

      // まっさらなワークスペースなら既定グループを用意する
      // （読み込みに失敗しているときは「空」が事実か分からないので作らない）
      if (!loadFailed && !state.groups.length) {
        M.DEFAULT_GROUPS.forEach(function (g, i) {
          var row = M.normalizeGroup({ name: g.name, color: g.color, sort_order: (i + 1) * 10 });
          state.groups.push(row);
          push("pm_groups", groupRow(row), "グループ");
        });
      }

      ready = true;
      watchRealtime();
      emit();
      if (onDone) onDone();
    });
  }

  /* --------------------------------------------------- Realtime（共同編集） */

  var TABLE_MAP = {
    pm_groups: { key: "groups", norm: M.normalizeGroup },
    pm_items: { key: "items", norm: M.normalizeItem },
    pm_tasks: { key: "tasks", norm: M.normalizeTask },
    pm_events: { key: "events", norm: M.normalizeEvent },
    pm_ideas: { key: "ideas", norm: M.normalizeIdea },
    pm_members: { key: "members", norm: M.normalizeMember },
    pm_prop_defs: { key: "propDefs", norm: M.normalizePropDef },
    pm_task_groups: { key: "taskGroups", norm: M.normalizeTaskGroup },
    // 通知は自分あての行だけ届く（RLSで絞られる）
    pm_notifications: { key: "notifications", norm: function (r) { return r; } }
  };

  var repaint = null;
  function schedulePaint() {
    clearTimeout(repaint);
    repaint = setTimeout(emit, 120); // 連続して届く変更をまとめて描画する
  }

  function watchRealtime() {
    if (!sb || !sb.channel) return;
    var ch = sb.channel("pm-sync");

    Object.keys(TABLE_MAP).forEach(function (table) {
      ch.on("postgres_changes", { event: "*", schema: "public", table: table }, function (payload) {
        var map = TABLE_MAP[table];
        var list = state[map.key];
        if (payload.eventType === "DELETE") {
          state[map.key] = list.filter(function (x) { return x.id !== payload.old.id; });
        } else {
          var row = map.norm(payload.new);
          var i = list.findIndex(function (x) { return x.id === row.id; });
          if (i >= 0) list[i] = row; else list.push(row);
        }
        schedulePaint();
      });
    });

    ch.on("postgres_changes", { event: "*", schema: "public", table: "pm_settings" }, function (payload) {
      if (payload.new) { state.fields = normalizeFields(payload.new.fields); schedulePaint(); }
    });

    ch.subscribe();
  }

  /* -------------------------------------------------------------- グループ */

  function groups() {
    return state.groups.slice().sort(function (a, b) {
      return (a.sort_order || 0) - (b.sort_order || 0);
    });
  }

  function getGroup(id) {
    for (var i = 0; i < state.groups.length; i++) {
      if (state.groups[i].id === id) return state.groups[i];
    }
    return null;
  }

  /** 項目の色。項目に個別指定があればそれを、無ければ所属グループの色を使う。 */
  function colorOf(item) {
    if (item.color) return item.color;
    var g = getGroup(item.group_id);
    return g ? g.color : "#9A9187";
  }

  function createGroup(patch) {
    var maxOrder = state.groups.reduce(function (m, g) { return Math.max(m, g.sort_order || 0); }, 0);
    var used = state.groups.map(function (g) { return g.color; });
    var color = (patch && patch.color) || M.GROUP_COLORS.filter(function (c) {
      return used.indexOf(c) < 0;
    })[0] || M.GROUP_COLORS[state.groups.length % M.GROUP_COLORS.length];
    var g = M.normalizeGroup(Object.assign({ color: color, sort_order: maxOrder + 10 }, patch));
    state.groups.push(g);
    push("pm_groups", groupRow(g), "グループ");
    emit();
    return g;
  }

  function updateGroup(id, patch) {
    var g = getGroup(id);
    if (!g) return null;
    var next = M.normalizeGroup(Object.assign({}, g, patch));
    state.groups[state.groups.indexOf(g)] = next;
    push("pm_groups", groupRow(next), "グループ");
    emit();
  }

  /** グループ削除。属している項目とそのタスクも一緒に消える。消えた項目数を返す。 */
  function deleteGroup(id) {
    var childItems = state.items.filter(function (it) { return it.group_id === id; });
    var childIds = childItems.map(function (it) { return it.id; });
    var taskIds = state.tasks
      .filter(function (t) { return childIds.indexOf(t.item_id) >= 0; })
      .map(function (t) { return t.id; });

    state.tasks = state.tasks.filter(function (t) { return taskIds.indexOf(t.id) < 0; });
    state.items = state.items.filter(function (it) { return it.group_id !== id; });
    state.groups = state.groups.filter(function (g) { return g.id !== id; });

    // DB 側は外部キーの連鎖削除に任せる
    remove("pm_groups", id, "グループ");
    emit();
    return childItems.length;
  }

  function moveGroup(id, dir) {
    var ordered = groups();
    var idx = ordered.findIndex(function (g) { return g.id === id; });
    var swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= ordered.length) return;
    var a = ordered[idx], b = ordered[swap];
    var tmp = a.sort_order; a.sort_order = b.sort_order; b.sort_order = tmp;
    pushMany("pm_groups", [groupRow(a), groupRow(b)], "グループの並び");
    emit();
  }

  /** グループのドラッグ並び替え: id を targetId の前／後ろへ差し込む。 */
  function reorderGroup(id, targetId, before) {
    var ordered = groups().filter(function (g) { return g.id !== id; });
    var moving = getGroup(id);
    if (!moving) return;
    var idx = ordered.findIndex(function (g) { return g.id === targetId; });
    if (idx < 0) idx = ordered.length;
    else if (!before) idx += 1;
    ordered.splice(idx, 0, moving);
    ordered.forEach(function (g, i) { g.sort_order = (i + 1) * 10; });
    pushMany("pm_groups", ordered.map(groupRow), "グループの並び");
    emit();
  }

  /* -------------------------------------------------------------- 項目 */

  function items() { return state.items; }
  function ideas() { return state.ideas; }

  function getItem(id) {
    for (var i = 0; i < state.items.length; i++) {
      if (state.items[i].id === id) return state.items[i];
    }
    return null;
  }

  function createItem(patch) {
    var maxOrder = state.items.reduce(function (m, it) { return Math.max(m, it.sort_order || 0); }, 0);
    var it = M.normalizeItem(Object.assign({
      id: M.uuid(),
      group_id: (groups()[0] || {}).id || null,
      sort_order: maxOrder + 10,
      created_at: new Date().toISOString()
    }, patch));
    state.items.push(it);
    push("pm_items", itemRow(it), "項目");
    emit();
    return it;
  }

  function updateItem(id, patch) {
    var it = getItem(id);
    if (!it) return null;
    var merged = Object.assign({}, it, patch);
    if (patch.detail) {
      merged.detail = Object.assign({}, it.detail, patch.detail);
      // カスタムプロパティ値はさらに1段深くマージする
      if (patch.detail.props) {
        merged.detail.props = Object.assign({}, it.detail.props, patch.detail.props);
      }
    }
    merged.updated_at = new Date().toISOString();
    var next = M.normalizeItem(merged);
    state.items[state.items.indexOf(it)] = next;
    push("pm_items", itemRow(next), "項目");

    var ref = { item_id: next.id };
    var label = next.title || "（無題）";
    // テキスト担当・ビジュアル担当に新しく加わった人へ
    notifyMembers(added(it.detail.text_owner, next.detail.text_owner), "assigned",
      "「" + label + "」のテキスト担当になりました", ref);
    notifyMembers(added(it.detail.visual_owner, next.detail.visual_owner), "assigned",
      "「" + label + "」のビジュアル担当になりました", ref);
    // 担当者型のカスタムプロパティに新しく加わった人へ
    if (patch.detail && patch.detail.props) {
      state.propDefs.filter(function (def) { return def.type === "member"; })
        .forEach(function (def) {
          var before = (it.detail.props || {})[def.id];
          var after = (next.detail.props || {})[def.id];
          notifyMembers(added(before, after), "assigned",
            "「" + label + "」の" + def.name + "になりました", ref);
        });
    }
    // 企画メモで新しくメンションされた人へ
    if (patch.detail && patch.detail.body !== undefined) {
      notifyMembers(added(mentionedMemberIds(it.detail.body), mentionedMemberIds(next.detail.body)),
        "mention", "「" + label + "」の企画メモでメンションされました", ref);
    }
    emit();
    return next;
  }

  function deleteItem(id) {
    var taskIds = state.tasks.filter(function (t) { return t.item_id === id; })
      .map(function (t) { return t.id; });
    state.tasks = state.tasks.filter(function (t) { return t.item_id !== id; });
    state.items = state.items.filter(function (it) { return it.id !== id; });
    remove("pm_items", id, "項目"); // タスクは外部キーで一緒に消える
    emit();
  }

  /** 複数の項目をまとめて削除（ぶら下がるタスクも消える）。消した件数を返す。 */
  function deleteItems(ids) {
    var set = {};
    ids.forEach(function (id) { set[id] = true; });
    var n = state.items.filter(function (it) { return set[it.id]; }).length;
    state.tasks = state.tasks.filter(function (t) { return !set[t.item_id]; });
    state.items = state.items.filter(function (it) { return !set[it.id]; });
    removeMany("pm_items", ids, "項目");
    emit();
    return n;
  }

  /** 行ドラッグでの移動: 項目を targetGroup の targetIndex 位置へ入れ、並びを振り直す。 */
  function moveItem(itemId, targetGroupId, targetIndex) {
    var it = getItem(itemId);
    if (!it) return;
    var siblings = state.items
      .filter(function (x) { return x.group_id === targetGroupId && x.id !== itemId; })
      .sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });
    siblings.splice(Math.max(0, Math.min(targetIndex, siblings.length)), 0, it);
    it.group_id = targetGroupId;
    siblings.forEach(function (x, i) { x.sort_order = (i + 1) * 10; });
    pushMany("pm_items", siblings.map(itemRow), "項目の並び");
    emit();
  }

  /* ----------------------------------------------- 季節イベント・出店 */

  function events() {
    return state.events.slice().sort(function (a, b) {
      return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    });
  }

  function getEvent(id) {
    for (var i = 0; i < state.events.length; i++) {
      if (state.events[i].id === id) return state.events[i];
    }
    return null;
  }

  function createEvent(patch) {
    var e = M.normalizeEvent(Object.assign({ id: M.uuid() }, patch));
    state.events.push(e);
    push("pm_events", eventRow(e), "イベント");
    emit();
    return e;
  }

  function updateEvent(id, patch) {
    var e = getEvent(id);
    if (!e) return null;
    var next = M.normalizeEvent(Object.assign({}, e, patch));
    state.events[state.events.indexOf(e)] = next;
    push("pm_events", eventRow(next), "イベント");
    emit();
  }

  function deleteEvent(id) {
    state.events = state.events.filter(function (e) { return e.id !== id; });
    remove("pm_events", id, "イベント");
    emit();
  }

  /* -------------------------------------------------------------- タスク */

  function tasks() { return state.tasks; }

  function tasksForItem(itemId) {
    return state.tasks
      .filter(function (t) { return t.item_id === itemId; })
      .sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });
  }

  /** 指定タスクの子タスク（sort_order 昇順） */
  function subtasksOf(parentId) {
    return state.tasks
      .filter(function (t) { return t.parent_id === parentId; })
      .sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });
  }

  function createTask(patch) {
    var maxOrder = state.tasks.reduce(function (m, t) { return Math.max(m, t.sort_order || 0); }, 0);
    var t = M.normalizeTask(Object.assign({
      id: M.uuid(),
      sort_order: maxOrder + 10,
      created_at: new Date().toISOString()
    }, patch));
    state.tasks.push(t);
    push("pm_tasks", taskRowOf(t), "タスク");
    // 担当者を付けて作った場合はその場で通知する
    notifyMembers(t.owner, "assigned",
      "タスク「" + (t.title || "（無題）") + "」の担当になりました",
      { item_id: t.item_id, task_id: t.id });
    emit();
    return t;
  }

  function updateTask(id, patch) {
    var t = state.tasks.filter(function (x) { return x.id === id; })[0];
    if (!t) return null;
    var next = M.normalizeTask(Object.assign({}, t, patch));
    state.tasks[state.tasks.indexOf(t)] = next;
    push("pm_tasks", taskRowOf(next), "タスク");

    var label = next.title || "（無題）";
    var ref = { item_id: next.item_id, task_id: next.id };
    // 新しく担当に加わった人へ
    notifyMembers(added(t.owner, next.owner), "assigned",
      "タスク「" + label + "」の担当になりました", ref);
    // メモで新しくメンションされた人へ
    if (patch && patch.note !== undefined) {
      notifyMembers(added(mentionedMemberIds(t.note), mentionedMemberIds(next.note)), "mention",
        "タスク「" + label + "」のメモでメンションされました", ref);
    }
    emit();
    return next;
  }

  function deleteTask(id) {
    // 子タスクも一緒に消す（1段のみ。孫は作れない仕様）
    var kids = state.tasks.filter(function (t) { return t.parent_id === id; });
    kids.forEach(function (k) { remove("pm_tasks", k.id, "タスク"); });
    var removeIds = [id].concat(kids.map(function (k) { return k.id; }));
    state.tasks = state.tasks.filter(function (t) { return removeIds.indexOf(t.id) < 0; });
    remove("pm_tasks", id, "タスク");
    emit();
  }

  /* ----------------------------------------------------------- 通知
   * 担当者に設定されたとき、本文で @メンションされたときに相手へ通知を作る。
   * 相手にアカウントが紐付いていない担当者には送れない（送信先が無いので黙って飛ばす）。 */

  function notifications() {
    return state.notifications.slice().sort(function (a, b) {
      return (a.created_at || "") < (b.created_at || "") ? 1 : -1;
    });
  }
  function unreadCount() {
    return state.notifications.filter(function (n) { return !n.read_at; }).length;
  }
  function markAllRead() {
    var unread = state.notifications.filter(function (n) { return !n.read_at; });
    if (!unread.length) return;
    var now = new Date().toISOString();
    unread.forEach(function (n) { n.read_at = now; });
    emit();
    if (!sb) return;
    sb.from("pm_notifications").update({ read_at: now })
      .in("id", unread.map(function (n) { return n.id; }))
      .then(function () {}, function () {});
  }
  function clearNotifications() {
    var ids = state.notifications.map(function (n) { return n.id; });
    if (!ids.length) return;
    state.notifications = [];
    emit();
    if (!sb) return;
    sb.from("pm_notifications").delete().in("id", ids).then(function () {}, function () {});
  }

  /** 自分の表示名（通知の「誰から」に使う） */
  function myName() {
    var p = myProfile();
    if (p && p.display_name) return p.display_name;
    return (myEmail || "").split("@")[0] || "だれか";
  }

  /** 担当者IDの配列に通知を送る。自分自身と、アカウント未紐付けの人は飛ばす。 */
  function notifyMembers(memberIds, kind, message, ref) {
    if (!sb || !memberIds || !memberIds.length) return;
    var rows = [];
    memberIds.forEach(function (mid) {
      var p = profileForMember(mid);
      if (!p || !p.email) return;                                  // 送信先なし
      if ((p.email || "").toLowerCase() === myEmail) return;        // 自分には送らない
      rows.push({
        recipient_email: p.email,
        actor_name: myName(),
        kind: kind,
        message: message,
        item_id: (ref && ref.item_id) || null,
        task_id: (ref && ref.task_id) || null
      });
    });
    if (!rows.length) return;
    sb.from("pm_notifications").insert(rows).then(function () {}, function (e) {
      console.error("通知を送れませんでした", e);
    });
  }

  /** 本文から @メンションされた担当者IDを拾う（表示名の長い順に照合） */
  function mentionedMemberIds(text) {
    var out = [];
    if (!text) return out;
    var names = state.members.map(function (m) {
      return { id: m.id, name: memberName(m.id) };
    }).filter(function (x) { return x.name; })
      .sort(function (a, b) { return b.name.length - a.name.length; });
    names.forEach(function (x) {
      if (text.indexOf("@" + x.name) >= 0 && out.indexOf(x.id) < 0) out.push(x.id);
    });
    return out;
  }

  /** 追加された分だけを返す（既に通知した相手に再通知しないため） */
  function added(before, after) {
    var b = M.memberList(before);
    return M.memberList(after).filter(function (id) { return b.indexOf(id) < 0; });
  }

  /* ------------------------------------------- タスク独自グループ */

  function taskGroups() {
    return state.taskGroups.slice().sort(function (a, b) {
      return (a.sort_order || 0) - (b.sort_order || 0);
    });
  }
  function getTaskGroup(id) {
    return state.taskGroups.filter(function (g) { return g.id === id; })[0] || null;
  }
  function createTaskGroup(patch) {
    var maxOrder = state.taskGroups.reduce(function (m, g) { return Math.max(m, g.sort_order || 0); }, 0);
    var g = M.normalizeTaskGroup(Object.assign({ sort_order: maxOrder + 10 }, patch));
    state.taskGroups.push(g);
    push("pm_task_groups", taskGroupRow(g), "タスクグループ");
    emit();
    return g;
  }
  function updateTaskGroup(id, patch) {
    var g = getTaskGroup(id);
    if (!g) return null;
    var next = M.normalizeTaskGroup(Object.assign({}, g, patch));
    state.taskGroups[state.taskGroups.indexOf(g)] = next;
    push("pm_task_groups", taskGroupRow(next), "タスクグループ");
    emit();
    return next;
  }
  function deleteTaskGroup(id) {
    // グループを消しても、属していたタスクは「未分類」に戻るだけ（タスクは消さない）
    state.tasks.forEach(function (t) {
      if (t.task_group_id === id) {
        t.task_group_id = null;
        push("pm_tasks", taskRowOf(t), "タスク");
      }
    });
    state.taskGroups = state.taskGroups.filter(function (g) { return g.id !== id; });
    remove("pm_task_groups", id, "タスクグループ");
    emit();
  }

  /* ---------------------------------------------------- 担当者マスタ */

  function members() {
    return state.members.slice().sort(function (a, b) {
      return (a.sort_order || 0) - (b.sort_order || 0);
    });
  }

  function getMember(id) {
    if (!id) return null;
    for (var i = 0; i < state.members.length; i++) {
      if (state.members[i].id === id) return state.members[i];
    }
    return null;
  }

  /* --- アカウントのプロフィール（表示名・アイコン）との紐付け --- */

  /** その担当者に紐付いているアカウントのプロフィール（無ければ null） */
  function profileForMember(memberId) {
    if (!memberId) return null;
    for (var i = 0; i < state.profiles.length; i++) {
      if (state.profiles[i].member_id === memberId) return state.profiles[i];
    }
    return null;
  }

  /** ログイン中の自分のプロフィール */
  function myProfile() {
    for (var i = 0; i < state.profiles.length; i++) {
      if ((state.profiles[i].email || "").toLowerCase() === myEmail) return state.profiles[i];
    }
    return null;
  }

  /** 担当者の表示名。アカウントが紐付いていて表示名を設定していればそれを使う。 */
  function memberName(id) {
    var m = getMember(id);
    if (!m) return "";
    var p = profileForMember(id);
    return (p && p.display_name) || m.name;
  }

  /** 担当者のアイコン画像（本人がマイページで設定したもの）。無ければ null。 */
  function memberAvatarUrl(id) {
    var p = profileForMember(id);
    return (p && p.avatar) || null;
  }

  /** 担当者の表示名を「, 」でつないで返す（検索や一覧表示用） */
  function memberNames(list) {
    return (list || []).map(memberName).filter(Boolean).join(", ");
  }

  function createMember(patch) {
    var maxOrder = state.members.reduce(function (n, m) { return Math.max(n, m.sort_order || 0); }, 0);
    var used = state.members.map(function (m) { return m.color; });
    var color = (patch && patch.color) || M.GROUP_COLORS.filter(function (c) {
      return used.indexOf(c) < 0;
    })[0] || M.GROUP_COLORS[state.members.length % M.GROUP_COLORS.length];
    var m = M.normalizeMember(Object.assign({ color: color, sort_order: maxOrder + 10 }, patch));
    state.members.push(m);
    push("pm_members", memberRow(m), "担当者");
    emit();
    return m;
  }

  function updateMember(id, patch) {
    var m = getMember(id);
    if (!m) return null;
    var next = M.normalizeMember(Object.assign({}, m, patch));
    state.members[state.members.indexOf(m)] = next;
    push("pm_members", memberRow(next), "担当者");
    emit();
  }

  /** 担当者のドラッグ並び替え: id を targetId の前／後ろへ差し込む。 */
  function reorderMember(id, targetId, before) {
    var ordered = members().filter(function (m) { return m.id !== id; });
    var moving = getMember(id);
    if (!moving) return;
    var idx = ordered.findIndex(function (m) { return m.id === targetId; });
    if (idx < 0) idx = ordered.length;
    else if (!before) idx += 1;
    ordered.splice(idx, 0, moving);
    ordered.forEach(function (m, i) { m.sort_order = (i + 1) * 10; });
    pushMany("pm_members", ordered.map(memberRow), "担当者の並び");
    emit();
  }

  function without(list, id) {
    return (list || []).filter(function (x) { return x !== id; });
  }

  /** 担当者の削除。各所の割り当てから取り除く。 */
  function deleteMember(id) {
    state.members = state.members.filter(function (m) { return m.id !== id; });

    var changedItems = [], changedTasks = [], changedIdeas = [];
    state.items.forEach(function (it) {
      if (has(it.detail.text_owner, id) || has(it.detail.visual_owner, id)) {
        it.detail.text_owner = without(it.detail.text_owner, id);
        it.detail.visual_owner = without(it.detail.visual_owner, id);
        changedItems.push(itemRow(it));
      }
    });
    state.tasks.forEach(function (t) {
      if (has(t.owner, id)) { t.owner = without(t.owner, id); changedTasks.push(taskRowOf(t)); }
    });
    state.ideas.forEach(function (i) {
      if (has(i.author, id)) { i.author = without(i.author, id); changedIdeas.push(ideaRow(i)); }
    });

    remove("pm_members", id, "担当者");
    pushMany("pm_items", changedItems, "項目の担当");
    pushMany("pm_tasks", changedTasks, "タスクの担当");
    pushMany("pm_ideas", changedIdeas, "メモの記載者");
    emit();
  }

  function has(list, id) { return (list || []).indexOf(id) >= 0; }

  /** 担当者ごとの割り当て件数（マスタ画面の表示用） */
  function memberUsage(id) {
    return {
      items: state.items.filter(function (it) {
        return has(it.detail.text_owner, id) || has(it.detail.visual_owner, id);
      }).length,
      tasks: state.tasks.filter(function (t) { return has(t.owner, id); }).length,
      ideas: state.ideas.filter(function (i) { return has(i.author, id); }).length
    };
  }

  /* ------------------------------------ 組み込みプロパティの設定（編集可能） */

  function fields() { return state.fields; }
  function fieldLabel(key) { return state.fields.labels[key] || key; }
  function fieldHidden(key) { return !!state.fields.hidden[key]; }

  function setFieldLabel(key, label) {
    state.fields.labels[key] = (label || "").trim() || M.DEFAULT_FIELDS.labels[key] || key;
    saveFields();
    emit();
  }

  function setFieldHidden(key, hidden) {
    if (hidden) state.fields.hidden[key] = true;
    else delete state.fields.hidden[key];
    saveFields();
    emit();
  }

  /* プロパティの並び順。組み込みは "f:キー"、カスタムは "p:id" で表す。 */

  function allPropertyKeys() {
    return M.FIELD_ORDER.map(function (k) { return "f:" + k; })
      .concat(propDefs().map(function (p) { return "p:" + p.id; }));
  }

  /** 保存済みの並び順に、未登録（新規追加）のプロパティを末尾へ足して返す */
  function propertyOrder() {
    var valid = {};
    allPropertyKeys().forEach(function (k) { valid[k] = true; });
    var order = (state.fields.order || []).filter(function (k) { return valid[k]; });
    var seen = {};
    order.forEach(function (k) { seen[k] = true; });
    allPropertyKeys().forEach(function (k) {
      if (!seen[k]) { order.push(k); seen[k] = true; }
    });
    return order;
  }

  function setPropertyOrder(keys) {
    state.fields.order = keys.slice();
    saveFields();
    emit();
  }

  function statuses() { return state.fields.statuses.slice(); }
  function statusLabel(key) {
    var s = state.fields.statuses.filter(function (x) { return x.key === key; })[0];
    return s ? s.label : key;
  }

  /** ステータスの選択肢を差し替える。消えたステータスの項目は先頭へ寄せる。 */
  function setStatuses(list) {
    var next = list
      .map(function (s) {
        return { key: s.key || ("st_" + M.uuid().slice(0, 8)), label: (s.label || "").trim() || "（無題）" };
      })
      .filter(function (s, i, arr) {
        return arr.findIndex(function (x) { return x.key === s.key; }) === i;
      });
    if (!next.length) return;
    var keys = next.map(function (s) { return s.key; });
    var changed = [];
    state.items.forEach(function (it) {
      if (keys.indexOf(it.status) < 0) { it.status = keys[0]; changed.push(itemRow(it)); }
    });
    state.fields.statuses = next;
    saveFields();
    pushMany("pm_items", changed, "項目のステータス");
    emit();
  }

  function priorities() { return state.fields.priorities.slice(); }

  /**
   * 優先度の選択肢を差し替える。優先度は値そのものが表示名なので、
   * 名前を変えたときは既存項目の値も一緒に移し替える。
   */
  function setPriorities(list, renames) {
    var next = list.map(function (p) { return (p || "").trim(); }).filter(Boolean);
    var changed = {};
    (renames || []).forEach(function (r) {
      if (!r.from || r.from === r.to) return;
      state.items.forEach(function (it) {
        if (it.detail.priority === r.from) { it.detail.priority = r.to; changed[it.id] = it; }
      });
    });
    state.items.forEach(function (it) {
      if (it.detail.priority && next.indexOf(it.detail.priority) < 0) {
        it.detail.priority = "";
        changed[it.id] = it;
      }
    });
    state.fields.priorities = next;
    saveFields();
    pushMany("pm_items", Object.keys(changed).map(function (k) { return itemRow(changed[k]); }), "項目の優先度");
    emit();
  }

  function channels() { return state.fields.channels.slice(); }
  function channelLabel(key) {
    var c = state.fields.channels.filter(function (x) { return x.key === key; })[0];
    return c ? c.label : key;
  }
  function channelShort(key) {
    var c = state.fields.channels.filter(function (x) { return x.key === key; })[0];
    return c ? (c.short || c.label.slice(0, 2)) : key.slice(0, 2);
  }

  /** 媒体の選択肢を差し替える。消えた媒体は各項目からも外す。 */
  function setChannels(list) {
    var next = list
      .map(function (c) {
        return {
          key: c.key || ("ch_" + M.uuid().slice(0, 8)),
          label: (c.label || "").trim() || "（無題）",
          short: (c.short || "").trim()
        };
      })
      .filter(function (c, i, arr) {
        return arr.findIndex(function (x) { return x.key === c.key; }) === i;
      });
    var keys = next.map(function (c) { return c.key; });
    var changed = [];
    state.items.forEach(function (it) {
      var before = (it.detail.channels || []).length;
      it.detail.channels = (it.detail.channels || []).filter(function (k) { return keys.indexOf(k) >= 0; });
      if (it.detail.channels.length !== before) changed.push(itemRow(it));
    });
    state.fields.channels = next;
    saveFields();
    pushMany("pm_items", changed, "項目の媒体");
    emit();
  }

  /* --------------------------------------------- カスタムプロパティ定義 */

  function propDefs() {
    return state.propDefs.slice().sort(function (a, b) {
      return (a.sort_order || 0) - (b.sort_order || 0);
    });
  }

  function getPropDef(id) {
    for (var i = 0; i < state.propDefs.length; i++) {
      if (state.propDefs[i].id === id) return state.propDefs[i];
    }
    return null;
  }

  function createPropDef(patch) {
    var maxOrder = state.propDefs.reduce(function (m, p) { return Math.max(m, p.sort_order || 0); }, 0);
    var p = M.normalizePropDef(Object.assign({ id: M.uuid(), sort_order: maxOrder + 10 }, patch));
    state.propDefs.push(p);
    push("pm_prop_defs", propRow(p), "プロパティ");
    emit();
    return p;
  }

  function updatePropDef(id, patch) {
    var p = getPropDef(id);
    if (!p) return null;
    var next = M.normalizePropDef(Object.assign({}, p, patch));
    state.propDefs[state.propDefs.indexOf(p)] = next;
    push("pm_prop_defs", propRow(next), "プロパティ");
    emit();
  }

  /** プロパティ定義の削除。全項目からその値も取り除く。 */
  function deletePropDef(id) {
    state.propDefs = state.propDefs.filter(function (p) { return p.id !== id; });
    var changed = [];
    state.items.forEach(function (it) {
      if (it.detail.props && id in it.detail.props) {
        delete it.detail.props[id];
        changed.push(itemRow(it));
      }
    });
    remove("pm_prop_defs", id, "プロパティ");
    pushMany("pm_items", changed, "項目のプロパティ値");
    emit();
  }

  /* -------------------------------------------------------- アイデア */

  function createIdea(patch) {
    var idea = M.normalizeIdea(Object.assign({ id: M.uuid() }, patch));
    state.ideas.unshift(idea);
    push("pm_ideas", ideaRow(idea), "メモ");
    notifyMembers(mentionedMemberIds(idea.body), "mention",
      "アイデアmemo でメンションされました", null);
    emit();
    return idea;
  }

  function updateIdea(id, patch) {
    var idea = state.ideas.filter(function (i) { return i.id === id; })[0];
    if (!idea) return null;
    var beforeBody = idea.body;
    Object.assign(idea, patch);
    push("pm_ideas", ideaRow(idea), "メモ");
    if (patch && patch.body !== undefined) {
      notifyMembers(added(mentionedMemberIds(beforeBody), mentionedMemberIds(idea.body)),
        "mention", "アイデアmemo でメンションされました", null);
    }
    emit();
    return idea;
  }

  function deleteIdea(id) {
    state.ideas = state.ideas.filter(function (i) { return i.id !== id; });
    remove("pm_ideas", id, "メモ");
    emit();
  }

  /* ---------------------------------------------------- ワークスペース */

  /** ログインできる人の一覧（管理者だけが編集できる。RLS でも守られている） */
  function workspaceUsers() {
    return sb.from("pm_workspace_users").select("id, email, role, last_seen_at").order("email");
  }
  function inviteUser(email, role) {
    return sb.from("pm_workspace_users").insert({ email: email.trim(), role: role || "editor" });
  }
  function setUserRole(id, role) {
    return sb.from("pm_workspace_users").update({ role: role }).eq("id", id);
  }
  function removeUser(id) {
    return sb.from("pm_workspace_users").delete().eq("id", id);
  }

  return {
    setClient: setClient,
    init: init,
    subscribe: subscribe,
    isReady: function () { return ready; },

    groups: groups,
    getGroup: getGroup,
    colorOf: colorOf,
    createGroup: createGroup,
    updateGroup: updateGroup,
    deleteGroup: deleteGroup,
    moveGroup: moveGroup,
    reorderGroup: reorderGroup,
    deleteItems: deleteItems,

    items: items,
    getItem: getItem,
    createItem: createItem,
    updateItem: updateItem,
    deleteItem: deleteItem,
    moveItem: moveItem,

    fields: fields,
    fieldLabel: fieldLabel,
    fieldHidden: fieldHidden,
    setFieldLabel: setFieldLabel,
    setFieldHidden: setFieldHidden,
    propertyOrder: propertyOrder,
    setPropertyOrder: setPropertyOrder,
    statuses: statuses,
    statusLabel: statusLabel,
    setStatuses: setStatuses,
    priorities: priorities,
    setPriorities: setPriorities,
    channels: channels,
    channelLabel: channelLabel,
    channelShort: channelShort,
    setChannels: setChannels,

    members: members,
    getMember: getMember,
    memberName: memberName,
    memberNames: memberNames,
    memberAvatarUrl: memberAvatarUrl,
    profileForMember: profileForMember,
    myProfile: myProfile,

    notifications: notifications,
    unreadCount: unreadCount,
    markAllRead: markAllRead,
    clearNotifications: clearNotifications,
    mentionedMemberIds: mentionedMemberIds,
    createMember: createMember,
    updateMember: updateMember,
    deleteMember: deleteMember,
    reorderMember: reorderMember,
    memberUsage: memberUsage,

    propDefs: propDefs,
    getPropDef: getPropDef,
    createPropDef: createPropDef,
    updatePropDef: updatePropDef,
    deletePropDef: deletePropDef,

    tasks: tasks,
    tasksForItem: tasksForItem,
    subtasksOf: subtasksOf,
    createTask: createTask,
    updateTask: updateTask,
    deleteTask: deleteTask,

    taskGroups: taskGroups,
    getTaskGroup: getTaskGroup,
    createTaskGroup: createTaskGroup,
    updateTaskGroup: updateTaskGroup,
    deleteTaskGroup: deleteTaskGroup,

    events: events,
    getEvent: getEvent,
    createEvent: createEvent,
    updateEvent: updateEvent,
    deleteEvent: deleteEvent,

    ideas: ideas,
    createIdea: createIdea,
    updateIdea: updateIdea,
    deleteIdea: deleteIdea,

    workspaceUsers: workspaceUsers,
    inviteUser: inviteUser,
    setUserRole: setUserRole,
    removeUser: removeUser
  };
})();
