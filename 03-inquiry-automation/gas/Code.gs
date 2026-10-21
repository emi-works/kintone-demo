/**
 * 問い合わせの自動登録・通知（Google Apps Script）
 *
 * 解決したい困りごと：
 *   「フォームやメールで来た問い合わせを、毎回kintoneに手で入力している」
 *
 * このスクリプトでやっていること：
 *   1. Googleフォームの回答を、送信された瞬間に kintone へ登録する
 *   2. Gmail の「kintone問い合わせ」ラベルが付いたメールを、5分おきに kintone へ登録する
 *   3. 種別・本文から優先度と担当者を自動で決め、一次回答期限を計算する
 *   4. 担当者にメール（と、設定していれば Chatwork）で通知する
 *   5. 失敗したら管理者にメールで知らせ、メールは次回自動で再登録する（取りこぼしゼロ）
 *
 * 最初に1回だけ：
 *   - スクリプト プロパティに、下の PROPS の値を設定する（APIトークンはコードに書かない）
 *   - setup() を実行する（フォームの作成・トリガーの設定）
 */

// ================================================================
// 設定
// ================================================================

/**
 * スクリプト プロパティ（プロジェクトの設定 → スクリプト プロパティ）に設定する値
 *   KINTONE_BASE_URL   例：https://xxxxx.cybozu.com
 *   KINTONE_APP_ID     問い合わせ管理アプリのID
 *   KINTONE_API_TOKEN  APIトークン（レコード閲覧・追加の権限）
 *   NOTIFY_EMAIL       通知を送るメールアドレス
 *   CHATWORK_API_TOKEN （任意）Chatwork にも通知するときの APIトークン
 *   CHATWORK_ROOM_ID   （任意）通知先の Chatwork のルームID
 */
const PROPS = PropertiesService.getScriptProperties();
const prop = (key, required = true) => {
  const value = PROPS.getProperty(key);
  if (required && !value) throw new Error(`スクリプト プロパティ ${key} が設定されていません`);
  return value || '';
};

/** Gmail で、kintone に登録したいメールに付けるラベル（登録後は「/登録済み」を付ける） */
const GMAIL_LABEL = 'kintone問い合わせ';
const GMAIL_DONE_LABEL = `${GMAIL_LABEL}/登録済み`;

/** 優先度ごとの一次回答期限（受付から何時間以内）。kintone の JS（js/inquiry.js）と同じルール */
const SLA_HOURS = { 高: 2, 中: 24, 低: 72 };

/** 種別ごとの担当者（kintone の「担当者」に入る） */
const ASSIGNEES = {
  '導入のご相談': '営業 太郎',
  '見積依頼': '営業 花子',
  '不具合・トラブル': 'サポート 次郎',
  'その他': '営業 太郎',
};

/** この言葉が入っていたら優先度を「高」にする */
const URGENT_WORDS = ['至急', '緊急', '止まっ', 'できない', 'できません', 'エラー'];

/** メールの件名・本文から種別を推定するための言葉（上から順に判定） */
const CATEGORY_WORDS = [
  ['不具合・トラブル', ['不具合', 'エラー', 'できない', 'できません', '表示されない', '止まっ']],
  ['見積依頼', ['見積', '費用', '料金', '価格']],
  ['導入のご相談', ['導入', '相談', '検討', '打ち合わせ']],
];

/** フォームの質問（タイトルは kintone の項目との対応付けにも使う） */
const FORM_ITEMS = {
  company: '会社名',
  name: 'お名前',
  email: 'メールアドレス',
  tel: '電話番号',
  category: 'お問い合わせの種類',
  body: 'お問い合わせ内容',
};

// ================================================================
// 最初に1回だけ実行する
// ================================================================

