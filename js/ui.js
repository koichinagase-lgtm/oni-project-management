/* ui.js — 画面をまたいで使う小さな部品
 * いまのところ12色パレットのカラーピッカーのみ。 */

var ONI = window.ONI || {};
window.ONI = ONI;

ONI.ui = (function () {
  "use strict";

  var M = ONI.model;

  function sameColor(a, b) {
    return String(a || "").toLowerCase() === String(b || "").toLowerCase();
  }

  /**
   * 12色のスウォッチ一覧。
   * @param {string} value 現在の色（選択中に印を付ける）
   * @param {function(string)} onPick 色を選んだとき
   */
  function swatchGrid(value, onPick) {
    var grid = document.createElement("div");
    grid.className = "color-grid";
    M.COLOR_PALETTE.forEach(function (c) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "color-sw" + (sameColor(c.hex, value) ? " is-on" : "");
      b.style.background = c.hex;
      b.title = c.name;
      b.setAttribute("aria-label", c.name);
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        onPick(c.hex);
      });
      grid.appendChild(b);
    });
    return grid;
  }

  /* 開いているポップオーバーは常に1つだけにする */
  var openPop = null;
  var openOwner = null; // ポップオーバーを開いたトリガー要素
  function closePop() {
    if (!openPop) return;
    openPop.remove();
    openPop = null;
    openOwner = null;
    document.removeEventListener("click", onDocClick, true);
    document.removeEventListener("keydown", onKey, true);
  }
  function onDocClick(e) {
    if (!openPop) return;
    if (openPop.contains(e.target)) return;
    // トリガー自身のクリックは閉じない（トリガー側でトグルを処理するため）
    if (openOwner && (openOwner === e.target || openOwner.contains(e.target))) return;
    closePop();
  }
  function onKey(e) {
    if (e.key === "Escape") closePop();
  }

  /**
   * トリガー要素にポップオーバーを紐付ける。
   * スクロール領域に切られないよう body 直下へ固定配置する。
   * @param {HTMLElement} btn トリガー
   * @param {string} className ポップオーバーのクラス
   * @param {function(HTMLElement, function)} build 中身を組み立てる（第2引数は閉じる関数）
   */
  function attachPopover(btn, className, build) {
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      e.preventDefault();
      // 同じトリガーをもう一度押したら閉じる
      if (openOwner === btn) { closePop(); return; }
      closePop();

      var pop = document.createElement("div");
      pop.className = className;
      build(pop, closePop);

      document.body.appendChild(pop);
      var r = btn.getBoundingClientRect();
      var pw = pop.offsetWidth, ph = pop.offsetHeight;
      var left = Math.min(Math.max(8, r.left), window.innerWidth - pw - 8);
      var top = r.bottom + 6;
      if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 6);
      pop.style.left = left + "px";
      pop.style.top = top + "px";

      openPop = pop;
      openOwner = btn;
      // 直後の同じクリックで閉じないよう、次のティックから監視する
      setTimeout(function () {
        document.addEventListener("click", onDocClick, true);
        document.addEventListener("keydown", onKey, true);
      }, 0);
    });
  }

  /**
   * 色スウォッチのボタン。押すと12色のポップオーバーが開く。
   * @param {string} value 現在の色
   * @param {function(string)} onPick 色を選んだとき
   * @param {{title?:string, extra?:{label:string, onClick:function}}} opts
   */
  function colorButton(value, onPick, opts) {
    opts = opts || {};
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "color-trigger";
    btn.style.background = value;
    btn.title = opts.title || "色を選ぶ";

    attachPopover(btn, "color-pop", function (pop, close) {
      pop.appendChild(swatchGrid(value, function (hex) {
        onPick(hex);
        close();
      }));
      if (opts.extra) {
        var ex = document.createElement("button");
        ex.type = "button";
        ex.className = "color-pop-extra";
        ex.textContent = opts.extra.label;
        ex.addEventListener("click", function (ev) {
          ev.stopPropagation();
          opts.extra.onClick();
          close();
        });
        pop.appendChild(ex);
      }
    });

    return btn;
  }

  /**
   * 担当者のアバター。
   * アカウントが紐付いていて本人がマイページでアイコン画像を設定していればそれを表示し、
   * 無ければ表示名の頭文字を色付きの丸で表示する。
   */
  function memberAvatar(member) {
    var av = document.createElement("i");
    av.className = "member-av";
    if (!member) {
      av.classList.add("is-empty");
      av.textContent = "?";
      return av;
    }
    var url = ONI.store.memberAvatarUrl(member.id);
    if (url) {
      av.classList.add("has-img");
      var img = document.createElement("img");
      img.src = url;
      img.alt = "";
      av.appendChild(img);
      return av;
    }
    av.style.background = member.color;
    av.textContent = M.memberInitial(ONI.store.memberName(member.id) || member.name);
    return av;
  }

  /**
   * 担当者を選ぶチップ。複数人を割り当てられる。
   * 押すと担当者一覧のポップオーバーが開き、名前をクリックするたびに選択が切り替わる。
   * ガント詳細・タスク行・アイデアメモで共通に使う。
   * @param {string[]} values 現在の担当者IDの配列
   * @param {function(string[])} onChange 変更時に新しい配列を渡す
   * @param {{placeholder?:string}} opts
   */
  function memberSelect(values, onChange, opts) {
    opts = opts || {};
    var ids = M.memberList(values).filter(function (id) { return ONI.store.getMember(id); });

    var chip = document.createElement("button");
    chip.type = "button";
    chip.className = "member-chip" + (ids.length ? "" : " is-empty");
    chip.title = ids.length
      ? "担当者: " + ONI.store.memberNames(ids)
      : "担当者を割り当てる";

    if (!ids.length) {
      chip.appendChild(memberAvatar(null));
      chip.appendChild(Object.assign(document.createElement("span"), {
        className: "member-chip-name",
        textContent: opts.placeholder || "担当者なし"
      }));
    } else {
      // 担当者ごとに「アイコン＋名前」をひとまとまりにして並べる
      var list = document.createElement("span");
      list.className = "member-chip-list";
      var shown = ids.slice(0, 3);
      shown.forEach(function (id) {
        var one = document.createElement("span");
        one.className = "member-chip-one";
        one.appendChild(memberAvatar(ONI.store.getMember(id)));
        one.appendChild(Object.assign(document.createElement("span"),
          { className: "member-chip-name", textContent: ONI.store.memberName(id) }));
        list.appendChild(one);
      });
      if (ids.length > shown.length) {
        list.appendChild(Object.assign(document.createElement("span"),
          { className: "member-chip-more", textContent: "他" + (ids.length - shown.length) + "人" }));
      }
      chip.appendChild(list);
    }

    attachPopover(chip, "member-pop", function (pop) {
      var all = ONI.store.members();
      if (!all.length) {
        pop.appendChild(Object.assign(document.createElement("div"),
          { className: "member-pop-empty", textContent: "担当者はアカウント管理（管理者）で登録します" }));
        return;
      }
      var list = document.createElement("div");
      list.className = "member-pop-list";
      var footer = document.createElement("div");

      // ポップオーバーは開いたままにして、続けて複数人を選べるようにする。
      // 選ぶたびにこの中身を描き直してチェック状態を合わせる。
      function draw() {
        list.innerHTML = "";
        all.forEach(function (m) {
          var on = ids.indexOf(m.id) >= 0;
          var row = document.createElement("button");
          row.type = "button";
          row.className = "member-pop-row" + (on ? " is-on" : "");
          row.appendChild(memberAvatar(m));
          row.appendChild(Object.assign(document.createElement("span"),
            { className: "member-pop-name", textContent: ONI.store.memberName(m.id) || m.name }));
          row.appendChild(Object.assign(document.createElement("span"),
            { className: "member-pop-check", textContent: on ? "✓" : "" }));
          row.addEventListener("click", function (e) {
            e.stopPropagation();
            ids = on ? ids.filter(function (x) { return x !== m.id; }) : ids.concat([m.id]);
            onChange(ids.slice());
            draw();
          });
          list.appendChild(row);
        });

        footer.innerHTML = "";
        if (ids.length) {
          var clear = document.createElement("button");
          clear.type = "button";
          clear.className = "member-pop-clear";
          clear.textContent = "全員を外す";
          clear.addEventListener("click", function (e) {
            e.stopPropagation();
            ids = [];
            onChange([]);
            draw();
          });
          footer.appendChild(clear);
        }
      }

      draw();
      pop.appendChild(list);
      pop.appendChild(footer);
    });

    return chip;
  }

  /* ------------------------------------------------- @メンションの候補リスト
   * テキスト入力欄で「@」に続けて文字を打つと担当者の候補が出る。
   * 選ぶと「@表示名 」が挿入され、保存されると相手に通知が届く。 */

  function attachMention(el) {
    var pop = null, matches = [], idx = 0, range = null;

    function close() {
      if (!pop) return;
      pop.remove();
      pop = null;
      matches = [];
      range = null;
    }

    /** キャレット直前の「@検索文字」を拾う（空白を挟んでいたら対象外） */
    function currentQuery() {
      var pos = el.selectionStart;
      if (pos == null) return null;
      var m = /@([^\s@]{0,24})$/.exec(el.value.slice(0, pos));
      if (!m) return null;
      return { q: m[1], start: pos - m[0].length, end: pos };
    }

    function nameOf(m) { return ONI.store.memberName(m.id) || m.name; }

    function insert(member) {
      if (!range) return;
      var name = nameOf(member);
      var v = el.value;
      el.value = v.slice(0, range.start) + "@" + name + " " + v.slice(range.end);
      var caret = range.start + name.length + 2;
      close();
      el.focus();
      try { el.setSelectionRange(caret, caret); } catch (e) { /* 対応外の入力欄 */ }
      // 保存処理（input を購読している）に変更を伝える
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }

    function draw() {
      if (!pop) {
        pop = document.createElement("div");
        pop.className = "member-pop mention-pop";
        document.body.appendChild(pop);
      }
      pop.innerHTML = "";
      var list = document.createElement("div");
      list.className = "member-pop-list";
      matches.forEach(function (m, i) {
        var row = document.createElement("button");
        row.type = "button";
        row.className = "member-pop-row" + (i === idx ? " is-on" : "");
        row.appendChild(memberAvatar(m));
        row.appendChild(Object.assign(document.createElement("span"),
          { className: "member-pop-name", textContent: nameOf(m) }));
        // mousedown で挿入する（blur より先に処理するため）
        row.addEventListener("mousedown", function (e) {
          e.preventDefault();
          insert(m);
        });
        list.appendChild(row);
      });
      pop.appendChild(list);

      var r = el.getBoundingClientRect();
      var ph = pop.offsetHeight;
      var top = r.bottom + 4;
      if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 4);
      pop.style.left = Math.min(r.left, window.innerWidth - pop.offsetWidth - 8) + "px";
      pop.style.top = top + "px";
    }

    function update() {
      var cur = currentQuery();
      if (!cur) { close(); return; }
      var q = cur.q.toLowerCase();
      matches = ONI.store.members().filter(function (m) {
        return !q || nameOf(m).toLowerCase().indexOf(q) >= 0;
      });
      if (!matches.length) { close(); return; }
      range = cur;
      idx = 0;
      draw();
    }

    el.addEventListener("input", update);
    el.addEventListener("click", update);
    el.addEventListener("keyup", function (e) {
      // 矢印キーでの移動はキャレット位置だけ見直す（選択中の候補は動かさない）
      if (["ArrowLeft", "ArrowRight", "Home", "End"].indexOf(e.key) >= 0) update();
    });
    el.addEventListener("keydown", function (e) {
      if (!pop) return;
      if (e.key === "Escape") { e.preventDefault(); close(); return; }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        idx = (idx + 1) % matches.length;
        draw();
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        idx = (idx - 1 + matches.length) % matches.length;
        draw();
        return;
      }
      // IME変換中の Enter は変換確定なので拾わない
      if ((e.key === "Enter" || e.key === "Tab") && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        insert(matches[idx]);
      }
    });
    el.addEventListener("blur", function () { setTimeout(close, 120); });
    return el;
  }

  return {
    attachMention: attachMention,
    swatchGrid: swatchGrid,
    colorButton: colorButton,
    attachPopover: attachPopover,
    closePop: closePop,
    memberAvatar: memberAvatar,
    memberSelect: memberSelect
  };
})();
