/**
 * 見積管理・請求管理アプリを組み立てるスクリプト
 *
 * schema.mjs の定義どおりに、フィールド・フォームの配置・一覧を作って、アプリを更新します。
 * 何度実行しても大丈夫です（すでにあるフィールドは追加しません）。
 *
 * 使い方: node scripts/setup.mjs
 */
import { APPS, api, deploy } from './kintone.mjs';
import { QUOTE, INVOICE } from './schema.mjs';

const setupApp = async (app, schema) => {
  console.log(`■ ${schema.name}（アプリID ${app.id}）`);

  // 1. まだないフィールドだけ追加する
  const { properties } = await api(app, '/k/v1/preview/app/form/fields.json', 'GET', { app: app.id });
  const missing = Object.fromEntries(Object.entries(schema.fields).filter(([code]) => !properties[code]));
  if (Object.keys(missing).length > 0) {
    await api(app, '/k/v1/preview/app/form/fields.json', 'POST', { app: app.id, properties: missing });
  }
  console.log(`  フィールド追加: ${Object.keys(missing).join(', ') || 'なし'}`);

  // 2. フォームの配置
  await api(app, '/k/v1/preview/app/form/layout.json', 'PUT', { app: app.id, layout: schema.layout });
  console.log('  フォームの配置: 完了');

  // 3. 一覧
  await api(app, '/k/v1/preview/app/views.json', 'PUT', { app: app.id, views: schema.views });
  console.log(`  一覧: ${Object.keys(schema.views).join(', ')}`);

  // 4. アプリを更新
  await deploy(app);
  console.log('  アプリを更新: 完了');
};

try {
  await setupApp(APPS.quote, QUOTE);
  await setupApp(APPS.invoice, INVOICE);
  console.log(`\n次の値を js/common.js の APP_ID に設定してください: QUOTE: ${APPS.quote.id}, INVOICE: ${APPS.invoice.id}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