/** Googleフォームを作り、フォーム送信時・5分おきのトリガーを設定する */
function setup() {
  // 設定漏れがあれば、ここで止める
  ['KINTONE_BASE_URL', 'KINTONE_APP_ID', 'KINTONE_API_TOKEN', 'NOTIFY_EMAIL'].forEach((key) => prop(key));

  let form;
  const formId = PROPS.getProperty('FORM_ID');
  if (formId) {
    form = FormApp.openById(formId);
  } else {
    form = createForm_();
    PROPS.setProperty('FORM_ID', form.getId());
  }

  // トリガーは作り直す（二重に設定されないように）
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('onFormSubmit').forForm(form).onFormSubmit().create();
  ScriptApp.newTrigger('checkGmail').timeBased().everyMinutes(5).create();

  // Gmail のラベル（なければ作る）
  GmailApp.getUserLabelByName(GMAIL_LABEL) || GmailApp.createLabel(GMAIL_LABEL);
  GmailApp.getUserLabelByName(GMAIL_DONE_LABEL) || GmailApp.createLabel(GMAIL_DONE_LABEL);

  console.log(`フォームの回答用URL: ${form.getPublishedUrl()}`);
  console.log(`フォームの編集用URL: ${form.getEditUrl()}`);
}

function createForm_() {
  const form = FormApp.create('お問い合わせフォーム（サンプル株式会社）');
  form.setDescription('kintone の導入・開発に関するお問い合わせはこちらから。担当者より1営業日以内にご連絡します。');
  form.setCollectEmail(false);
  form.addTextItem().setTitle(FORM_ITEMS.company);
  form.addTextItem().setTitle(FORM_ITEMS.name).setRequired(true);
  form.addTextItem().setTitle(FORM_ITEMS.email).setRequired(true)
    .setValidation(FormApp.createTextValidation().requireTextIsEmail().build());
  form.addTextItem().setTitle(FORM_ITEMS.tel);
  form.addMultipleChoiceItem().setTitle(FORM_ITEMS.category).setRequired(true)
    .setChoiceValues(Object.keys(ASSIGNEES));
  form.addParagraphTextItem().setTitle(FORM_ITEMS.body).setRequired(true);
  form.setConfirmationMessage('お問い合わせありがとうございます。担当者より1営業日以内にご連絡します。');
  return form;
}

// ================================================================
// 1. Googleフォーム → kintone
// ================================================================

/** フォームが送信されたときに呼ばれる（トリガー） */
function onFormSubmit(e) {
  const answers = {};
  e.response.getItemResponses().forEach((r) => { answers[r.getItem().getTitle()] = r.getResponse(); });

  const category = answers[FORM_ITEMS.category] || 'その他';
  const body = answers[FORM_ITEMS.body] || '';
  registerInquiry_({
    sourceId: makeSourceId_('form', e.response.getId()),
    channel: 'Googleフォーム',
    receivedAt: e.response.getTimestamp(),
    company: answers[FORM_ITEMS.company] || '',
    name: answers[FORM_ITEMS.name] || '',
    email: answers[FORM_ITEMS.email] || '',
    tel: answers[FORM_ITEMS.tel] || '',
    category,
    subject: `【${category}】${body.split('\n')[0].slice(0, 30)}`,
    body,
  });
}

// ================================================================
// 2. Gmail → kintone
// ================================================================

/** ラベル付きのメールを kintone に登録する（5分おきのトリガー） */
function checkGmail() {
  const doneLabel = GmailApp.getUserLabelByName(GMAIL_DONE_LABEL);
  const threads = GmailApp.search(`label:${GMAIL_LABEL} -label:${GMAIL_DONE_LABEL.replace('/', '-')} newer_than:7d`, 0, 20);

  threads.forEach((thread) => {
    try {
      const message = thread.getMessages()[0]; // スレッドの最初のメールを問い合わせとして登録する
      const { name, email } = parseFrom_(message.getFrom());
      const subject = message.getSubject();
      const body = message.getPlainBody().trim().slice(0, 5000);
      registerInquiry_({
        sourceId: makeSourceId_('mail', message.getId()),
        channel: 'メール',
        receivedAt: message.getDate(),
        company: '',
        name,
        email,
        tel: '',
        category: guessCategory_(`${subject}\n${body}`),
        subject,
        body,
      });
      // 登録できたものだけ「登録済み」にする。失敗したメールは次回もう一度試す
      thread.addLabel(doneLabel);
    } catch (error) {
      notifyError_('メールの登録に失敗しました（次回の実行で再試行します）', error, thread.getFirstMessageSubject());
    }
  });
}

