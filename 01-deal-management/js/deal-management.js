/**
 * 案件・顧客管理アプリ カスタマイズ
 *
 * 解決したい困りごと：
 *   「Excelの案件管理表をkintoneに移したら、入力漏れと期限切れが増えた」
 *
 * このファイルでやっていること：
 *   1. ステータスに応じて、入力項目を表示／非表示にする（入力画面・詳細画面）
 *   2. ステータスごとに必須項目を変え、未入力なら保存できないようにする
 *      （一覧画面のインライン編集からの保存もチェックする）
 *   3. 一覧画面で、次回アクション期限が「過ぎた」「近い」案件を色分けする
 *   4. 一覧画面の上部に、アプリ全体の「期限切れ」「期限間近」の件数を表示する（REST API）
 *   5. 詳細画面の上部に、期限切れ・期限間近の警告を表示する
 *
 * 対応画面：PC版のみ（スマートフォン版は対象外）
 * 依存ライブラリ：なし
 */
(() => {
  'use strict';

  // ================================================================
  // 設定
  // フィールドコードや選択肢を変えたときは、ここだけ直せば動くようにしています。
  // ================================================================

  /** フィールドコード */
  const FIELD = {
    STATUS: 'status',
    NEXT_ACTION_DATE: 'next_action_date',
    NEXT_ACTION_DETAIL: 'next_action_detail',
    PROPOSAL_DATE: 'proposal_date',
    QUOTE_AMOUNT: 'quote_amount',
    QUOTE_DATE: 'quote_date',
    ORDER_DATE: 'order_date',
    ORDER_AMOUNT: 'order_amount',
    LOST_REASON: 'lost_reason',
    LOST_REASON_DETAIL: 'lost_reason_detail',
  };

  /**
   * 見出し（ラベル）のフィールドコード
   * ラベルにもフィールドコードを付けられるので、項目と同じく setFieldShown で出し分けます。
   * 「◆基本情報」「◆その他」はずっと表示するため、ここには含めません。
   */
  const LABEL = {
    NEXT_ACTION: 'lbl_next_action',
    QUOTE: 'lbl_quote',
    WON: 'lbl_won',
    LOST: 'lbl_lost',
  };

  /** エラーメッセージや案内に表示するフィールド名 */
  const FIELD_LABEL = {
    [FIELD.NEXT_ACTION_DATE]: '次回アクション期限',
    [FIELD.NEXT_ACTION_DETAIL]: '次回アクション内容',
    [FIELD.PROPOSAL_DATE]: '提案日',
    [FIELD.QUOTE_AMOUNT]: '見積金額',
    [FIELD.QUOTE_DATE]: '見積提出日',
    [FIELD.ORDER_DATE]: '受注日',
    [FIELD.ORDER_AMOUNT]: '受注金額',
    [FIELD.LOST_REASON]: '失注理由',
    [FIELD.LOST_REASON_DETAIL]: '失注理由の詳細',
  };

  /** ステータス（ドロップダウンの選択肢と完全に一致させる） */
  const STATUS = {
    LEAD: 'リード',
    PROPOSING: '提案中',
    QUOTED: '見積提出',
    WON: '受注',
    LOST: '失注',
  };

  /** 進行中のステータス。期限の色分け・期限の必須チェックはこのステータスだけが対象 */
  const ACTIVE_STATUSES = [STATUS.LEAD, STATUS.PROPOSING, STATUS.QUOTED];

  /** 失注理由で「詳細」の入力を必須にする選択肢 */
  const LOST_REASON_OTHER = 'その他';

  /** 「期限が近い」とみなす日数（今日から何日後までを黄色にするか） */
  const DUE_SOON_DAYS = 3;

  /**
   * ステータスごとのルール
   *   shown    : 表示するフィールド・見出し（ここに無い条件付きフィールドは非表示）
   *   required : 保存時に必須にするフィールド
   *
   * 例）「見積提出」にしたら、見積金額と見積提出日が表示され、入力しないと保存できない
   */
  const STATUS_RULES = {
    [STATUS.LEAD]: {
      shown: [LABEL.NEXT_ACTION, FIELD.NEXT_ACTION_DATE, FIELD.NEXT_ACTION_DETAIL],
      required: [FIELD.NEXT_ACTION_DATE],
    },
    [STATUS.PROPOSING]: {
      shown: [
        LABEL.NEXT_ACTION, FIELD.NEXT_ACTION_DATE, FIELD.NEXT_ACTION_DETAIL,
        LABEL.QUOTE, FIELD.PROPOSAL_DATE,
      ],
      required: [FIELD.NEXT_ACTION_DATE, FIELD.PROPOSAL_DATE],
    },
    [STATUS.QUOTED]: {
      shown: [
        LABEL.NEXT_ACTION, FIELD.NEXT_ACTION_DATE, FIELD.NEXT_ACTION_DETAIL,
        LABEL.QUOTE, FIELD.PROPOSAL_DATE, FIELD.QUOTE_AMOUNT, FIELD.QUOTE_DATE,
      ],
      required: [FIELD.NEXT_ACTION_DATE, FIELD.QUOTE_AMOUNT, FIELD.QUOTE_DATE],
    },
    [STATUS.WON]: {
      shown: [
        LABEL.QUOTE, FIELD.PROPOSAL_DATE, FIELD.QUOTE_AMOUNT, FIELD.QUOTE_DATE,
        LABEL.WON, FIELD.ORDER_DATE, FIELD.ORDER_AMOUNT,
      ],
      required: [FIELD.ORDER_DATE, FIELD.ORDER_AMOUNT],
    },
    [STATUS.LOST]: {
      shown: [
        LABEL.QUOTE, FIELD.PROPOSAL_DATE, FIELD.QUOTE_AMOUNT, FIELD.QUOTE_DATE,
        LABEL.LOST, FIELD.LOST_REASON, FIELD.LOST_REASON_DETAIL,
      ],
      required: [FIELD.LOST_REASON],
    },
  };

  /** 表示／非表示を切り替える対象のフィールド（全ルールの shown を重複なしでまとめたもの） */
  const CONDITIONAL_FIELDS = [...new Set(Object.values(STATUS_RULES).flatMap((rule) => rule.shown))];

  // ================================================================
  // 共通の関数
  // ================================================================

  /** ステータスに対応するルールを返す（ステータス未選択なら空のルール） */
  const getRule = (status) => STATUS_RULES[status] || { shown: [], required: [] };

  /** 進行中の案件かどうか */
  const isActive = (status) => ACTIVE_STATUSES.includes(status);

  /** 値が空かどうか（文字列・数値・日付は ''、ユーザー選択などは [] が空） */
  const isEmpty = (value) => (
    value === undefined || value === null || value === ''
    || (Array.isArray(value) && value.length === 0)
  );

  /**
   * レコードの内容から、いま必須になっている項目の一覧を返す
   * 「なぜ必須なのか」をメッセージに出せるよう、条件の説明（condition）も一緒に返す
   * @returns {{ code: string, condition: string }[]}
   */
  const getRequiredFields = (record) => {
    const status = record[FIELD.STATUS].value;
    const required = getRule(status).required.map((code) => ({
      code,
      condition: `ステータス「${status}」では`,
    }));

    // 失注理由が「その他」のときは、詳細も必須にする
    if (status === STATUS.LOST && record[FIELD.LOST_REASON].value === LOST_REASON_OTHER) {
      required.push({
        code: FIELD.LOST_REASON_DETAIL,
        condition: `失注理由が「${LOST_REASON_OTHER}」のときは`,
      });
    }
    return required;
  };

  /** 必須なのに未入力の項目の一覧を返す（形式は getRequiredFields と同じ） */
  const findMissingFields = (record) => getRequiredFields(record).filter(({ code }) => {
    // 念のため、レコードに含まれないフィールドはチェック対象外にする
    if (!record[code]) return false;
    return isEmpty(record[code].value);
  });

  /** フィールドコードの配列を「、」区切りのフィールド名にする */
  const toLabels = (codes) => codes.map((code) => FIELD_LABEL[code] || code).join('、');

  /**
   * 必須項目の一覧を、条件ごとの文章にする
   * 例）[ステータス「失注」→ 失注理由, 失注理由が「その他」→ 詳細] なら
   *     ['ステータス「失注」では「失注理由」', '失注理由が「その他」のときは「失注理由の詳細」']
   */
  const describeByCondition = (items) => {
    const codesByCondition = new Map();
    items.forEach(({ code, condition }) => {
      if (!codesByCondition.has(condition)) codesByCondition.set(condition, []);
      codesByCondition.get(condition).push(code);
    });
    return [...codesByCondition].map(([condition, codes]) => `${condition}「${toLabels(codes)}」`);
  };

  // ---------------- 日付の計算 ----------------

  /** 'YYYY-MM-DD' をローカル時刻の 0:00 の Date にする（new Date('YYYY-MM-DD') は UTC 扱いになるため使わない） */
  const parseDate = (dateString) => {
    const [y, m, d] = dateString.split('-').map(Number);
    return new Date(y, m - 1, d);
  };

  /** 今日から見て、期限まであと何日か（過ぎていればマイナス） */
  const daysUntil = (dateString) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    return Math.round((parseDate(dateString) - today) / MS_PER_DAY);
  };

  /**
   * 期限の状態を判定する
   * @returns {{ state: 'overdue' | 'due-soon', days: number } | null}
   *   overdue  : 期限切れ
   *   due-soon : 今日〜DUE_SOON_DAYS日後が期限
   *   null     : 色分け不要（期限に余裕がある／未入力／受注・失注済み）
   */
  const getDeadlineState = (status, dateString) => {
    if (!isActive(status) || isEmpty(dateString)) return null;
    const days = daysUntil(dateString);
    if (days < 0) return { state: 'overdue', days };
    if (days <= DUE_SOON_DAYS) return { state: 'due-soon', days };
    return null;
  };

  /** 期限の状態を短い文言にする（一覧のバッジ・詳細のバナーで使用） */
  const getDeadlineText = ({ state, days }) => {
    if (state === 'overdue') return `${Math.abs(days)}日超過`;
    if (days === 0) return '本日期限';
    return `あと${days}日`;
  };

  // ---------------- 画面の部品 ----------------

  /**
   * ヘッダースペースに、指定IDの要素を1つだけ用意して返す
   * （画面の再表示で同じ要素が増えないよう、既にあれば中身を空にして再利用する）
   */
  const prepareHeaderBox = (spaceElement, id) => {
    if (!spaceElement) return null;
    let box = document.getElementById(id);
    if (!box) {
      box = document.createElement('div');
      box.id = id;
      spaceElement.appendChild(box);
    }
    box.textContent = '';
    box.className = '';
    return box;
  };

  // ================================================================
  // 1. ステータスに応じた入力項目の出し分け
  // ================================================================

  /** ステータスに合わせて、条件付きフィールドの表示／非表示を切り替える */
  const applyFieldVisibility = (record) => {
    const { shown } = getRule(record[FIELD.STATUS].value);
    CONDITIONAL_FIELDS.forEach((code) => {
      kintone.app.record.setFieldShown(code, shown.includes(code));
    });
  };

  /**
   * 案内が見えなくなったら、画面の一番上に固定して表示し続ける
   * （必須マークを付ける公式の方法が無いため、下の方の項目を入力しているときも必須項目が分かるようにする）
   */
  const keepGuideVisible = (spaceElement) => {
    if (spaceElement.dataset.dealObserved) return; // ステータス変更のたびに呼ばれるため、監視の設定は1回だけ
    spaceElement.dataset.dealObserved = 'true';

    const observer = new IntersectionObserver(([entry]) => {
      // 上にスクロールして見えなくなったときだけ固定する
      const fixed = !entry.isIntersecting && entry.boundingClientRect.top < 0;
      // 固定すると元の場所が詰まって画面がずれるため、その分の高さを残しておく
      spaceElement.style.minHeight = fixed ? `${spaceElement.offsetHeight}px` : '';
      spaceElement.dataset.dealFixed = String(fixed);

      const box = document.getElementById('deal-required-guide');
      if (box) box.classList.toggle('deal-guide--fixed', fixed);
    });
    observer.observe(spaceElement);
  };

  /** 入力画面の上部に「このステータスで必須の項目」を案内する（スクロールしても上部に固定） */
  const renderRequiredGuide = (record) => {
    const spaceElement = kintone.app.record.getHeaderMenuSpaceElement();
    const box = prepareHeaderBox(spaceElement, 'deal-required-guide');
    if (!box) return;

    const required = getRequiredFields(record);
    if (required.length === 0) return;

    // 例）ステータス「失注」では「失注理由」、失注理由が「その他」のときは「失注理由の詳細」が必須です
    box.className = 'deal-guide';
    box.textContent = `${describeByCondition(required).join('、')}が必須です。`;

    // 固定表示中にステータスを変えた場合も、固定のまま表示する
    if (spaceElement.dataset.dealFixed === 'true') box.classList.add('deal-guide--fixed');
    keepGuideVisible(spaceElement);
  };

  // 入力・詳細画面を開いたとき
  kintone.events.on([
    'app.record.create.show',
    'app.record.edit.show',
    'app.record.detail.show',
  ], (event) => {
    applyFieldVisibility(event.record);

    if (event.type === 'app.record.detail.show') {
      renderDeadlineBanner(event.record); // 5. 詳細画面の期限警告
    } else {
      renderRequiredGuide(event.record);
    }
    return event;
  });

  // ステータス・失注理由を変更したとき（失注理由は「その他」で必須項目が変わるため）
  kintone.events.on([
    `app.record.create.change.${FIELD.STATUS}`,
    `app.record.edit.change.${FIELD.STATUS}`,
    `app.record.create.change.${FIELD.LOST_REASON}`,
    `app.record.edit.change.${FIELD.LOST_REASON}`,
  ], (event) => {
    applyFieldVisibility(event.record);
    renderRequiredGuide(event.record);
    return event;
  });

  // ================================================================
  // 2. 必須チェック（未入力なら保存させない）
  // ================================================================

  /**
   * 失注以外のステータスで保存するとき、失注理由を空にする
   * （一度「失注」にしてから戻した場合に、非表示の項目に古い値が残って集計がずれるのを防ぐ）
   */
  const clearLostReasonIfNotLost = (record) => {
    if (record[FIELD.STATUS].value === STATUS.LOST) return;
    record[FIELD.LOST_REASON].value = '';
    record[FIELD.LOST_REASON_DETAIL].value = '';
  };

  // 新規登録・編集画面の保存ボタンを押したとき
  kintone.events.on([
    'app.record.create.submit',
    'app.record.edit.submit',
  ], (event) => {
    const { record } = event;
    clearLostReasonIfNotLost(record);

    const missing = findMissingFields(record);
    if (missing.length > 0) {
      // フィールドの下にエラーを表示し、画面上部にもまとめて表示する
      missing.forEach(({ code }) => {
        record[code].error = '必須項目です';
      });
      // event.error を設定して event を返すと、保存がキャンセルされる
      event.error = `${describeByCondition(missing).join('、')}の入力が必要です。`;
    }
    return event;
  });

  // 一覧画面のインライン編集で保存したとき
  // （ここをチェックしないと、一覧でステータスだけ「受注」に変えて必須項目を飛ばせてしまう）
  kintone.events.on('app.record.index.edit.submit', (event) => {
    const { record } = event;
    const missing = findMissingFields(record);
    if (missing.length > 0) {
      event.error = `${describeByCondition(missing).join('、')}の入力が必要です。`
        + '一覧画面では入力できない項目があるため、詳細画面から編集してください。';
    }
    return event;
  });

  // ================================================================
  // 3. 一覧画面：期限が近い・過ぎた案件の色分け
  // 4. 一覧画面：アプリ全体の期限切れ・期限間近の件数表示（REST API）
  // ================================================================

  /** 一覧の各行に色分け用のクラスと、期限セルにバッジを付ける */
  const highlightDeadlines = (records) => {
    // 一覧に表示されている「次回アクション期限」のセル（records と同じ並び順）
    const cells = kintone.app.getFieldElements(FIELD.NEXT_ACTION_DATE);
    if (!cells) return; // 一覧にフィールドが表示されていない場合は何もしない

    records.forEach((record, index) => {
      const cell = cells[index];
      if (!cell) return;

      // 行全体に色を付ける（行が取れない場合はセルだけ）
      const row = cell.closest('tr') || cell;
      row.classList.remove('deal-row--overdue', 'deal-row--due-soon');
      const oldBadge = cell.querySelector('.deal-badge');
      if (oldBadge) oldBadge.remove();

      const deadline = getDeadlineState(record[FIELD.STATUS].value, record[FIELD.NEXT_ACTION_DATE].value);
      if (!deadline) return;

      row.classList.add(`deal-row--${deadline.state}`);

      const badge = document.createElement('span');
      badge.className = `deal-badge deal-badge--${deadline.state}`;
      badge.textContent = getDeadlineText(deadline);
      // 日付の横に並べるため、セル内の要素（日付を囲む div）に入れる。無ければセルに入れる
      (cell.firstElementChild || cell).appendChild(badge);
    });
  };

  /** 条件に合うレコードの件数を REST API で取得する */
  const fetchCount = async (condition) => {
    const statuses = ACTIVE_STATUSES.map((s) => `"${s}"`).join(', ');
    const params = {
      app: kintone.app.getId(),
      query: `${FIELD.STATUS} in (${statuses}) and ${condition} limit 1`,
      fields: ['$id'], // 件数だけ欲しいので、取得するフィールドは最小限にする
      totalCount: true,
    };
    const resp = await kintone.api(kintone.api.url('/k/v1/records.json', true), 'GET', params);
    return Number(resp.totalCount);
  };

  /** 一覧の上部に、アプリ全体の期限切れ・期限間近の件数を表示する */
  const renderDeadlineSummary = async () => {
    const box = prepareHeaderBox(kintone.app.getHeaderMenuSpaceElement(), 'deal-deadline-summary');
    if (!box) return;
    box.className = 'deal-summary';
    box.textContent = '期限を確認中…';

    try {
      // 一覧の絞り込み条件やページに関係なく、アプリ全体の件数を数える
      const [overdue, dueSoon] = await Promise.all([
        fetchCount(`${FIELD.NEXT_ACTION_DATE} < TODAY()`),
        fetchCount(`${FIELD.NEXT_ACTION_DATE} >= TODAY() and ${FIELD.NEXT_ACTION_DATE} <= FROM_TODAY(${DUE_SOON_DAYS}, DAYS)`),
      ]);

      box.textContent = '';
      const items = [
        { label: '期限切れ', count: overdue, modifier: 'overdue' },
        { label: `${DUE_SOON_DAYS}日以内に期限`, count: dueSoon, modifier: 'due-soon' },
      ];
      items.forEach(({ label, count, modifier }) => {
        const item = document.createElement('span');
        item.className = `deal-summary__item deal-summary__item--${modifier}`;
        item.textContent = `${label}：${count}件`;
        box.appendChild(item);
      });

      if (overdue === 0 && dueSoon === 0) {
        box.textContent = '期限切れ・期限間近の案件はありません';
      }
    } catch (error) {
      console.error(error);
      box.textContent = '期限の件数を取得できませんでした';
    }
  };

  // 一覧画面を表示したとき（ページ送り・インライン編集の保存後にも呼ばれる）
  kintone.events.on('app.record.index.show', (event) => {
    // 表形式の一覧だけが対象（カレンダー・カスタマイズビューは対象外）
    if (event.viewType !== 'list') return event;

    highlightDeadlines(event.records);
    renderDeadlineSummary(); // 画面表示を待たせないよう、結果は待たずに進める
    return event;
  });

  // ================================================================
  // 5. 詳細画面：期限切れ・期限間近の警告
  // ================================================================

  /** 詳細画面の上部に、期限の警告を表示する */
  // （「1.」のイベント処理から呼ばれるが、イベントが発生するのはこのファイルの読み込み後なので問題ない）
  const renderDeadlineBanner = (record) => {
    const box = prepareHeaderBox(kintone.app.record.getHeaderMenuSpaceElement(), 'deal-deadline-banner');
    if (!box) return;

    const dateString = record[FIELD.NEXT_ACTION_DATE].value;
    const deadline = getDeadlineState(record[FIELD.STATUS].value, dateString);
    if (!deadline) return;

    box.className = `deal-banner deal-banner--${deadline.state}`;
    box.textContent = deadline.state === 'overdue'
      ? `次回アクション期限（${dateString}）を${Math.abs(deadline.days)}日過ぎています。対応するか、期限を更新してください。`
      : `次回アクション期限（${dateString}）が近づいています（${getDeadlineText(deadline)}）。`;
  };
})();
