/* detail.js — Notion風の詳細パネル（右からのスライドオーバー） */

var ONI = window.ONI || {};
window.ONI = ONI;

ONI.detail = (function () {
  "use strict";

  var M = ONI.model;
  var drawer, overlay, currentId = null, saveTimer = null;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /** 入力のたびに保存すると重いので少し待ってからまとめて保存する */
  function saveSoon(patch) {
    clearTimeout(saveTimer);
    var id = currentId;
    saveTimer = setTimeout(function () {
      ONI.store.updateItem(id, patch);
    }, 350);
  }

  function saveNow(patch) {
    clearTimeout(saveTimer);
    ONI.store.updateItem(currentId, patch);
  }

  function select(options, value, onChange) {
    var s = document.createElement("select");
    options.forEach(function (o) {
      var opt = document.createElement("option");
      opt.value = o[0];
      opt.textContent = o[1];
      if (o[0] === value) opt.selected = true;
      s.appendChild(opt);
    });
    s.addEventListener("change", function () { onChange(s.value); });
    return s;
  }

  function textInput(value, placeholder, onChange) {
    var i = document.createElement("input");
    i.type = "text";
    i.value = value || "";
    i.placeholder = placeholder || "";
    i.addEventListener("input", function () { onChange(i.value); });
    return i;
  }

  /* ---------------------------------------------------------- 開く/閉じる */

  function open(id) {
    var it = ONI.store.getItem(id);
    if (!it) return;
    currentId = id;
    render(it);
    overlay.hidden = false;
    drawer.hidden = false;
    var t = drawer.querySelector(".d-title");
    if (t && it.title === "（無題）") { t.focus(); t.select && t.select(); }
  }

  function close() {
    clearTimeout(saveTimer);
    if (saveTimer) saveTimer = null;
    currentId = null;
    overlay.hidden = true;
    drawer.hidden = true;
  }

  function refresh() {
    if (!currentId) return;
    var it = ONI.store.getItem(currentId);
    if (!it) { close(); return; }
    // 入力中の再描画は打鍵を邪魔するので、フォーカスがパネル外のときだけ描き直す
    if (drawer.contains(document.activeElement)) return;
    render(it);
  }

  /* -------------------------------------------------------------- 描画 */

  function render(it) {
    var d = it.detail;
    drawer.innerHTML = "";

    /* ヘッダー */
    var grp = ONI.store.getGroup(it.group_id);
    var head = el("div", "d-head");
    var tag = el("span", "d-cat-tag", grp ? grp.name : "未分類");
    tag.style.background = grp ? grp.color : "#9A9187";
    head.appendChild(tag);
    if (d.priority) head.appendChild(el("span", "pri pri-" + d.priority, "優先度 " + d.priority));
    var close$ = el("button", "btn btn-ghost d-close", "閉じる");
    close$.addEventListener("click", close);
    head.appendChild(close$);
    drawer.appendChild(head);

    var body = el("div", "d-body");
    drawer.appendChild(body);

    /* タイトル */
    var title = document.createElement("textarea");
    title.className = "d-title";
    title.rows = 1;
    title.value = it.title;
    var autosize = function () {
      title.style.height = "auto";
      title.style.height = title.scrollHeight + "px";
    };
    title.addEventListener("input", function () {
      autosize();
      saveSoon({ title: title.value });
    });
    body.appendChild(title);
    setTimeout(autosize, 0);

    /* プロパティ。並び順は store が保持し、グリップのドラッグで入れ替えられる。
       名前クリックで設定エディタが開く。 */
    var props = el("div", "d-props");
    ONI.store.propertyOrder().forEach(function (key) {
      var node = key.charAt(0) === "f"
        ? builtinPropRow(props, key.slice(2), it, d)
        : customPropRow(props, key.slice(2), it);
      return node;
    });
    wirePropDrag(props);
    body.appendChild(props);
    body.appendChild(addPropButton());

    /* 本文・詳細テキスト */
    function textarea(label, value, key) {
      body.appendChild(el("div", "d-section-title", label));
      var ta = el("textarea", "d-textarea");
      ta.value = value || "";
      ta.addEventListener("input", function () {
        var p = {};
        p[key] = ta.value;
        saveSoon({ detail: p });
      });
      body.appendChild(ta);
      return ta;
    }

    /* タスク（この項目にぶら下がる ToDo） */
    renderTasks(body, it);

    textarea("内容・企画メモ", d.body, "body");
    if (d.concept) textarea("コンセプト・イメージ", d.concept, "concept");
    if (d.purpose) textarea("目的", d.purpose, "purpose");
    if (d.visual_content || d.text_content) {
      textarea("ビジュアル内容", d.visual_content, "visual_content");
      textarea("テキスト内容", d.text_content, "text_content");
    }

    /* 参考URL */
    body.appendChild(el("div", "d-section-title", "参考URL・格納先"));
    var refs = el("div", "d-refs");
    (d.refs || []).forEach(function (u) {
      var a = el("a", null, u);
      a.href = u;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      refs.appendChild(a);
    });
    if (d.asset_url) {
      var a2 = el("a", null, "格納先: " + d.asset_url);
      a2.href = d.asset_url;
      a2.target = "_blank";
      a2.rel = "noopener noreferrer";
      refs.appendChild(a2);
    }
    var addRef = textInput("", "URLを貼り付けて Enter", function () {});
    addRef.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" || e.isComposing || e.keyCode === 229 || !addRef.value.trim()) return;
      var cur = (ONI.store.getItem(currentId).detail.refs || []).slice();
      cur.push(addRef.value.trim());
      addRef.value = "";
      saveNow({ detail: { refs: cur } });
      render(ONI.store.getItem(currentId));
    });
    refs.appendChild(addRef);
    body.appendChild(refs);

    /* フッター */
    var foot = el("div", "d-footer");
    var dup = el("button", "btn btn-ghost", "複製");
    dup.addEventListener("click", function () {
      var src = ONI.store.getItem(currentId);
      var copy = ONI.store.createItem({
        group_id: src.group_id,
        title: src.title + "（複製）",
        start_date: src.start_date,
        end_date: src.end_date,
        detail: JSON.parse(JSON.stringify(src.detail))
      });
      open(copy.id);
    });
    var del = el("button", "btn btn-danger", "削除");
    del.addEventListener("click", function () {
      var src = ONI.store.getItem(currentId);
      var n = ONI.store.tasksForItem(currentId).length;
      var msg = "「" + src.title + "」を削除します。"
        + (n ? "\nこの項目のタスク " + n + " 件も一緒に削除されます。" : "") + "\nよろしいですか？";
      if (!confirm(msg)) return;
      ONI.store.deleteItem(currentId);
      close();
    });
    foot.appendChild(dup);
    foot.appendChild(del);
    body.appendChild(foot);
  }

  /* ------------------------------- プロパティ行（名前クリックで設定を編集） */

  /** プロパティ1行（グリップ＋名前ボタン＋値）。名前クリックで設定エディタ。 */
  function propRow(host, orderKey, labelText, kind, id, valueNode) {
    var rowEl = el("div", "d-prop-row");
    rowEl.dataset.orderKey = orderKey;

    var grip = el("div", "d-prop-grip", "⠿");
    grip.title = "ドラッグで並び替え";
    rowEl.appendChild(grip);

    var name = el("div", "d-prop-name");
    var btn = el("button", "d-prop-namebtn", labelText);
    btn.title = "このプロパティを編集";
    btn.addEventListener("click", function () { openPropertyEditor(kind, id); });
    name.appendChild(btn);
    rowEl.appendChild(name);

    var value = el("div", "d-prop-value");
    value.appendChild(valueNode);
    rowEl.appendChild(value);

    host.appendChild(rowEl);
    return rowEl;
  }

  /** 組み込みプロパティ1行。非表示設定のものは描画しない。 */
  function builtinPropRow(host, fieldKey, it, d) {
    var S = ONI.store;
    if (S.fieldHidden(fieldKey)) return null;
    var node;

    if (fieldKey === "group") {
      node = select(
        S.groups().map(function (g) { return [g.id, g.name]; }),
        it.group_id,
        function (v) { saveNow({ group_id: v }); }
      );

    } else if (fieldKey === "dates") {
      node = el("div", "d-dates");
      var start = document.createElement("input");
      start.type = "date";
      start.value = it.start_date;
      var end = document.createElement("input");
      end.type = "date";
      end.value = it.end_date;
      start.addEventListener("change", function () {
        var patch = { start_date: start.value };
        if (end.value < start.value) { patch.end_date = start.value; end.value = start.value; }
        saveNow(patch);
      });
      end.addEventListener("change", function () {
        if (end.value < start.value) end.value = start.value;
        saveNow({ end_date: end.value });
      });
      node.appendChild(start);
      node.appendChild(el("span", null, "〜"));
      node.appendChild(end);

    } else if (fieldKey === "status") {
      node = select(
        S.statuses().map(function (s) { return [s.key, s.label]; }),
        it.status,
        function (v) { saveNow({ status: v }); }
      );

    } else if (fieldKey === "priority") {
      node = select(
        [["", "—"]].concat(S.priorities().map(function (p) { return [p, p]; })),
        d.priority || "",
        function (v) { saveNow({ detail: { priority: v } }); }
      );

    } else if (fieldKey === "channels") {
      node = el("div", "chips");
      S.channels().forEach(function (c) {
        var on = (d.channels || []).indexOf(c.key) >= 0;
        var b = el("button", "chip" + (on ? " is-on" : ""), c.label);
        b.addEventListener("click", function () {
          var cur = (ONI.store.getItem(currentId).detail.channels || []).slice();
          var i = cur.indexOf(c.key);
          if (i >= 0) cur.splice(i, 1); else cur.push(c.key);
          saveNow({ detail: { channels: cur } });
        });
        node.appendChild(b);
      });

    } else if (fieldKey === "text_owner" || fieldKey === "visual_owner") {
      // 担当者マスタから選ぶ（値は担当者ID）
      node = ONI.ui.memberSelect(d[fieldKey], function (v) {
        var p = {};
        p[fieldKey] = v;
        saveNow({ detail: p });
      }, { placeholder: "担当者なし" });

    } else if (fieldKey === "color") {
      // 個別指定が無いときはグループ色を表示し、変更すると項目固有の色になる
      var grpColor = (S.getGroup(it.group_id) || {}).color || "#9A9187";
      node = el("div", "d-color");
      node.appendChild(ONI.ui.swatchGrid(it.color || grpColor, function (hex) {
        saveNow({ color: hex });
        render(ONI.store.getItem(currentId)); // 選択中の印と「戻す」の出し入れを反映
      }));
      var foot = el("div", "d-color-foot");
      foot.appendChild(el("span", "d-color-note",
        it.color ? "この項目だけの色（" + M.colorName(it.color) + "）" : "グループの色を使用中"));
      if (it.color) {
        var reset = el("button", "d-color-reset", "グループの色に戻す");
        reset.addEventListener("click", function () {
          saveNow({ color: "" });
          render(ONI.store.getItem(currentId));
        });
        foot.appendChild(reset);
      }
      node.appendChild(foot);

    } else {
      return null;
    }

    return propRow(host, "f:" + fieldKey, S.fieldLabel(fieldKey), "field", fieldKey, node);
  }

  /** カスタムプロパティ1行 */
  function customPropRow(host, defId, it) {
    var def = ONI.store.getPropDef(defId);
    if (!def) return null;
    return propRow(host, "p:" + def.id, def.name, "custom", def.id, propEditor(def, it));
  }

  /** プロパティ行のドラッグ並び替え */
  function wirePropDrag(host) {
    var drag = null;

    function clearMarks() {
      host.querySelectorAll(".drop-before, .drop-after").forEach(function (n) {
        n.classList.remove("drop-before", "drop-after");
      });
    }

    host.addEventListener("pointerdown", function (ev) {
      var grip = ev.target.closest(".d-prop-grip");
      if (!grip) return;
      ev.preventDefault();
      var rowEl = grip.closest(".d-prop-row");
      drag = { node: rowEl, startY: ev.clientY, active: false, target: null };
      grip.setPointerCapture(ev.pointerId);
    });

    host.addEventListener("pointermove", function (ev) {
      if (!drag) return;
      if (!drag.active && Math.abs(ev.clientY - drag.startY) > 4) {
        drag.active = true;
        drag.node.classList.add("is-propdrag");
      }
      if (!drag.active) return;

      clearMarks();
      drag.target = null;
      var under = document.elementFromPoint(ev.clientX, ev.clientY);
      var overRow = under && under.closest ? under.closest(".d-prop-row") : null;
      if (!overRow || overRow === drag.node) return;
      var rect = overRow.getBoundingClientRect();
      var before = ev.clientY < rect.top + rect.height / 2;
      overRow.classList.add(before ? "drop-before" : "drop-after");
      drag.target = { key: overRow.dataset.orderKey, before: before };
    });

    function end() {
      if (!drag) return;
      var d2 = drag;
      drag = null;
      clearMarks();
      d2.node.classList.remove("is-propdrag");
      if (!d2.active || !d2.target) return;

      var moving = d2.node.dataset.orderKey;
      var order = ONI.store.propertyOrder().filter(function (k) { return k !== moving; });
      var idx = order.indexOf(d2.target.key);
      if (idx < 0) idx = order.length;
      else if (!d2.target.before) idx += 1;
      order.splice(idx, 0, moving);
      ONI.store.setPropertyOrder(order);
      render(ONI.store.getItem(currentId));
    }

    host.addEventListener("pointerup", end);
    host.addEventListener("pointercancel", end);
  }

  /** 選択肢リストの編集UI。{key,label} の配列を扱い、行の追加・削除・並べ替えができる。 */
  function optionListEditor(rows, opt) {
    opt = opt || {};
    var wrap = el("div", "prop-opts");
    var list = el("div", "prop-opts-list");

    function addRow(r) {
      var line = el("div", "prop-opt-row");
      line.dataset.key = r.key || "";
      line.dataset.original = r.label;

      var label = document.createElement("input");
      label.type = "text";
      label.className = "input prop-opt-label";
      label.value = r.label;
      line.appendChild(label);

      if (opt.withShort) {
        var short = document.createElement("input");
        short.type = "text";
        short.className = "input prop-opt-short";
        short.placeholder = "略称";
        short.maxLength = 4;
        short.value = r.short || "";
        line.appendChild(short);
      }

      var del = el("button", "prop-opt-del", "×");
      del.title = "この選択肢を削除";
      del.addEventListener("click", function () { line.remove(); });
      line.appendChild(del);

      list.appendChild(line);
      return label;
    }

    rows.forEach(addRow);
    wrap.appendChild(list);

    var add = el("button", "prop-opt-add", "＋ 選択肢を追加");
    add.addEventListener("click", function () {
      var input = addRow({ key: "", label: "" });
      input.focus();
    });
    wrap.appendChild(add);

    wrap.collect = function () {
      return Array.prototype.map.call(list.querySelectorAll(".prop-opt-row"), function (line) {
        return {
          key: line.dataset.key || "",
          original: line.dataset.original,
          label: line.querySelector(".prop-opt-label").value.trim(),
          short: opt.withShort ? line.querySelector(".prop-opt-short").value.trim() : ""
        };
      }).filter(function (r) { return r.label; });
    };
    return wrap;
  }

  /**
   * プロパティ設定エディタ。
   * @param {"field"|"custom"} kind  組み込み / ユーザー追加
   * @param {string} id  field のキー、または propDef の id
   */
  function openPropertyEditor(kind, id) {
    var S = ONI.store;
    var isField = kind === "field";
    var def = isField ? null : S.getPropDef(id);
    if (!isField && !def) return;

    var m = ONI.app.openModal("プロパティを編集");

    function field(labelText, node) {
      var r = el("label", "modal-field");
      r.appendChild(el("span", null, labelText));
      r.appendChild(node);
      m.appendChild(r);
      return node;
    }

    var name = document.createElement("input");
    name.type = "text";
    name.className = "input";
    name.value = isField ? S.fieldLabel(id) : def.name;
    field("プロパティ名", name);

    // 種類: 組み込みは変更不可、カスタムは変更できる
    var typeSel = null;
    if (isField) {
      var fixedType = { group: "グループ選択", dates: "期間", status: "ステータス",
        priority: "選択", channels: "マルチセレクト", text_owner: "担当者", visual_owner: "担当者" };
      var t = el("div", "modal-static", fixedType[id] || "—");
      field("種類（組み込みのため変更できません）", t);
    } else {
      typeSel = document.createElement("select");
      typeSel.className = "input";
      Object.keys(M.PROP_TYPES).forEach(function (k) {
        var o = document.createElement("option");
        o.value = k;
        o.textContent = M.PROP_TYPES[k];
        if (def.type === k) o.selected = true;
        typeSel.appendChild(o);
      });
      field("種類", typeSel);
    }

    // 選択肢の編集
    var optsEditor = null;
    if (isField && id === "status") {
      optsEditor = optionListEditor(S.statuses());
      field("選択肢", optsEditor);
    } else if (isField && id === "priority") {
      optsEditor = optionListEditor(S.priorities().map(function (p) { return { key: p, label: p }; }));
      field("選択肢", optsEditor);
    } else if (isField && id === "channels") {
      optsEditor = optionListEditor(S.channels(), { withShort: true });
      field("選択肢（略称はガントのバー上に表示されます）", optsEditor);
    } else if (!isField) {
      var needsOpts = ["select", "multiselect", "status"];
      var optsWrap = el("div", "prop-opts-holder");
      var optsField = field("選択肢", optsWrap);
      function syncOpts() {
        optsWrap.innerHTML = "";
        if (needsOpts.indexOf(typeSel.value) < 0) {
          optsField.parentNode.hidden = true;
          optsEditor = null;
          return;
        }
        optsField.parentNode.hidden = false;
        optsEditor = optionListEditor(def.options.map(function (o) { return { key: o, label: o }; }));
        optsWrap.appendChild(optsEditor);
      }
      syncOpts();
      typeSel.addEventListener("change", syncOpts);
    }

    // 表示 / 非表示（組み込みのみ。削除の代わり）
    var hideChk = null;
    if (isField) {
      var hideWrap = el("label", "modal-check");
      hideChk = document.createElement("input");
      hideChk.type = "checkbox";
      hideChk.checked = S.fieldHidden(id);
      hideWrap.appendChild(hideChk);
      hideWrap.appendChild(document.createTextNode(" 詳細画面で非表示にする"));
      m.appendChild(hideWrap);
    }

    var foot = el("div", "modal-foot");
    if (!isField) {
      var del = el("button", "btn btn-danger", "削除");
      del.addEventListener("click", function () {
        if (!confirm("プロパティ「" + def.name + "」を削除しますか？\nすべての項目からこの値が消えます。")) return;
        S.deletePropDef(def.id);
        ONI.app.closeModal();
        reopen();
      });
      foot.appendChild(del);
    }
    foot.appendChild(el("span", "spacer"));

    var cancel = el("button", "btn btn-ghost", "キャンセル");
    cancel.addEventListener("click", function () { ONI.app.closeModal(); });
    foot.appendChild(cancel);

    var save = el("button", "btn btn-primary", "保存");
    save.addEventListener("click", function () {
      if (!name.value.trim()) { name.focus(); return; }

      if (isField) {
        S.setFieldLabel(id, name.value.trim());
        S.setFieldHidden(id, hideChk.checked);
        if (optsEditor) {
          var rows = optsEditor.collect();
          if (!rows.length && id !== "channels") { alert("選択肢は1つ以上必要です。"); return; }
          if (id === "status") S.setStatuses(rows.map(function (r) { return { key: r.key, label: r.label }; }));
          else if (id === "priority") {
            S.setPriorities(
              rows.map(function (r) { return r.label; }),
              rows.filter(function (r) { return r.original && r.original !== r.label; })
                .map(function (r) { return { from: r.original, to: r.label }; })
            );
          } else if (id === "channels") {
            S.setChannels(rows.map(function (r) { return { key: r.key, label: r.label, short: r.short }; }));
          }
        }
      } else {
        var patch = { name: name.value.trim(), type: typeSel.value };
        if (optsEditor) patch.options = optsEditor.collect().map(function (r) { return r.label; });
        S.updatePropDef(def.id, patch);
      }
      ONI.app.closeModal();
      reopen();
    });
    foot.appendChild(save);
    m.appendChild(foot);

    function reopen() {
      var cur = ONI.store.getItem(currentId);
      if (cur) render(cur);
    }

    setTimeout(function () { name.focus(); name.select(); }, 0);
  }

  /* ---------------------------------------- カスタムプロパティ（Notion風） */

  function savePropValue(defId, value) {
    var patch = { detail: { props: {} } };
    patch.detail.props[defId] = value;
    saveNow(patch);
  }

  /** 選択肢つきプロパティに新しい選択肢を足す小さなインライン入力 */
  function optionAdder(def, onAdded) {
    var wrap = el("span", "d-prop-optadd");
    var btn = el("button", "d-prop-optadd-btn", "＋");
    btn.title = "選択肢を追加";
    var input = document.createElement("input");
    input.type = "text";
    input.className = "d-prop-optadd-input";
    input.placeholder = "選択肢名";
    input.hidden = true;
    btn.addEventListener("click", function () {
      input.hidden = false;
      input.focus();
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { input.hidden = true; input.value = ""; return; }
      if (e.key !== "Enter" || e.isComposing || e.keyCode === 229) return;
      var v = input.value.trim();
      if (!v) return;
      var opts = ONI.store.getPropDef(def.id).options.slice();
      if (opts.indexOf(v) < 0) {
        opts.push(v);
        ONI.store.updatePropDef(def.id, { options: opts });
      }
      input.value = "";
      input.hidden = true;
      if (onAdded) onAdded(v);
      render(ONI.store.getItem(currentId)); // 追加した選択肢をすぐ反映する
    });
    wrap.appendChild(btn);
    wrap.appendChild(input);
    return wrap;
  }

  function propEditor(def, it) {
    var val = (it.detail.props || {})[def.id];
    var wrap = el("div", "d-prop-editor");

    if (def.type === "text") {
      wrap.appendChild(textInput(val || "", "テキスト", function (v) { savePropValue(def.id, v); }));

    } else if (def.type === "number") {
      var num = document.createElement("input");
      num.type = "number";
      num.value = (val === 0 || val) ? val : "";
      num.placeholder = "数字";
      num.addEventListener("input", function () {
        savePropValue(def.id, num.value === "" ? "" : Number(num.value));
      });
      wrap.appendChild(num);

    } else if (def.type === "url") {
      wrap.appendChild(textInput(val || "", "https://…", function (v) { savePropValue(def.id, v); }));
      if (val) {
        var a = el("a", "d-prop-urllink", "開く ↗");
        a.href = val;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        wrap.appendChild(a);
      }

    } else if (def.type === "daterange") {
      var v2 = val || {};
      var dates = el("div", "d-dates");
      var s = document.createElement("input");
      s.type = "date";
      s.value = v2.start || "";
      var e2 = document.createElement("input");
      e2.type = "date";
      e2.value = v2.end || "";
      function saveRange() {
        var end = e2.value && s.value && e2.value < s.value ? s.value : e2.value;
        if (end !== e2.value) e2.value = end;
        savePropValue(def.id, { start: s.value, end: end });
      }
      s.addEventListener("change", saveRange);
      e2.addEventListener("change", saveRange);
      dates.appendChild(s);
      dates.appendChild(el("span", null, "〜"));
      dates.appendChild(e2);
      wrap.appendChild(dates);

    } else if (def.type === "multiselect") {
      var cur = Array.isArray(val) ? val : [];
      var chips = el("div", "chips");
      def.options.forEach(function (o) {
        var on = cur.indexOf(o) >= 0;
        var b = el("button", "chip" + (on ? " is-on" : ""), o);
        b.addEventListener("click", function () {
          var now = ((ONI.store.getItem(currentId).detail.props || {})[def.id] || []).slice();
          var i = now.indexOf(o);
          if (i >= 0) now.splice(i, 1); else now.push(o);
          savePropValue(def.id, now);
        });
        chips.appendChild(b);
      });
      chips.appendChild(optionAdder(def));
      wrap.appendChild(chips);

    } else { // select / status
      var sel = document.createElement("select");
      var blank = document.createElement("option");
      blank.value = "";
      blank.textContent = "—";
      sel.appendChild(blank);
      def.options.forEach(function (o) {
        var opt = document.createElement("option");
        opt.value = o;
        opt.textContent = o;
        if (val === o) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.addEventListener("change", function () { savePropValue(def.id, sel.value); });
      wrap.appendChild(sel);
      wrap.appendChild(optionAdder(def, function (added) { savePropValue(def.id, added); }));
    }

    return wrap;
  }

  function addPropButton() {
    var wrap = el("div", "d-addprop");
    var btn = el("button", "d-addprop-btn", "＋ プロパティを追加");
    var form = el("div", "d-addprop-form");
    form.hidden = true;

    var name = document.createElement("input");
    name.type = "text";
    name.className = "input";
    name.placeholder = "プロパティ名";

    var type = document.createElement("select");
    type.className = "input";
    Object.keys(M.PROP_TYPES).forEach(function (t) {
      var o = document.createElement("option");
      o.value = t;
      o.textContent = M.PROP_TYPES[t];
      type.appendChild(o);
    });

    var add = el("button", "btn btn-primary", "追加");
    function submit() {
      if (!name.value.trim()) { name.focus(); return; }
      ONI.store.createPropDef({ name: name.value.trim(), type: type.value });
      render(ONI.store.getItem(currentId));
    }
    add.addEventListener("click", submit);
    name.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) submit();
    });

    btn.addEventListener("click", function () {
      form.hidden = !form.hidden;
      if (!form.hidden) name.focus();
    });

    form.appendChild(name);
    form.appendChild(type);
    form.appendChild(add);
    wrap.appendChild(btn);
    wrap.appendChild(form);
    return wrap;
  }

  /* この項目にぶら下がるタスクのチェックリスト。ここでの変更はタスク管理ページにも反映される。 */
  function renderTasks(body, it) {
    // 子タスク（parent_id あり）は親の下でのみ扱うため、ここでは出さない
    var list = ONI.store.tasksForItem(it.id).filter(function (t) { return !t.parent_id; });
    var doneN = list.filter(function (t) { return t.done; }).length;
    body.appendChild(el("div", "d-section-title",
      "タスク" + (list.length ? "（" + doneN + "/" + list.length + "）" : "")));

    var wrap = el("div", "d-tasks");
    list.forEach(function (t) { wrap.appendChild(taskRow(t)); });

    // 追加入力
    var add = el("div", "d-task-add");
    var input = document.createElement("input");
    input.type = "text";
    input.className = "d-task-input";
    input.placeholder = "＋ タスクを追加（Enterで確定）";
    input.addEventListener("keydown", function (e) {
      // IME変換確定のEnterを拾わない
      if (e.key !== "Enter" || e.isComposing || e.keyCode === 229 || !input.value.trim()) return;
      ONI.store.createTask({ item_id: it.id, title: input.value.trim() });
      input.value = "";
      render(ONI.store.getItem(currentId));
      // 追加欄にフォーカスを戻して連続入力できるように
      setTimeout(function () {
        var box = drawer.querySelector(".d-task-input");
        if (box) box.focus();
      }, 0);
    });
    add.appendChild(input);
    wrap.appendChild(add);

    body.appendChild(wrap);
  }

  function taskRow(t) {
    var rowEl = el("div", "d-task" + (t.done ? " is-done" : ""));

    var chk = document.createElement("input");
    chk.type = "checkbox";
    chk.checked = t.done;
    chk.addEventListener("change", function () { ONI.store.updateTask(t.id, { done: chk.checked }); });
    rowEl.appendChild(chk);

    var title = document.createElement("input");
    title.type = "text";
    title.className = "d-task-title";
    title.value = t.title;
    title.placeholder = "タスク名";
    var timer;
    function saveTitle() { clearTimeout(timer); timer = setTimeout(function () { ONI.store.updateTask(t.id, { title: title.value }); }, 350); }
    title.addEventListener("input", function (e) { if (!e.isComposing) saveTitle(); }); // IME変換中は保存しない
    title.addEventListener("compositionend", saveTitle);
    rowEl.appendChild(title);

    rowEl.appendChild(ONI.ui.memberSelect(t.owner, function (v) {
      ONI.store.updateTask(t.id, { owner: v });
    }, { placeholder: "担当なし" }));

    var due = document.createElement("input");
    due.type = "date";
    due.className = "d-task-due";
    due.value = t.due_date;
    due.title = "期限";
    due.addEventListener("change", function () { ONI.store.updateTask(t.id, { due_date: due.value }); });
    rowEl.appendChild(due);

    var del = el("button", "d-task-del", "×");
    del.title = "タスクを削除";
    del.addEventListener("click", function () {
      ONI.store.deleteTask(t.id);
      render(ONI.store.getItem(currentId));
    });
    rowEl.appendChild(del);

    return rowEl;
  }

  function init() {
    drawer = document.getElementById("drawer");
    overlay = document.getElementById("overlay");
    overlay.addEventListener("click", close);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !drawer.hidden) close();
    });
  }

  return { init: init, open: open, close: close, refresh: refresh,
    isOpen: function () { return !!currentId; } };
})();