/** 「山田 太郎 <taro@example.com>」をお名前とアドレスに分ける */
function parseFrom_(from) {
  const match = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (match) return { name: match[1] || match[2], email: match[2] };
  return { name: from, email: from };
}

function guessCategory_(text) {
  const hit = CATEGORY_WORDS.find(([, words]) => words.some((w) => text.includes(w)));
  return hit ? hit[0] : 'その他';
}

// ================================================================
// 3. 共通：kintone に登録して通知する
// ================================================================

/**
 * 問い合わせを kintone に登録し、担当者に通知する
 * 同じ問い合わせ（連携元ID）がすでにあれば何もしない（二重登録の防止）
 */
function registerInquiry_(inquiry) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30 * 1000); // フォーム送信とメール取り込みが同時に動いても、二重登録しないようにする
  try {
    const existing = kintoneRequest_('get', '/k/v1/records.json', {
      app: prop('KINTONE_APP_ID'),
      query: `source_id = "${inquiry.sourceId}" limit 1`,
      fields: ['$id'],
    });
    if (existing.records.length > 0) {
      console.log(`登録済みのためスキップ: ${inquiry.sourceId}`);
      return existing.records[0].$id.value;
    }

    const priority = decidePriority_(inquiry.category, `${inquiry.subject}\n${inquiry.body}`);
    const assignee = ASSIGNEES[inquiry.category] || ASSIGNEES['その他'];
    const receivedAt = inquiry.receivedAt || new Date();
    const dueAt = new Date(receivedAt.getTime() + SLA_HOURS[priority] * 60 * 60 * 1000);

    const { id } = kintoneRequest_('post', '/k/v1/record.json', {
      app: prop('KINTONE_APP_ID'),
      record: {
        received_at: { value: toKintoneDateTime_(receivedAt) },
        channel: { value: inquiry.channel },
        source_id: { value: inquiry.sourceId },
        company: { value: inquiry.company },
        customer_name: { value: inquiry.name },
        email: { value: inquiry.email },
        tel: { value: inquiry.tel },
        category: { value: inquiry.category },
        priority: { value: priority },
        subject: { value: inquiry.subject },
        body: { value: inquiry.body },
        status: { value: '未対応' },
        assignee: { value: assignee },
        due_at: { value: toKintoneDateTime_(dueAt) },
      },
    });

    notify_({ ...inquiry, priority, assignee, dueAt, recordId: id });
    return id;
  } catch (error) {
    // フォームの回答はやり直しがきかないので、内容ごと管理者に送って取りこぼしを防ぐ
    if (inquiry.channel === 'Googleフォーム') {
      notifyError_('フォームの回答を kintone に登録できませんでした。手動で登録してください', error, JSON.stringify(inquiry, null, 2));
    }
    throw error;
  } finally {
    lock.releaseLock();
  }
}

/**
 * 連携元ID（例：form:3f2a…）を作る
 * フォームの回答IDは長く、kintone の「値の重複を禁止」にした文字列は64文字までなので、
 * 元のIDを SHA-256 で短い固定長（32文字）に変換して保存する
 */
function makeSourceId_(prefix, rawId) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, rawId, Utilities.Charset.UTF_8);
  const hex = digest.map((b) => ((b + 256) % 256).toString(16).padStart(2, '0')).join('');
  return `${prefix}:${hex.slice(0, 32)}`;
}

/** 優先度：至急などの言葉がある・不具合 → 高、相談・見積 → 中、それ以外 → 低 */
function decidePriority_(category, text) {
  if (category === '不具合・トラブル' || URGENT_WORDS.some((w) => text.includes(w))) return '高';
  if (category === '導入のご相談' || category === '見積依頼') return '中';
  return '低';
}

