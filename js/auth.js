/* auth.js — ログインとワークスペースの入口
 *
 * メールアドレスとパスワードでログインする。
 * ログインしただけでは中身は見えない。Supabase 側の pm_workspace_users に
 * 登録されている人だけが RLS を通過してデータを読める。
 * （@oni-co.jp は初回登録時に自動で参加。それ以外は管理者の招待制）
 */

var ONI = window.ONI || {};
window.ONI = ONI;

ONI.auth = (function () {
  "use strict";

  var sb = null;          // Supabase クライアント
  var session = null;     // ログインセッション
  var me = null;          // pm_workspace_users の自分の行（role を含む）

  function client() {
    if (!sb) {
      sb = window.supabase.createClient(
        ONI.config.supabaseUrl,
        ONI.config.supabaseKey,
        { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
      );
    }
    return sb;
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /** Supabase から返る英語のエラーを、日本語の案内に置き換える */
  function jpError(message) {
    var m = String(message || "");
    if (/Invalid login credentials/i.test(m)) return "メールアドレスかパスワードが違います。";
    if (/Email not confirmed/i.test(m)) return "メールの確認がまだです。届いている確認メールのリンクを開いてください。";
    if (/User already registered/i.test(m)) return "このメールアドレスは登録済みです。「ログイン」からお入りください。";
    if (/Password should be at least/i.test(m)) return "パスワードは6文字以上にしてください。";
    if (/rate limit|too many/i.test(m)) return "試行が続いたため一時的に制限されています。少し時間をおいてください。";
    if (/Unable to validate email/i.test(m)) return "メールアドレスの形式を確認してください。";
    return m;
  }

  /* ------------------------------------------------------------ 画面 */

  function screen() {
    var s = document.getElementById("auth-screen");
    s.hidden = false;
    document.getElementById("app-root").hidden = true;
    s.innerHTML = "";
    return s;
  }

  function showApp() {
    document.getElementById("auth-screen").hidden = true;
    document.getElementById("app-root").hidden = false;
  }

  function card(title, sub) {
    var s = screen();
    var box = el("div", "auth-card");
    var logo = document.createElement("img");
    logo.src = "logo/onico-icon-black.png";
    logo.alt = "";
    logo.className = "auth-logo";
    box.appendChild(logo);
    box.appendChild(el("div", "auth-brand", "ONI & Co."));
    box.appendChild(el("h1", "auth-title", title));
    if (sub) box.appendChild(el("p", "auth-sub", sub));
    s.appendChild(box);
    return box;
  }

  /**
   * ログイン／新規登録のフォーム。
   * @param {"signin"|"signup"} mode
   */
  function renderForm(mode, message) {
    var signup = mode === "signup";
    var box = card(
      signup ? "アカウントを作成" : "プロジェクト管理",
      signup
        ? "会社のメールアドレスとパスワードを設定してください"
        : "メールアドレスとパスワードでログインします"
    );

    var form = el("div", "auth-form");

    var email = document.createElement("input");
    email.type = "email";
    email.className = "input";
    email.placeholder = "you@" + ONI.config.allowedDomain;
    email.autocomplete = "username";

    var pass = document.createElement("input");
    pass.type = "password";
    pass.className = "input";
    pass.placeholder = signup ? "パスワード（6文字以上）" : "パスワード";
    pass.autocomplete = signup ? "new-password" : "current-password";

    var btn = el("button", "btn btn-primary auth-btn", signup ? "アカウントを作成" : "ログイン");
    var note = el("p", "auth-note", message || "");
    if (message) note.className = "auth-note is-error";

    function busy(on, label) {
      btn.disabled = on;
      btn.textContent = on ? label : (signup ? "アカウントを作成" : "ログイン");
    }

    function fail(msg) {
      note.textContent = jpError(msg);
      note.className = "auth-note is-error";
      busy(false);
    }

    function submit() {
      var e = email.value.trim();
      var p = pass.value;
      if (!e) { email.focus(); return; }
      if (!p) { pass.focus(); return; }
      note.textContent = "";
      note.className = "auth-note";

      if (signup) {
        busy(true, "作成中…");
        client().auth.signUp({
          email: e,
          password: p,
          options: { emailRedirectTo: window.location.origin + window.location.pathname }
        }).then(function (res) {
          if (res.error) { fail(res.error.message); return; }
          if (res.data.session) {
            window.location.reload();   // 確認不要の設定ならそのまま入れる
          } else {
            box.innerHTML = "";
            box.appendChild(el("h1", "auth-title", "確認メールを送りました"));
            box.appendChild(el("p", "auth-sub",
              e + " に確認メールを送りました。リンクを開くとログインできるようになります。"));
          }
        });
      } else {
        busy(true, "確認中…");
        client().auth.signInWithPassword({ email: e, password: p }).then(function (res) {
          if (res.error) { fail(res.error.message); return; }
          window.location.reload();
        });
      }
    }

    btn.addEventListener("click", submit);
    function onKey(ev) {
      if (ev.key === "Enter" && !ev.isComposing && ev.keyCode !== 229) submit();
    }
    email.addEventListener("keydown", onKey);
    pass.addEventListener("keydown", onKey);

    form.appendChild(email);
    form.appendChild(pass);
    form.appendChild(btn);
    box.appendChild(form);
    box.appendChild(note);

    /* 下部の切り替えリンク */
    var links = el("div", "auth-links");
    var toggle = el("button", "auth-link",
      signup ? "すでにアカウントをお持ちの方はログイン" : "はじめての方はアカウントを作成");
    toggle.addEventListener("click", function () {
      renderForm(signup ? "signin" : "signup");
    });
    links.appendChild(toggle);

    if (!signup) {
      var forgot = el("button", "auth-link", "パスワードを忘れた場合");
      forgot.addEventListener("click", function () {
        var e = email.value.trim();
        if (!e) { note.textContent = "先にメールアドレスを入力してください。";
          note.className = "auth-note is-error"; email.focus(); return; }
        client().auth.resetPasswordForEmail(e, {
          redirectTo: window.location.origin + window.location.pathname
        }).then(function (res) {
          if (res.error) { fail(res.error.message); return; }
          note.textContent = e + " に再設定用のメールを送りました。";
          note.className = "auth-note";
        });
      });
      links.appendChild(forgot);
    }
    box.appendChild(links);

    setTimeout(function () { email.focus(); }, 0);
  }

  function renderDenied(email) {
    var box = card("アクセス権限がありません",
      email + " はこのワークスペースに登録されていません。管理者に招待を依頼してください。");
    var btn = el("button", "btn btn-ghost auth-btn", "別のアカウントでログイン");
    btn.addEventListener("click", function () {
      client().auth.signOut().then(function () { renderForm("signin"); });
    });
    box.appendChild(btn);
  }

  /* パスワード再設定メールから戻ってきたときの、新しいパスワード入力画面 */
  function renderNewPassword() {
    var box = card("新しいパスワードを設定", "6文字以上で設定してください");
    var form = el("div", "auth-form");
    var pass = document.createElement("input");
    pass.type = "password";
    pass.className = "input";
    pass.placeholder = "新しいパスワード";
    pass.autocomplete = "new-password";
    var btn = el("button", "btn btn-primary auth-btn", "設定する");
    var note = el("p", "auth-note", "");

    btn.addEventListener("click", function () {
      if (!pass.value) { pass.focus(); return; }
      btn.disabled = true;
      btn.textContent = "設定中…";
      client().auth.updateUser({ password: pass.value }).then(function (res) {
        if (res.error) {
          note.textContent = jpError(res.error.message);
          note.className = "auth-note is-error";
          btn.disabled = false;
          btn.textContent = "設定する";
          return;
        }
        window.location.href = window.location.origin + window.location.pathname;
      });
    });
    pass.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) btn.click();
    });

    form.appendChild(pass);
    form.appendChild(btn);
    box.appendChild(form);
    box.appendChild(note);
    setTimeout(function () { pass.focus(); }, 0);
  }

  function renderLoading(text) {
    card(text || "読み込み中…");
  }

  /* -------------------------------------------------------- セッション */

  /** ログイン済みなら pm_workspace_users から自分の行を取る */
  function loadMe() {
    return client()
      .from("pm_workspace_users")
      .select("id, email, role")
      .eq("user_id", session.user.id)
      .maybeSingle()
      .then(function (res) {
        me = res.data || null;
        return me;
      });
  }

  function start(onReady) {
    if (!window.supabase) {
      card("接続できません", "Supabase のライブラリを読み込めませんでした。ネットワーク環境を確認してください。");
      return;
    }
    renderLoading("確認中…");

    // パスワード再設定のリンクから来た場合はパスワード入力画面へ
    var isRecovery = /type=recovery/.test(window.location.hash || "");

    client().auth.getSession().then(function (res) {
      session = res.data.session;
      if (isRecovery && session) { renderNewPassword(); return; }
      if (!session) { renderForm("signin"); return; }

      loadMe().then(function (row) {
        if (!row) { renderDenied(session.user.email); return; }
        // 最終ログイン時刻を控えておく（失敗しても利用には影響しない）
        client().from("pm_workspace_users")
          .update({ last_seen_at: new Date().toISOString() })
          .eq("id", row.id).then(function () {}, function () {});
        showApp();
        onReady(client(), session, me);
      });
    });

    client().auth.onAuthStateChange(function (event) {
      if (event === "SIGNED_OUT") window.location.reload();
    });
  }

  function signOut() {
    client().auth.signOut().then(function () { window.location.reload(); });
  }

  return {
    start: start,
    signOut: signOut,
    client: client,
    user: function () { return session ? session.user : null; },
    me: function () { return me; },
    canEdit: function () { return !!me && (me.role === "admin" || me.role === "editor"); },
    isAdmin: function () { return !!me && me.role === "admin"; }
  };
})();
