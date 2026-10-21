/**
 * スクリプト共通：.env の読み込みと kintone REST API の呼び出し
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.loadEnvFile(path.join(ROOT, '.env'));

const env = (key) => {
  const value = process.env[key];
  if (!value) throw new Error(`.env の ${key} が空です`);
  return value;
};

const baseUrl = env('KINTONE_BASE_URL').replace(/\/$/, '');

/** アプリごとの接続情報 */
export const APPS = {
  quote: { id: Number(env('QUOTE_APP_ID')), token: env('QUOTE_API_TOKEN') },
  invoice: { id: Number(env('INVOICE_APP_ID')), token: env('INVOICE_API_TOKEN') },
};

/**
 * kintone REST API を呼ぶ
 * @param {{id:number, token:string}} app 対象アプリ
 */
export const api = async (app, apiPath, method = 'GET', body) => {
  let url = `${baseUrl}${apiPath}`;
  const headers = { 'X-Cybozu-API-Token': app.token };
  const init = { method, headers };
  if (method === 'GET') {
    // GET はパラメーターを URL に付ける（配列は fields[0]=... の形）
    const params = new URLSearchParams();
    Object.entries(body || {}).forEach(([k, v]) => {
      if (Array.isArray(v)) v.forEach((item, i) => params.append(`${k}[${i}]`, item));
      else params.append(k, String(v));
    });
    url += `?${params}`;
  } else {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const json = await res.json();
  if (!res.ok) {
    const detail = json.errors ? ` ${JSON.stringify(json.errors)}` : '';
    throw new Error(`${method} ${apiPath} 失敗（${res.status}）: ${json.message}${detail}`);
  }
  return json;
};

/** 動作テスト環境の設定を本番に反映し、完了するまで待つ */
export const deploy = async (app) => {
  await api(app, '/k/v1/preview/app/deploy.json', 'POST', { apps: [{ app: app.id }] });
  for (let i = 0; i < 60; i += 1) {
    await new Promise((r) => { setTimeout(r, 1000); });
    const { apps } = await api(app, '/k/v1/preview/app/deploy.json', 'GET', { apps: [app.id] });
    if (apps[0].status === 'SUCCESS') return;
    if (apps[0].status === 'FAIL' || apps[0].status === 'CANCEL') throw new Error(`アプリ ${app.id} の更新に失敗しました`);
  }
  throw new Error(`アプリ ${app.id} の更新が終わりません`);
};