/** kintone の日時形式（UTC、ミリ秒なし） */
function toKintoneDateTime_(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// ================================================================
// 4. 通知（メール・Chatwork）
// ================================================================

function notify_(inq) {
  const url = `${prop('KINTONE_BASE_URL')}/k/${prop('KINTONE_APP_ID')}/show#record=${inq.recordId}`;
  const due = Utilities.formatDate(inq.dueAt, 'Asia/Tokyo', 'M/d HH:mm');
  const lines = [
    `受付経路：${inq.channel}`,
    `種別　　：${inq.category}（優先度：${inq.priority}）`,
    `お客様　：${[inq.company, inq.name].filter(Boolean).join(' ')} 様`,
    `件名　　：${inq.subject}`,
    `担当者　：${inq.assignee}`,
    `回答期限：${due} まで`,
    '',
    inq.body.slice(0, 300),
    '',
    `kintone で開く：${url}`,
  ];
  const title = `${inq.priority === '高' ? '【至急】' : ''}新しい問い合わせ：${inq.subject}`;

  MailApp.sendEmail(prop('NOTIFY_EMAIL'), title, lines.join('\n'));

  // Chatwork は設定されているときだけ送る
  const cwToken = prop('CHATWORK_API_TOKEN', false);
  const cwRoom = prop('CHATWORK_ROOM_ID', false);
  if (cwToken && cwRoom) {
    try {
      UrlFetchApp.fetch(`https://api.chatwork.com/v2/rooms/${cwRoom}/messages`, {
        method: 'post',
        headers: { 'X-ChatWorkToken': cwToken },
        payload: { body: `[info][title]${title}[/title]${lines.join('\n')}[/info]` },
      });
    } catch (error) {
      // Chatwork が失敗しても、kintone の登録とメール通知はできているので処理は止めない
      notifyError_('Chatwork への通知に失敗しました', error, title);
    }
  }
}

/** エラーを管理者（NOTIFY_EMAIL）に知らせる */
function notifyError_(title, error, detail) {
  console.error(title, error);
  MailApp.sendEmail(prop('NOTIFY_EMAIL'), `【要確認】${title}`, `${error && error.message}\n\n${detail || ''}`);
}

// ================================================================
// kintone REST API
// ================================================================

/**
 * kintone REST API を呼ぶ。混み合っているとき（429・5xx）は少し待って最大3回までやり直す
 */
function kintoneRequest_(method, path, body) {
  let url = `${prop('KINTONE_BASE_URL')}${path}`;
  const options = {
    method,
    headers: { 'X-Cybozu-API-Token': prop('KINTONE_API_TOKEN') },
    muteHttpExceptions: true,
  };
  if (method === 'get') {
    url += `?${Object.entries(body).flatMap(([k, v]) => (
      Array.isArray(v) ? v.map((item, i) => `${k}[${i}]=${encodeURIComponent(item)}`) : `${k}=${encodeURIComponent(v)}`
    )).join('&')}`;
  } else {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(body);
  }

  for (let attempt = 1; ; attempt += 1) {
    const res = UrlFetchApp.fetch(url, options);
    const code = res.getResponseCode();
    if (code === 200) return JSON.parse(res.getContentText());
    if ((code === 429 || code >= 500) && attempt < 3) {
      Utilities.sleep(1000 * attempt * attempt);
      continue;
    }
    throw new Error(`kintone API エラー（${code}）: ${res.getContentText().slice(0, 300)}`);
  }
}

// ================================================================
// 動作確認用
// ================================================================

/** フォームを使わずに、テスト用の問い合わせを1件登録する */
function testRegister() {
  registerInquiry_({
    sourceId: `test:${Date.now()}`,
    channel: 'Googleフォーム',
    receivedAt: new Date(),
    company: '株式会社テスト',
    name: 'テスト 太郎',
    email: 'test@example.com',
    tel: '03-0000-0000',
    category: '不具合・トラブル',
    subject: '【不具合・トラブル】テスト送信です',
    body: 'GAS からのテスト登録です。至急ご確認ください。',
  });
}
