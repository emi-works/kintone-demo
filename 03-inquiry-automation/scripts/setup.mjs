/**
 * 問い合わせ管理アプリを組み立てるスクリプト
 *
 * schema.mjs の定義どおりに、フィールド・フォームの配置・一覧を作って、アプリを更新します。
 * 何度実行しても大丈夫です（すでにあるフィールドは追加しません）。
 *
 * 使い方: node scripts/setup.mjs
 */
import { APPS, api, deploy } from './kintone.mjs';
import { INQUIRY } from './schema.mjs';

const app = APPS.inquiry;

try {
  console.log(`■ ${INQUIRY.name}（アプリID ${app.id}）`);

  const { properties } = await api(app, '/k/v1/preview/app/form/fields.json', 'GET', { app: app.id });
  const missing = Object.fromEntries(Object.entries(INQUIRY.fields).filter(([code]) => !properties[code]));
  if (Object.keys(missing).length > 0) {
    await api(app, '/k/v1/preview/app/form/fields.json', 'POST', { app: app.id, properties: missing });
  }
  console.log(`  フィールド追加: ${Object.keys(missing).join(', ') || 'なし'}`);

  await api(app, '/k/v1/preview/app/form/layout.json', 'PUT', { app: app.id, layout: INQUIRY.layout });
  console.log('  フォームの配置: 完了');

  await api(app, '/k/v1/preview/app/views.json', 'PUT', { app: app.id, views: INQUIRY.views });
  console.log(`  一覧: ${Object.keys(INQUIRY.views).join(', ')}`);

  await api(app, '/k/v1/preview/app/settings.json', 'PUT', {
    app: app.id,
    titleField: { selectionMode: 'MANUAL', code: INQUIRY.titleField },
  });
  console.log(`  レコードのタイトル: ${INQUIRY.titleField}`);

  await deploy(app);
  console.log('  アプリを更新: 完了');
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
