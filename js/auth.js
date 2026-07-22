/* auth.js — ワークスペース（ポータル）との認証統合版
 *
 * ログイン画面はこのアプリにはもう無い。ポータル（/login）で
 * メールアドレス＋パスワードのアカウントにログインすると、同じオリジンの
 * localStorage に Supabase セッションが保存され、このアプリはそれをそのまま使う。
 *
 * データを守っているのは Supabase 側の RLS（pm_workspace_users に
 * 登録されている人だけが読み書きできる）。役割（admin/editor/viewer）も
 * pm_workspace_users の行から読む。
 *
 * ローカル開発（python3 -m http.server 等）ではポータルが無いので、
 * 簡易ログインフォームを出す。
 */

var ONI = window.ONI || {};
window.ONI = ONI;

ONI.auth = (function () {
  "use strict";

  var sb = null;          // Supabase クライアント
  var session = null;     // ログインセッション
  var me = null;          // pm_workspace_users の自分の行（role を含む）

  var IS_LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)
    || location.protocol === "file:";

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
    if (/rate limit|too many/i.test(m)) return "試行が続いたため一時的に制限されています。少し時間をおいてください。";
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

  function renderDenied(email) {
    var box = card("アクセス権限がありません",
      email + " はワークスペースに登録されていません。管理者に招待を依頼してください。");
    var btn = el("button", "btn btn-ghost auth-btn", "別のアカウントでログイン");
    btn.addEventListener("click", function () {
      client().auth.signOut().then(function () { toPortalLogin(); });
    });
    box.appendChild(btn);
  }

  function renderLoading(text) {
    card(text || "読み込み中…");
  }

  /** ポータルのログイン画面へ移動する */
  function toPortalLogin() {
    if (IS_LOCAL) { renderLocalForm(); return; }
    location.href = "/login";
  }

  /* ローカル開発専用の簡易ログイン（本番ではポータルの /login を使う） */
  function renderLocalForm(message) {
    var box = card("ローカル開発ログイン",
      "本番ではポータル（/login）からログインします");
    var form = el("div", "auth-form");

    var email = document.createElement("input");
    email.type = "email";
    email.className = "input";
    email.placeholder = "you@" + ONI.config.allowedDomain;
    email.autocomplete = "username";

    var pass = document.createElement("input");
    pass.type = "password";
    pass.className = "input";
    pass.placeholder = "パスワード";
    pass.autocomplete = "current-password";

    var btn = el("button", "btn btn-primary auth-btn", "ログイン");
    var note = el("p", "auth-note", message || "");
    if (message) note.className = "auth-note is-error";

    function submit() {
      if (!email.value.trim()) { email.focus(); return; }
      if (!pass.value) { pass.focus(); return; }
      btn.disabled = true;
      btn.textContent = "確認中…";
      client().auth.signInWithPassword({
        email: email.value.trim(),
        password: pass.value
      }).then(function (res) {
        if (res.error) {
          note.textContent = jpError(res.error.message);
          note.className = "auth-note is-error";
          btn.disabled = false;
          btn.textContent = "ログイン";
          return;
        }
        window.location.reload();
      });
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
    setTimeout(function () { email.focus(); }, 0);
  }

  /* -------------------------------------------------------- セッション */

  /**
   * ログイン済みなら pm_workspace_users から自分の行を取る。
   * 招待直後などで user_id が未設定のことがあるため、メールアドレスでも照合する。
   */
  function loadMe() {
    var c = client();
    return c.from("pm_workspace_users")
      .select("id, email, role, user_id")
      .eq("user_id", session.user.id)
      .maybeSingle()
      .then(function (res) {
        if (res.data) return res.data;
        return c.from("pm_workspace_users")
          .select("id, email, role, user_id")
          .ilike("email", session.user.email)
          .maybeSingle()
          .then(function (r2) { return r2.data || null; });
      })
      .then(function (row) {
        me = row;
        return me;
      });
  }

  function start(onReady) {
    if (!window.supabase) {
      card("接続できません", "Supabase のライブラリを読み込めませんでした。ネットワーク環境を確認してください。");
      return;
    }
    renderLoading("確認中…");

    client().auth.getSession().then(function (res) {
      session = res.data.session;
      if (!session) { toPortalLogin(); return; }

      loadMe().then(function (row) {
        if (!row) { renderDenied(session.user.email); return; }
        // 最終ログイン時刻を記録（RPC。失敗しても利用には影響しない）
        client().rpc("pm_touch_last_seen").then(function () {}, function () {});
        showApp();
        onReady(client(), session, me);
      });
    });

    client().auth.onAuthStateChange(function (event) {
      if (event === "SIGNED_OUT" && !signingOut) toPortalLogin();
    });
  }

  var signingOut = false;
  function signOut() {
    signingOut = true;
    client().auth.signOut().then(function () {
      // ポータルのセッションCookieも破棄する
      if (IS_LOCAL) { window.location.reload(); return; }
      location.href = "/api/logout";
    });
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
