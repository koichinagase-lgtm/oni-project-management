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

  /** 担当者のアバター（頭文字を色付きの丸で） */
  function memberAvatar(member) {
    var av = document.createElement("i");
    av.className = "member-av";
    if (member) {
      av.style.background = member.color;
      av.textContent = M.memberInitial(member.name);
    } else {
      av.classList.add("is-empty");
      av.textContent = "?";
    }
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
      var avs = document.createElement("span");
      avs.className = "member-chip-avs";
      ids.slice(0, 3).forEach(function (id) {
        avs.appendChild(memberAvatar(ONI.store.getMember(id)));
      });
      chip.appendChild(avs);
      chip.appendChild(Object.assign(document.createElement("span"), {
        className: "member-chip-name",
        textContent: ids.length <= 2
          ? ONI.store.memberNames(ids)
          : ONI.store.memberName(ids[0]) + " 他" + (ids.length - 1) + "人"
      }));
    }

    attachPopover(chip, "member-pop", function (pop) {
      var all = ONI.store.members();
      if (!all.length) {
        pop.appendChild(Object.assign(document.createElement("div"),
          { className: "member-pop-empty", textContent: "「担当者」タブで先に登録してください" }));
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
            { className: "member-pop-name", textContent: m.name }));
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

  return {
    swatchGrid: swatchGrid,
    colorButton: colorButton,
    attachPopover: attachPopover,
    closePop: closePop,
    memberAvatar: memberAvatar,
    memberSelect: memberSelect
  };
})();
