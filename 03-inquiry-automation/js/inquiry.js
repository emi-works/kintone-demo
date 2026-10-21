/**
 * 問い合わせ管理アプリ カスタマイズ
 *
 * 解決したい困りごと：
 *   「フォームやメールで来た問い合わせを、毎回kintoneに手で入力している」
 *   → 登録は GAS（gas/Code.gs）が自動で行う。このファイルは、登録された問い合わせを
 *     「取りこぼさずに対応する」ための画面側の仕組み。
 *
 * このファイルでやっていること：
 *   1. 一覧：一次回答期限を過ぎた・迫っている問い合わせを色分けし、対応状況・優先度をラベル表示
 *   2. 一覧：「未対応」「期限切れ」「今日の受付」の件数を上部に表示（REST API）
 *   3. 詳細：期限の警告と「対応を開始する」ボタン
 *   4. 入力：優先度から一次回答期限を自動計算、「完了」にするときは対応メモを必須にする
 */
(() => {
  'use strict';

  // ================================================================
  // 設定（GAS の Code.gs と同じルールにする）
  // ================================================================

  /** 優先度ごとの一次回答期限（受付から何時間以内に返事をするか） */
  const SLA_HOURS = { 高: 2, 中: 24, 低: 72 };

  /** 「期限間近」とみなす残り時間（分） */
  const DUE_SOON_MINUTES = 120;

  const STATUS = { OPEN: '未対応', WORKING: '対応中', DONE: '完了' };

  // ================================================================
  // 共通の関数
  // ================================================================

  const MINUTE = 60 * 1000;
  const HOUR = 60 * MINUTE;

  /** kintone の日時（UTC の ISO 形式）に変換する。kintone はミリ秒付きを受け付けないので外す */
  const toKintoneDateTime = (date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

  /** 受付日時と優先度から一次回答期限を計算する */
  const calcDueAt = (receivedAt, priority) => {
    if (!receivedAt || !SLA_HOURS[priority]) return '';
    return toKintoneDateTime(new Date(new Date(receivedAt).getTime() + SLA_HOURS[priority] * HOUR));
  };

  /** 「2時間」「35分」のような表記 */
  const formatDuration = (ms) => {
    const minutes = Math.max(1, Math.round(Math.abs(ms) / MINUTE));
    return minutes >= 60 ? `${Math.floor(minutes / 60)}時間` : `${minutes}分`;
  };

  /**
   * 期限の状態を判定する（完了したもの・期限がないものは対象外）
   * @returns {{ state: 'overdue' | 'due-soon', text: string } | null}
   */
  const getDeadlineState = (status, dueAt) => {
    if (status === STATUS.DONE || !dueAt) return null;
    const rest = new Date(dueAt).getTime() - Date.now();
    if (rest < 0) return { state: 'overdue', text: `${formatDuration(rest)}超過` };
    if (rest <= DUE_SOON_MINUTES * MINUTE) return { state: 'due-soon', text: `あと${formatDuration(rest)}` };
    return null;
  };

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  /** ヘッダーのスペースに入れ物を1つ用意する（再表示で増えないよう作り直す） */
  const prepareBox = (space, id, className) => {
    if (!space) return null;
    document.getElementById(id)?.remove();
    const box = el('div', className);
    box.id = id;
    space.appendChild(box);
    return box;
  };

  // ================================================================
  // 1. 一覧：期限の色分けとラベル
  // ================================================================

  /** セル内の文字（span）を色付きのラベルにする。文字の部分だけを囲むので、行の高さは変わらない */
  const decorateCell = (cell, className) => {
    if (!cell) return;
    const target = cell.querySelector('span') || cell.firstElementChild || cell;
    target.classList.add('iq-pill', className);
  };

  kintone.events.on('app.record.index.show', (event) => {
    if (event.viewType !== 'list') return event;

    const dueCells = kintone.app.getFieldElements('due_at');
    const statusCells = kintone.app.getFieldElements('status');
    const priorityCells = kintone.app.getFieldElements('priority');

    event.records.forEach((record, i) => {
      // 対応状況・優先度のラベル
      if (statusCells) decorateCell(statusCells[i], `iq-status--${{ 未対応: 'open', 対応中: 'working', 完了: 'done' }[record.status.value]}`);
      if (priorityCells && record.priority.value === '高') decorateCell(priorityCells[i], 'iq-priority--high');

      // 一次回答期限
      if (!dueCells || !dueCells[i]) return;
      const cell = dueCells[i];
      const row = cell.closest('tr') || cell;
      row.classList.remove('iq-row--overdue', 'iq-row--due-soon');
      cell.querySelector('.iq-badge')?.remove();

      const deadline = getDeadlineState(record.status.value, record.due_at.value);
      if (!deadline) return;
      row.classList.add(`iq-row--${deadline.state}`);
      (cell.firstElementChild || cell).appendChild(el('span', `iq-badge iq-badge--${deadline.state}`, deadline.text));
    });

    renderSummary();
    return event;
  });

  // ================================================================
  // 2. 一覧：件数のサマリー（REST API）
  // ================================================================

  const countRecords = async (query) => {
    const resp = await kintone.api(kintone.api.url('/k/v1/records.json', true), 'GET', {
      app: kintone.app.getId(),
      query: `${query} limit 1`,
      fields: ['$id'],
      totalCount: true,
    });
    return Number(resp.totalCount);
  };

  const renderSummary = async () => {
    const box = prepareBox(kintone.app.getHeaderMenuSpaceElement(), 'iq-summary', 'iq-summary');
    if (!box) return;
    try {
      const [open, overdue, today] = await Promise.all([
        countRecords(`status in ("${STATUS.OPEN}")`),
        countRecords(`status in ("${STATUS.OPEN}", "${STATUS.WORKING}") and due_at < NOW()`),
        countRecords('received_at = TODAY()'),
      ]);
      [
        ['未対応', open, 'open'],
        ['期限切れ', overdue, 'overdue'],
        ['今日の受付', today, 'today'],
      ].forEach(([label, count, modifier]) => {
        const item = el('div', `iq-summary__item iq-summary__item--${modifier}`);
        item.append(el('span', 'iq-summary__label', label), el('span', 'iq-summary__count', `${count}件`));
        box.appendChild(item);
      });
    } catch (error) {
      console.error(error);
      box.textContent = '件数を取得できませんでした';
    }
  };

  // ================================================================
  // 3. 詳細：期限の警告と「対応を開始する」ボタン
  // ================================================================

  const startWorking = async (button) => {
    button.disabled = true;
    try {
      await kintone.api(kintone.api.url('/k/v1/record.json', true), 'PUT', {
        app: kintone.app.getId(),
        id: kintone.app.record.getId(),
        record: { status: { value: STATUS.WORKING } },
      });
      window.location.reload();
    } catch (error) {
      console.error(error);
      alert(`対応状況を更新できませんでした。\n${error.message || ''}`);
      button.disabled = false;
    }
  };

  kintone.events.on('app.record.detail.show', (event) => {
    const { record } = event;
    const box = prepareBox(kintone.app.record.getHeaderMenuSpaceElement(), 'iq-detail-bar', 'iq-detail-bar');
    if (!box) return event;

    const deadline = getDeadlineState(record.status.value, record.due_at.value);
    if (deadline) {
      const message = deadline.state === 'overdue'
        ? `一次回答期限を${deadline.text.replace('超過', '')}過ぎています`
        : `一次回答期限まで${deadline.text.replace('あと', '')}です`;
      box.appendChild(el('span', `iq-banner iq-banner--${deadline.state}`, message));
    }
    if (record.status.value === STATUS.OPEN) {
      const button = el('button', 'iq-btn', '対応を開始する');
      button.type = 'button';
      button.addEventListener('click', () => startWorking(button));
      box.appendChild(button);
    }
    return event;
  });

  // ================================================================
  // 4. 入力画面：一次回答期限の自動計算と、完了時のチェック
  // ================================================================

  kintone.events.on(['app.record.create.show', 'app.record.edit.show'], (event) => {
    const { record } = event;
    record.source_id.disabled = true; // GAS が入れる値なので手で変えさせない
    if (event.type === 'app.record.create.show') {
      if (event.reuse) record.source_id.value = '';
      if (!record.due_at.value) record.due_at.value = calcDueAt(record.received_at.value, record.priority.value);
    }
    return event;
  });

  // 受付日時・優先度を変えたら、一次回答期限を計算し直す
  kintone.events.on([
    'app.record.create.change.priority', 'app.record.edit.change.priority',
    'app.record.create.change.received_at', 'app.record.edit.change.received_at',
  ], (event) => {
    const { record } = event;
    record.due_at.value = calcDueAt(record.received_at.value, record.priority.value);
    return event;
  });

  // 「完了」にするときは、何をしたかを必ず残してもらう
  kintone.events.on(['app.record.create.submit', 'app.record.edit.submit', 'app.record.index.edit.submit'], (event) => {
    const { record } = event;
    if (record.status.value === STATUS.DONE && record.response_memo && !record.response_memo.value.trim()) {
      if (event.type !== 'app.record.index.edit.submit') record.response_memo.error = '対応内容を入力してください';
      event.error = '「完了」にするときは、対応メモに対応内容を入力してください。';
    }
    return event;
  });
})();
