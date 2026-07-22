/* gantt.js — 年間 / 四半期 / 月間 / 週間 のタイムライン描画
 *
 * どのビューでも「1日あたりの px 数」を変えているだけなので、
 * バーの位置と長さは常に日単位で正確になる。 */

var ONI = window.ONI || {};
window.ONI = ONI;

ONI.gantt = (function () {
  "use strict";

  var M = ONI.model;

  /* ビューごとの設定。drag は 1日が細すぎる年間ビューでは無効にする。 */
  var VIEWS = {
    year: { pxPerDay: 3.6, minor: "jun", drag: false },
    quarter: { pxPerDay: 13, minor: "week", drag: true },
    month: { pxPerDay: 34, minor: "day", drag: true },
    week: { pxPerDay: 148, minor: "day", drag: true }
  };

  /** ビューと基準日から表示範囲（開始日・終了日）を決める */
  function rangeFor(view, anchor) {
    var s, e;
    if (view === "year") {
      s = M.startOfFiscalYear(anchor);
      e = M.addDays(M.addMonths(s, 12), -1);
    } else if (view === "quarter") {
      s = M.startOfFiscalQuarter(anchor);
      e = M.addDays(M.addMonths(s, 3), -1);
    } else if (view === "week") {
      s = M.startOfWeek(anchor);
      e = M.addDays(s, 6);
    } else {
      s = M.startOfMonth(anchor);
      e = M.endOfMonth(anchor);
    }
    return { start: s, end: e, days: M.diffDays(s, e) + 1 };
  }

  function rangeLabel(view, anchor) {
    var r = rangeFor(view, anchor);
    if (view === "year") {
      return r.start.getFullYear() + "年度（" + (r.start.getMonth() + 1) + "月〜"
        + r.end.getFullYear() + "年" + (r.end.getMonth() + 1) + "月）";
    }
    if (view === "quarter") {
      return M.startOfFiscalYear(anchor).getFullYear() + "年度 Q" + M.fiscalQuarterNo(anchor)
        + "（" + (r.start.getMonth() + 1) + "-" + (r.end.getMonth() + 1) + "月）";
    }
    if (view === "week") {
      return (r.start.getMonth() + 1) + "/" + r.start.getDate() + " 〜 "
        + (r.end.getMonth() + 1) + "/" + r.end.getDate() + "（" + r.start.getFullYear() + "年）";
    }
    return r.start.getFullYear() + "年 " + (r.start.getMonth() + 1) + "月";
  }

  /** 前後移動の単位 */
  function step(view, anchor, dir) {
    if (view === "year") return M.addMonths(anchor, 12 * dir);
    if (view === "quarter") return M.addMonths(anchor, 3 * dir);
    if (view === "week") return M.addDays(anchor, 7 * dir);
    return M.addMonths(M.startOfMonth(anchor), dir);
  }

  /** 連続スクロール用の描画範囲: 基準期間の前後2期間ずつを含めた5期間。
      スクロールが端に近づいたら app 側が anchor をずらして描き直す。 */
  function renderedRangeFor(view, anchor) {
    var prev = rangeFor(view, step(view, step(view, anchor, -1), -1));
    var next = rangeFor(view, step(view, step(view, anchor, 1), 1));
    return { start: prev.start, end: next.end, days: M.diffDays(prev.start, next.end) + 1 };
  }

  /** 1期間ぶんの幅（px）。スクロールボタンの移動量に使う。 */
  function periodPx(view, anchor) {
    var r = rangeFor(view, anchor);
    return r.days * VIEWS[view].pxPerDay;
  }

  /* ------------------------------------------------------------ 小道具 */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function px(n) { return n + "px"; }

  /* 現在の描画設定。render のたびに中身を書き換え、
     一度だけ張ったリスナーから参照する。 */
  var ctx = {};

  /* ------------------------------------------------------------ 描画本体 */

  /**
   * @param {HTMLElement} root  描画先
   * @param {Object} opt  { view, anchor, items, events, collapsed, onOpen, onCreate, onChange, onToggleGroup }
   */
  function render(root, opt) {
    var view = opt.view;
    var cfg = VIEWS[view];
    var r = renderedRangeFor(view, opt.anchor); // 前後1期間を含む連続レンジ
    var ppd = cfg.pxPerDay;
    var trackW = Math.round(r.days * ppd);

    root.innerHTML = "";
    root.style.setProperty("--track-w", px(trackW));

    var xOf = function (date) { return M.diffDays(r.start, date) * ppd; };

    /* ---- ヘッダー ---- */
    var head = el("div", "g-head");
    var corner = el("div", "g-corner", "内容（商品・販促・SNSテーマ）");
    head.appendChild(corner);

    var headTrack = el("div", "g-track");
    headTrack.style.width = px(trackW);
    var major = el("div", "g-major");
    var minor = el("div", "g-minor");
    headTrack.appendChild(major);
    headTrack.appendChild(minor);
    head.appendChild(headTrack);
    root.appendChild(head);

    // 上段: 月
    var cur = M.startOfMonth(r.start);
    while (cur <= r.end) {
      var mStart = cur < r.start ? r.start : cur;
      var mEnd = M.endOfMonth(cur);
      if (mEnd > r.end) mEnd = r.end;
      var c = el("div", "g-cell", (cur.getMonth() === 0 || mStart.getTime() === r.start.getTime()
        ? cur.getFullYear() + "年 " : "") + (cur.getMonth() + 1) + "月");
      c.style.left = px(xOf(mStart));
      c.style.width = px((M.diffDays(mStart, mEnd) + 1) * ppd);
      major.appendChild(c);
      cur = M.addMonths(cur, 1);
    }

    // 下段: ビューごとに 旬 / 週 / 日
    var todayISO = M.iso(M.today());
    if (cfg.minor === "day") {
      for (var i = 0; i < r.days; i++) {
        var d = M.addDays(r.start, i);
        var hol = M.isHoliday(d);
        var cell = el("div", "g-cell");
        // 月間ビューの1日幅（34px）に収まるよう括弧を省く
        cell.textContent = view === "week"
          ? d.getDate() + "日（" + M.weekday(d) + "）"
          : d.getDate() + " " + M.weekday(d);
        if (d.getDay() === 0 || hol) cell.classList.add("is-sun");
        if (d.getDay() === 0 || d.getDay() === 6 || hol) cell.classList.add("is-weekend");
        if (M.iso(d) === todayISO) cell.classList.add("is-today");
        if (hol) cell.title = hol;
        cell.style.left = px(i * ppd);
        cell.style.width = px(ppd);
        minor.appendChild(cell);
      }
    } else if (cfg.minor === "week") {
      var w = M.startOfWeek(r.start);
      while (w <= r.end) {
        var ws = w < r.start ? r.start : w;
        var we = M.addDays(w, 6);
        if (we > r.end) we = r.end;
        var wc = el("div", "g-cell", (ws.getMonth() + 1) + "/" + ws.getDate());
        wc.style.left = px(xOf(ws));
        wc.style.width = px((M.diffDays(ws, we) + 1) * ppd);
        minor.appendChild(wc);
        w = M.addDays(w, 7);
      }
    } else { // jun（上旬・中旬・下旬）
      var jm = M.startOfMonth(r.start);
      while (jm <= r.end) {
        [[1, 10, "上"], [11, 20, "中"], [21, M.endOfMonth(jm).getDate(), "下"]].forEach(function (seg) {
          var s = new Date(jm.getFullYear(), jm.getMonth(), seg[0]);
          var e = new Date(jm.getFullYear(), jm.getMonth(), seg[1]);
          if (e < r.start || s > r.end) return;
          if (s < r.start) s = r.start;
          if (e > r.end) e = r.end;
          var jc = el("div", "g-cell", seg[2]);
          jc.style.left = px(xOf(s));
          jc.style.width = px((M.diffDays(s, e) + 1) * ppd);
          minor.appendChild(jc);
        });
        jm = M.addMonths(jm, 1);
      }
    }

    /* ---- 背景オーバーレイ（罫線・週末・イベント帯・今日線） ----
       行ごとに描くとノード数が膨らむので、1枚のレイヤーにまとめて敷く。 */
    var body = el("div", "g-body");
    var overlay = el("div", "g-overlay");
    overlay.style.left = "var(--sidebar-w)";
    overlay.style.width = px(trackW);
    body.appendChild(overlay);

    if (ppd >= 8) {
      for (var k = 0; k < r.days; k++) {
        var dd = M.addDays(r.start, k);
        if (M.isNonWorkday(dd)) {
          var wk = el("div", "g-weekend");
          wk.style.left = px(k * ppd);
          wk.style.width = px(ppd);
          overlay.appendChild(wk);
        }
        var vl = el("div", "g-vline");
        vl.style.left = px(k * ppd);
        overlay.appendChild(vl);
      }
    } else {
      var mm = M.startOfMonth(r.start);
      while (mm <= r.end) {
        if (mm >= r.start) {
          var ml = el("div", "g-vline");
          ml.style.left = px(xOf(mm));
          overlay.appendChild(ml);
        }
        mm = M.addMonths(mm, 1);
      }
    }

    (opt.events || []).forEach(function (ev) {
      var s = M.parse(ev.date);
      var e = M.parse(ev.end_date || ev.date);
      if (e < r.start || s > r.end) return;
      if (s < r.start) s = r.start;
      if (e > r.end) e = r.end;
      var band = el("div", "g-eventband kind-" + (ev.kind || "season"));
      band.style.left = px(xOf(s));
      band.style.width = px((M.diffDays(s, e) + 1) * ppd);
      overlay.appendChild(band);
    });

    var t = M.today();
    if (t >= r.start && t <= r.end) {
      var tl = el("div", "g-today-line");
      tl.style.left = px(xOf(t));
      overlay.appendChild(tl);
    }

    /* ---- イベント行（クリックで追加・編集できる） ---- */
    var evRow = el("div", "g-eventrow");
    var evLabel = el("div", "g-label");
    evLabel.appendChild(el("span", "g-label-text", "季節イベント・出店"));
    var evAdd = el("button", "g-event-add", "＋");
    evAdd.title = "イベントを追加";
    evAdd.addEventListener("click", function (ev2) { ev2.stopPropagation(); opt.onCreateEvent(M.iso(M.today() >= r.start && M.today() <= r.end ? M.today() : r.start)); });
    evLabel.appendChild(evAdd);
    evRow.appendChild(evLabel);
    var evTrack = el("div", "g-track-row is-eventtrack");
    evTrack.style.width = px(trackW);
    (opt.events || []).forEach(function (ev) {
      var s = M.parse(ev.date);
      var e = M.parse(ev.end_date || ev.date);
      if (e < r.start || s > r.end) return;
      var cs = s < r.start ? r.start : s;
      var ce = e > r.end ? r.end : e;
      var chip = el("div", "g-event-chip kind-" + (ev.kind || "season"), ev.label);
      chip.style.left = px(Math.max(0, xOf(cs)));
      chip.style.width = px(Math.max(14, (M.diffDays(cs, ce) + 1) * ppd - 2));
      chip.title = ev.label + "（" + ev.date + (ev.end_date && ev.end_date !== ev.date ? " 〜 " + ev.end_date : "") + "）";
      chip.dataset.eventId = ev.id;
      evTrack.appendChild(chip);
    });
    evRow.appendChild(evTrack);
    body.appendChild(evRow);

    /* ---- 項目の行（グループはデータ駆動） ---- */
    var byGroup = {};
    opt.items.forEach(function (it) {
      (byGroup[it.group_id] = byGroup[it.group_id] || []).push(it);
    });

    var groupList = opt.groups.slice();
    // どのグループにも属さない項目があれば、末尾に「未分類」の疑似グループを足す
    if (byGroup["null"] || byGroup[null] || byGroup[undefined]) {
      groupList.push({ id: null, name: "未分類", color: "#9A9187", _virtual: true });
    }

    var shownGroups = 0;
    groupList.forEach(function (grp) {
      var list = byGroup[grp.id] || (grp.id === null
        ? (byGroup["null"] || byGroup[null] || byGroup[undefined]) : null) || [];
      shownGroups++;

      // 手動並び替え（行ドラッグ）を活かすため sort_order を優先する
      list.sort(function (a, b) {
        if ((a.sort_order || 0) !== (b.sort_order || 0)) return (a.sort_order || 0) - (b.sort_order || 0);
        return a.start_date < b.start_date ? -1 : 1;
      });

      var collapsed = !!(opt.collapsed && opt.collapsed[grp.id]);
      var g = el("div", "g-group" + (collapsed ? " is-collapsed" : ""));
      if (!grp._virtual) g.dataset.groupId = grp.id; // 行ドラッグのドロップ先判定に使う

      var gl = el("div", "g-group-label");
      if (!grp._virtual) {
        var ggrip = el("span", "g-group-grip", "⠿");
        ggrip.title = "ドラッグでグループを並び替え";
        gl.appendChild(ggrip);
      }
      var caret = el("span", "g-caret", "▾");
      caret.addEventListener("click", function (e) { e.stopPropagation(); opt.onToggleGroup(grp.id); });
      gl.appendChild(caret);

      if (grp._virtual) {
        var vdot = el("i", "g-dot");
        vdot.style.background = grp.color;
        gl.appendChild(vdot);
      } else {
        // 色スウォッチ（クリックで12色から選ぶ）
        gl.appendChild(ONI.ui.colorButton(grp.color, function (hex) {
          opt.onRecolorGroup(grp.id, hex);
        }, { title: "グループの色を変更" }));
      }

      var nameEl = el("span", "g-group-name", grp.name);
      nameEl.addEventListener("click", function () { opt.onToggleGroup(grp.id); });
      gl.appendChild(nameEl);
      gl.appendChild(el("span", "g-group-count", list.length + "件"));

      if (!grp._virtual) {
        var tools = el("span", "g-group-tools");
        var rename = el("button", "g-group-btn", "✎");
        rename.title = "グループ名を変更";
        rename.addEventListener("click", function (e) { e.stopPropagation(); opt.onRenameGroup(grp.id); });
        var delg = el("button", "g-group-btn danger", "×");
        delg.title = "グループを削除";
        delg.addEventListener("click", function (e) { e.stopPropagation(); opt.onDeleteGroup(grp.id); });
        tools.appendChild(rename);
        tools.appendChild(delg);
        gl.appendChild(tools);
      }
      g.appendChild(gl);

      var gr = el("div", "g-group-rest");
      gr.style.width = px(trackW);
      if (!grp._virtual) gr.dataset.groupId = grp.id; // 空グループでもドラッグ/クリックで項目を作れるように
      g.appendChild(gr);
      body.appendChild(g);

      if (collapsed) return;

      list.forEach(function (it) {
        // 項目に個別の色があればそれを、無ければグループの色を使う
        var barColor = it.color || grp.color;
        var selected = !!(opt.selected && opt.selected[it.id]);
        var row = el("div", "g-row" + (it.status === "done" ? " is-done" : "")
          + (selected ? " is-selected" : ""));
        row.dataset.id = it.id;

        var label = el("div", "g-label");

        var chk = document.createElement("input");
        chk.type = "checkbox";
        chk.className = "g-row-check";
        chk.checked = selected;
        chk.title = "選択（まとめて削除できます）";
        chk.addEventListener("click", function (e) { e.stopPropagation(); });
        chk.addEventListener("change", function () { opt.onSelect(it.id, chk.checked); });
        label.appendChild(chk);

        var dot = el("i", "g-dot");
        dot.style.background = barColor;
        label.appendChild(dot);
        var lt = el("span", "g-label-text", it.title);
        label.appendChild(lt);
        label.title = it.title + "（ドラッグで並び替え）";
        row.appendChild(label);
        row.dataset.groupId = grp.id == null ? "" : grp.id;

        var track = el("div", "g-track-row");
        track.style.width = px(trackW);
        track.dataset.groupId = grp.id == null ? "" : grp.id;

        var s = M.parse(it.start_date);
        var e = M.parse(it.end_date);
        if (e >= r.start && s <= r.end) {
          // 表示範囲からはみ出す分はクリップする（バーが枠外へ突き抜けないように）
          var clipStart = s < r.start;
          var clipEnd = e > r.end;
          var vs = clipStart ? r.start : s;
          var ve = clipEnd ? r.end : e;
          var left = Math.max(0, Math.round(xOf(vs)));
          var fullW = (M.diffDays(vs, ve) + 1) * ppd;
          var barW = Math.max(8, Math.min(Math.round(fullW) - 2, trackW - left));

          var bar = el("div", "g-bar" + (it.status === "done" ? " is-done" : "")
            + (cfg.drag ? " can-drag" : "")
            + (clipStart ? " clip-start" : "") + (clipEnd ? " clip-end" : ""));
          bar.style.background = barColor;
          bar.style.left = px(left);
          bar.style.width = px(barW);
          bar.dataset.id = it.id;

          bar.title = it.title + "\n" + it.start_date
            + (it.end_date !== it.start_date ? " 〜 " + it.end_date : "")
            + "\n" + ONI.store.statusLabel(it.status);

          var chs = it.detail.channels || [];
          if (chs.length && barW > 70) {
            bar.appendChild(el("span", "g-bar-ch", chs.map(function (c) {
              return ONI.store.channelShort(c);
            }).join("·")));
          }
          var inside = barW >= 44;
          if (inside) bar.appendChild(el("span", "g-bar-title", it.title));

          // クリップした側にはハンドルを出さない（実際の端がそこに無いため）
          if (cfg.drag && !clipStart) bar.appendChild(el("div", "g-bar-handle start"));
          if (cfg.drag && !clipEnd) bar.appendChild(el("div", "g-bar-handle end"));
          track.appendChild(bar);

          if (!inside) {
            var out = el("div", "g-bar-outside", it.title);
            var roomRight = trackW - (left + barW + 6);
            if (roomRight >= 60 || left < 60) {
              out.style.left = px(left + barW + 6);
              out.style.maxWidth = px(Math.min(220, Math.max(40, roomRight)));
            } else {
              // 右に余白がなければバーの左側に右寄せで出す
              out.style.right = px(trackW - left + 6);
              out.style.maxWidth = px(Math.min(220, left - 6));
              out.style.textAlign = "right";
            }
            track.appendChild(out);
          }
        }

        row.appendChild(track);
        body.appendChild(row);
      });

      // グループごとの「内容を追加」行（グループの一番下）
      if (!grp._virtual) {
        var addRow = el("div", "g-additem");
        addRow.dataset.groupId = grp.id;
        var addLabel = el("div", "g-additem-label");
        var addBtn = el("button", "g-additem-btn", "＋ 内容を追加");
        addBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          opt.onAddItem(grp.id);
        });
        addLabel.appendChild(addBtn);
        addRow.appendChild(addLabel);
        var addRest = el("div", "g-additem-rest");
        addRest.style.width = px(trackW);
        addRest.dataset.groupId = grp.id; // この帯でもクリック/横ドラッグで作成できる
        addRow.appendChild(addRest);
        body.appendChild(addRow);
      }
    });

    // グループ追加行
    var addg = el("div", "g-group-add");
    var addgLabel = el("div", "g-group-add-label");
    var addgBtn = el("button", "g-addgroup-btn", "＋ グループを追加");
    addgBtn.addEventListener("click", function () { opt.onAddGroup(); });
    addgLabel.appendChild(addgBtn);
    addg.appendChild(addgLabel);
    var addgRest = el("div", "g-group-add-rest");
    addgRest.style.width = px(trackW);
    addg.appendChild(addgRest);
    body.appendChild(addg);

    if (!opt.items.length) {
      body.appendChild(el("div", "g-empty", "項目がありません。空きセルをクリックまたは横にドラッグして作成できます。"));
    }

    root.appendChild(body);

    /* ---- 操作 ----
       root は再描画で中身を入れ替えるだけで要素自体は使い回すため、
       リスナーは一度だけ張り、毎回の設定は ctx の差し替えで渡す。 */
    ctx.ppd = ppd;
    ctx.range = r;
    ctx.drag = cfg.drag;
    ctx.onOpen = opt.onOpen;
    ctx.onCreate = opt.onCreate;
    ctx.onChange = opt.onChange;
    ctx.onCreateEvent = opt.onCreateEvent;
    ctx.onEditEvent = opt.onEditEvent;
    ctx.onMoveItem = opt.onMoveItem;
    ctx.onMoveGroup = opt.onMoveGroup;
    if (!root.__oniWired) {
      root.__oniWired = true;
      wireInteractions(root, ctx);
    }

    return { trackWidth: trackW, xOf: xOf, range: r };
  }

  /* ------------------------------------------- クリック / ドラッグ操作 */

  function wireInteractions(root, ctx) {
    var drag = null;        // バーの移動・リサイズ
    var rowDrag = null;     // 行（縦軸）の並び替え
    var groupDrag = null;   // グループごとの並び替え
    var createDrag = null;  // 空きセルを横に引いて新規作成
    var suppressClick = false; // ドラッグ直後に発火する click を無視するため

    function dayAt(track, clientX) {
      var rect = track.getBoundingClientRect();
      var idx = Math.floor((clientX - rect.left) / ctx.ppd);
      return Math.max(0, Math.min(ctx.range.days - 1, idx));
    }

    function clearDropMarkers() {
      root.querySelectorAll(".drop-before, .drop-after, .drop-into").forEach(function (n) {
        n.classList.remove("drop-before", "drop-after", "drop-into");
      });
    }

    root.addEventListener("pointerdown", function (ev) {
      // 前回のドラッグで click が発火しなかった場合の取りこぼしをリセット
      suppressClick = false;

      // 1) バーのドラッグ（移動・リサイズ）
      var bar = ev.target.closest(".g-bar");
      if (bar && ctx.drag) {
        ev.preventDefault();
        var handle = ev.target.closest(".g-bar-handle");
        drag = {
          id: bar.dataset.id,
          node: bar,
          mode: handle ? (handle.classList.contains("start") ? "resize-start" : "resize-end") : "move",
          startX: ev.clientX,
          left0: parseFloat(bar.style.left),
          width0: parseFloat(bar.style.width),
          moved: false
        };
        bar.setPointerCapture(ev.pointerId);
        return;
      }
      if (bar) return; // 年間ビューはクリックのみ

      // 2) グループ見出しのグリップでグループごと並び替え
      var ggrip = ev.target.closest(".g-group-grip");
      if (ggrip) {
        ev.preventDefault();
        var gnode = ggrip.closest(".g-group");
        groupDrag = { id: gnode.dataset.groupId, node: gnode, startY: ev.clientY, active: false, target: null };
        return;
      }

      // 3) 行ラベルのドラッグ（縦の並び替え・グループ間移動）
      var label = ev.target.closest(".g-row .g-label");
      if (label) {
        if (ev.target.closest(".g-row-check")) return; // チェックボックスは対象外
        var row = label.closest(".g-row");
        rowDrag = { id: row.dataset.id, node: row, startY: ev.clientY, active: false, target: null };
        return;
      }

      // 3) 空きセルを横に引いて期間指定の新規作成
      var track = ev.target.closest(".g-track-row, .g-group-rest, .g-additem-rest");
      if (track && ctx.drag && !track.classList.contains("is-eventtrack")) {
        if (!track.classList.contains("g-track-row") && !track.dataset.groupId) return;
        createDrag = {
          track: track,
          groupId: track.dataset.groupId || null,
          day0: dayAt(track, ev.clientX),
          startX: ev.clientX,
          active: false,
          ghost: null
        };
      }
    });

    root.addEventListener("pointermove", function (ev) {
      if (drag) {
        var dx = ev.clientX - drag.startX;
        var days = Math.round(dx / ctx.ppd);
        if (Math.abs(dx) > 3) {
          drag.moved = true;
          drag.node.classList.add("is-dragging");
        }
        drag.days = days;

        var snapped = days * ctx.ppd;
        if (drag.mode === "move") {
          drag.node.style.left = px(drag.left0 + snapped);
        } else if (drag.mode === "resize-start") {
          var w = drag.width0 - snapped;
          if (w < ctx.ppd - 2) return;
          drag.node.style.left = px(drag.left0 + snapped);
          drag.node.style.width = px(w);
        } else {
          var w2 = drag.width0 + snapped;
          if (w2 < ctx.ppd - 2) return;
          drag.node.style.width = px(w2);
        }
        return;
      }

      if (groupDrag) {
        var gdy = ev.clientY - groupDrag.startY;
        if (!groupDrag.active && Math.abs(gdy) > 5) {
          groupDrag.active = true;
          groupDrag.node.classList.add("is-groupdragging");
        }
        if (!groupDrag.active) return;
        ev.preventDefault();

        clearDropMarkers();
        groupDrag.target = null;
        var gUnder = document.elementFromPoint(ev.clientX, ev.clientY);
        var overG = gUnder && gUnder.closest ? gUnder.closest(".g-group") : null;
        // 項目行の上でも、その行が属するグループを対象にする
        if (!overG && gUnder && gUnder.closest) {
          var orow = gUnder.closest(".g-row");
          if (orow && orow.dataset.groupId) {
            overG = root.querySelector('.g-group[data-group-id="' + orow.dataset.groupId + '"]');
          }
        }
        if (!overG || overG === groupDrag.node || !overG.dataset.groupId) return;
        var grect = overG.getBoundingClientRect();
        var gBefore = ev.clientY < grect.top + grect.height / 2;
        overG.classList.add(gBefore ? "drop-before" : "drop-after");
        groupDrag.target = { groupId: overG.dataset.groupId, before: gBefore };
        return;
      }

      if (rowDrag) {
        var dy = ev.clientY - rowDrag.startY;
        if (!rowDrag.active && Math.abs(dy) > 5) {
          rowDrag.active = true;
          rowDrag.node.classList.add("is-rowdragging");
        }
        if (!rowDrag.active) return;
        ev.preventDefault();

        clearDropMarkers();
        rowDrag.target = null;
        var under = document.elementFromPoint(ev.clientX, ev.clientY);
        if (!under) return;
        var overRow = under.closest ? under.closest(".g-row") : null;
        var overGroup = under.closest ? under.closest(".g-group") : null;
        if (overRow && overRow !== rowDrag.node) {
          var rect = overRow.getBoundingClientRect();
          var before = ev.clientY < rect.top + rect.height / 2;
          overRow.classList.add(before ? "drop-before" : "drop-after");
          rowDrag.target = { rowId: overRow.dataset.id, groupId: overRow.dataset.groupId || null, before: before };
        } else if (overGroup && overGroup.dataset.groupId) {
          overGroup.classList.add("drop-into");
          rowDrag.target = { groupId: overGroup.dataset.groupId, index: 0 };
        }
        return;
      }

      if (createDrag) {
        var cdx = ev.clientX - createDrag.startX;
        if (!createDrag.active && Math.abs(cdx) > 5) {
          createDrag.active = true;
          createDrag.ghost = el("div", "g-createghost");
          createDrag.track.appendChild(createDrag.ghost);
        }
        if (!createDrag.active) return;
        var d1 = dayAt(createDrag.track, ev.clientX);
        createDrag.dayA = Math.min(createDrag.day0, d1);
        createDrag.dayB = Math.max(createDrag.day0, d1);
        createDrag.ghost.style.left = px(createDrag.dayA * ctx.ppd);
        createDrag.ghost.style.width = px((createDrag.dayB - createDrag.dayA + 1) * ctx.ppd - 2);
      }
    });

    function endDrag(ev) {
      if (drag) {
        var d = drag;
        drag = null;
        d.node.classList.remove("is-dragging");
        if (!d.moved) return; // クリック扱い（click ハンドラが詳細を開く）
        suppressClick = true;
        if (!d.days) { ctx.onChange && ctx.onChange(d.id, null); return; }

        var it = ONI.store.getItem(d.id);
        if (!it) return;
        var s = M.parse(it.start_date);
        var e = M.parse(it.end_date);
        var patch;
        if (d.mode === "move") {
          patch = { start_date: M.iso(M.addDays(s, d.days)), end_date: M.iso(M.addDays(e, d.days)) };
        } else if (d.mode === "resize-start") {
          var ns = M.addDays(s, d.days);
          if (ns > e) ns = e;
          patch = { start_date: M.iso(ns) };
        } else {
          var ne = M.addDays(e, d.days);
          if (ne < s) ne = s;
          patch = { end_date: M.iso(ne) };
        }
        ctx.onChange(d.id, patch);
        return;
      }

      if (groupDrag) {
        var gd = groupDrag;
        groupDrag = null;
        clearDropMarkers();
        gd.node.classList.remove("is-groupdragging");
        if (!gd.active) return;
        suppressClick = true;
        if (gd.target) ctx.onMoveGroup(gd.id, gd.target);
        return;
      }

      if (rowDrag) {
        var rd = rowDrag;
        rowDrag = null;
        clearDropMarkers();
        rd.node.classList.remove("is-rowdragging");
        if (!rd.active) return; // クリック扱い
        suppressClick = true;
        if (rd.target) ctx.onMoveItem(rd.id, rd.target);
        return;
      }

      if (createDrag) {
        var cd = createDrag;
        createDrag = null;
        if (cd.ghost) cd.ghost.remove();
        if (!cd.active) return; // クリック扱い
        suppressClick = true;
        var start = M.iso(M.addDays(ctx.range.start, cd.dayA));
        var end = M.iso(M.addDays(ctx.range.start, cd.dayB));
        ctx.onCreate(start, cd.groupId, end);
      }
    }

    root.addEventListener("pointerup", endDrag);
    root.addEventListener("pointercancel", endDrag);

    root.addEventListener("click", function (ev) {
      if (suppressClick) { suppressClick = false; return; }

      // イベントチップ → 編集
      var chip = ev.target.closest(".g-event-chip");
      if (chip) { ctx.onEditEvent(chip.dataset.eventId); return; }

      // バー・行ラベルのクリック → 詳細を開く（どのビューでも）
      var bar = ev.target.closest(".g-bar");
      if (bar) { ctx.onOpen(bar.dataset.id); return; }
      var label = ev.target.closest(".g-row .g-label");
      if (label) { ctx.onOpen(label.closest(".g-row").dataset.id); return; }

      var track = ev.target.closest(".g-track-row, .g-group-rest, .g-additem-rest");
      if (!track) return;
      var date = M.iso(M.addDays(ctx.range.start, dayAt(track, ev.clientX)));

      // イベント行の空きクリック → イベントを追加
      if (track.classList.contains("is-eventtrack")) { ctx.onCreateEvent(date); return; }

      // 項目行・グループ行・追加行の空きクリック → その日付・そのグループで新規項目
      if (track.classList.contains("g-track-row")) {
        if (!track.closest(".g-row")) return;
      } else if (!track.dataset.groupId) return;
      ctx.onCreate(date, track.dataset.groupId || null);
    });
  }

  return {
    VIEWS: VIEWS,
    rangeFor: rangeFor,
    renderedRangeFor: renderedRangeFor,
    periodPx: periodPx,
    rangeLabel: rangeLabel,
    step: step,
    render: render
  };
})();
