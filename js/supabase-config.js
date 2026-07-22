/* supabase-config.js — 接続先の設定
 *
 * publishable key はブラウザに置いて良い種類のキー。
 * データを守っているのは Supabase 側の RLS（pm_workspace_users に
 * 登録された人だけが読み書きできる）なので、このキーが漏れても
 * ログインしていない人はデータを取得できない。
 */

var ONI = window.ONI || {};
window.ONI = ONI;

ONI.config = {
  supabaseUrl: "https://abweoowonthzpuoselix.supabase.co",
  supabaseKey: "sb_publishable_dTYBXxH8PfjpaIU8vVhJ3w_uLig6-S3",

  // このドメインのアカウントは初回ログイン時に自動でワークスペースに参加する
  // （それ以外は管理者があらかじめ招待したメールのみ）
  allowedDomain: "oni-co.jp"
};
