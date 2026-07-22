/* auth.js — ログインとワークスペースの入口
 *
 * パスワードは扱わず、メールに届くリンクでログインする（マジックリンク）。
 * ログインしただけでは中身は見えない。Supabase 側の pm_workspace_users に
 * 登録されている人だけが RLS を通過してデータを読める。
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

  function renderLogin(message) {
    var box = card("プロジェクト管理", "会社のメールアドレスにログイン用リンクを送ります");

    var form = el("div", "auth-form");
    var input = document.createElement("input");
    input.type = "email";
    input.className = "input";
    input.placeholder = "you@" + ONI.config.allowedDomain;
    input.autocomplete = "email";

    var btn = el("button", "btn btn-primary auth-btn", "ログインリンクを送る");
    var note = el("p", "auth-note", message || "");

    function submit() {
      var email = input.value.trim();
      if (!email) { input.focus(); return; }
      btn.disabled = true;
      btn.textContent = "送信中…";
      client().auth.signInWithOtp({
        email: email,
        options: { emailRedirectTo: window.location.origin + window.location.pathname }
      }).then(function (res) {
        if (res.error) {
          note.textContent = "送信できませんでした: " + res.error.message;
          note.className = "auth-note is-error";
          btn.disabled = false;
          btn.textContent = "ログインリンクを送る";
          return;
        }
        box.innerHTML = "";
        box.appendChild(el("h1", "auth-title", "メールを確認してください"));
        box.appendChild(el("p", "auth-sub",
          email + " にログイン用のリンクを送りました。メール内のリンクを開くとこの画面に戻ります。"));
      });
    }

    btn.addEventListener("click", submit);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) submit();
    });

    form.appendChild(input);
    form.appendChild(btn);
    box.appendChild(form);
    box.appendChild(note);
    setTimeout(function () { input.focus(); }, 0);
  }

  function renderDenied(email) {
    var box = card("アクセス権限がありません",
      email + " はこのワークスペースに登録されていません。管理者に招待を依頼してください。");
    var btn = el("button", "btn btn-ghost auth-btn", "別のアカウントでログイン");
    btn.addEventListener("click", function () {
      client().auth.signOut().then(function () { renderLogin(); });
    });
    box.appendChild(btn);
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

    client().auth.getSession().then(function (res) {
      session = res.data.session;
      if (!session) { renderLogin(); return; }

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

    client().auth.onAuthStateChange(function (event, s) {
      // メールのリンクから戻ってきたときはそのまま読み込み直す
      if (event === "SIGNED_IN" && (!session || session.user.id !== s.user.id)) {
        window.location.reload();
      }
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
