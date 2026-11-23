import type { LibraryDb, RecoveryKind } from '../infrastructure/storage';
import type { TrashDeletionPlan } from '../infrastructure/trash-deletion-plan';

const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '') => {
  const item = document.createElement(tag); item.textContent = text; return item;
};

export function createTrashDeletionDialog(options: {
  db: LibraryDb;
  errorText: (error: unknown) => string;
  onDeleted: (plan: TrashDeletionPlan) => Promise<void>;
  onBackup: () => void;
  onUncertain: (message: string) => void;
}) {
  const dialog = node('dialog'); dialog.id = 'trash-delete-dialog';
  dialog.setAttribute('aria-labelledby', 'trash-delete-heading');
  dialog.setAttribute('aria-describedby', 'trash-delete-name trash-delete-summary');
  const title = node('h2', '完全に削除しますか？'); title.id = 'trash-delete-heading';
  const targetName = node('p'); targetName.id = 'trash-delete-name';
  const summary = node('p'); summary.id = 'trash-delete-summary';
  const warning = node('p', 'ごみ箱から戻せなくなります。元の写真ファイルは削除しません。');
  const backupHelp = node('p', '最新の全体ZIPを保存し、そのファイルを選び直してください。現在の写真・アルバム・所属・サムネイルと一致することを確認します。');
  const label = node('label', '保存済みの最新ZIP'); label.htmlFor = 'trash-delete-backup';
  const file = node('input'); file.type = 'file'; file.accept = '.zip,application/zip'; file.id = 'trash-delete-backup';
  const status = node('p'); status.id = 'trash-delete-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const detail = node('details'), detailTitle = node('summary', '削除と復元について');
  detail.append(detailTitle,
    node('p', '削除後は、検証したZIPから復元できます。写真・アルバムだけを削除した場合は、既存旅行との衝突を確認して「別コピーとして復元」を使います。旅行全体が別のコピーになる場合があります。'),
    node('p', '操作履歴と取り込み履歴は保持します。過去の名前や写真情報は履歴に残りますが、削除対象をUndoで復活させることはできません。ZIPには操作履歴・取り込み履歴・元写真を含みません。'));
  const backup = node('button', 'ZIPを用意する'); backup.type = 'button'; backup.id = 'trash-delete-prepare-backup';
  const actions = node('div'); actions.className = 'row';
  const cancel = node('button', 'キャンセル'); cancel.type = 'button'; cancel.id = 'trash-delete-cancel';
  const commit = node('button', '完全に削除'); commit.type = 'button'; commit.id = 'trash-delete-commit'; commit.className = 'trash-delete-commit';
  const check = node('button', '削除状態を確認'); check.type = 'button'; check.id = 'trash-delete-check'; check.hidden = true;
  actions.append(cancel, check, commit);
  const body = node('div'); body.className = 'trash-delete-body';
  body.append(warning, backupHelp, backup, label, file, status, detail);
  dialog.append(title, targetName, summary, body, actions);
  document.body.append(dialog);
  let plan: TrashDeletionPlan | null = null, generation = 0;
  let verified = false, deleting = false, checking = false, attempted = false, finished = false;
  let controller: AbortController | null = null, returnFocus: HTMLElement | null = null, notified = false;
  let failureReason = '';
  const ui = () => {
    dialog.setAttribute('aria-busy', String(deleting || checking));
    commit.disabled = !verified || deleting || attempted; commit.hidden = attempted;
    commit.textContent = deleting ? '削除しています…' : '完全に削除';
    file.disabled = !plan || deleting || attempted;
    backup.disabled = deleting || checking; backup.hidden = attempted;
    cancel.disabled = deleting || checking;
    cancel.textContent = finished ? '閉じる' : attempted ? '確認を終了' : 'キャンセル';
    check.hidden = !attempted || finished; check.disabled = deleting || checking;
  };
  const close = () => {
    if (deleting || checking) return;
    generation++; controller?.abort(); controller = null; plan = null; file.value = '';
    dialog.close();
    if (returnFocus?.isConnected) returnFocus.focus();
    else document.querySelector<HTMLElement>('#management-close')?.focus();
    returnFocus = null;
  };
  const finish = async (current: TrashDeletionPlan) => {
    finished = true; status.textContent = '完全に削除しました。必要な場合は検証したZIPから復元してください。';
    if (!notified) {
      notified = true;
      try { await options.onDeleted(current); }
      catch (error) { status.textContent = `削除は確定しましたが、表示を更新できません。削除を再送せず、再読み込み後に確認してください。${options.errorText(error)}`; }
    }
  };
  const checkResult = async (current: TrashDeletionPlan) => {
    checking = true; ui();
    try {
      const result = await options.db.trashDeletionStatus(current);
      if (result === 'applied') await finish(current);
      else {
        const stateText = result === 'not-applied'
          ? '現在は削除前の状態です。自動では再送しません。確認を終了して、内容と最新ZIPを確認し直してください。'
          : '削除結果を確定できません。自動では再送しません。保存内容を確認するか、削除状態をもう一度確認してください。';
        status.textContent = `${failureReason}${stateText}`;
        options.onUncertain(status.textContent);
      }
    } finally { checking = false; ui(); }
  };
  cancel.addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('keydown', event => { if (event.key === 'Escape') event.stopPropagation(); });
  window.addEventListener('beforeunload', event => {
    if (dialog.open && (deleting || checking || attempted && !finished)) { event.preventDefault(); event.returnValue = ''; }
  });
  backup.addEventListener('click', () => { close(); options.onBackup(); });
  file.addEventListener('change', () => {
    controller?.abort(); controller = new AbortController();
    verified = false; const current = plan, selected = file.files?.[0], signal = controller.signal, currentGeneration = ++generation;
    ui();
    if (!current || !selected) { status.textContent = '最新のZIPを選択してください。'; return; }
    status.textContent = 'ZIPと現在の保存内容を検証しています…';
    void options.db.verifyTrashDeletionBackup(current, selected, signal).then(() => {
      if (signal.aborted || currentGeneration !== generation || plan !== current) return;
      verified = true; status.textContent = 'ZIPの内容が一致しました。対象と削除範囲を確認してから「完全に削除」を押してください。'; ui();
    }).catch(error => {
      if (signal.aborted || currentGeneration !== generation || plan !== current) return;
      verified = false; status.textContent = `ZIPを確認できません。最新の全体ZIPを保存して選び直してください。${options.errorText(error)}`; ui();
    });
  });
  commit.addEventListener('click', () => {
    if (!plan || !verified || deleting || attempted) return;
    const current = plan; deleting = true; attempted = true; status.textContent = '保存内容を再確認して削除しています…'; ui();
    void options.db.permanentlyDeleteFromTrash(current).then(() => finish(current)).catch(async error => {
      status.textContent = `削除結果を確認しています。${options.errorText(error)}`;
      failureReason = `${options.errorText(error)} `;
      await checkResult(current);
    }).finally(() => { deleting = false; ui(); cancel.focus(); });
  });
  check.addEventListener('click', () => { if (plan && !deleting && !checking) void checkResult(plan); });
  return {
    open: (kind: RecoveryKind, id: string, opener: HTMLElement) => {
      if (dialog.open) return;
      returnFocus = opener; plan = null; verified = false; deleting = false; checking = false; attempted = false; finished = false; notified = false; failureReason = '';
      controller?.abort(); controller = null; file.value = ''; detail.open = false;
      const currentGeneration = ++generation;
      targetName.textContent = ''; targetName.title = ''; summary.textContent = '削除範囲を確認しています…'; status.textContent = '';
      dialog.showModal(); ui(); cancel.focus();
      void options.db.prepareTrashDeletion(kind, id).then(current => {
        if (currentGeneration !== generation || !dialog.open) return;
        plan = current;
        const counts = `旅行${current.trips}件・アルバム${current.albums}件・写真${current.photos}枚・サムネイル${current.thumbnails}件・所属${current.links}件`;
        targetName.textContent = `「${current.label}」`; targetName.title = current.label;
        summary.textContent = `削除する内容：${counts}。${kind === 'visit' ? 'アルバム内の写真は残ります。' : kind === 'trip' ? '旅行内の写真・アルバムは、ごみ箱外のものも含めて削除します。' : ''}`;
        status.textContent = '最新のZIPを選択するまで削除できません。'; ui();
      }).catch(error => {
        if (currentGeneration !== generation || !dialog.open) return;
        summary.textContent = '完全に削除できません。'; status.textContent = options.errorText(error); ui();
      });
    },
  };
}
