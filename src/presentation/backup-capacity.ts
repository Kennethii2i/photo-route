export type BackupCounts = { trips: number; visits: number; photos: number; thumbnails: number; links: number };

export function backupCapacitySummary(counts: BackupCounts, selectedFiles = 0): string {
  const exceeded = counts.photos > 5000 || counts.trips > 1000 || counts.visits > 5000 || counts.thumbnails > 5000 || counts.links > 150000;
  const near = counts.photos >= 4500 || counts.trips >= 900 || counts.visits >= 4500 || counts.thumbnails >= 4500 || counts.links >= 135000;
  return `全旅行・ごみ箱を含む写真 ${counts.photos}枚 / ZIP上限5000枚。`
    + (exceeded ? '現在、全体ZIPの件数上限を超えています。全体バックアップを作成できません。' : near ? 'ZIPの件数上限に近づいています。' : '')
    + (selectedFiles ? `選択分がすべて追加される場合、最大${counts.photos + selectedFiles}枚。` : '')
    + (selectedFiles && counts.photos + selectedFiles > 5000 ? '追加後に全体ZIPの上限を超える可能性があります。' : '');
}

/** Matches the existing ZIP v2 record limits. Warnings never prohibit adding data. */
export function backupCapacityText(counts: BackupCounts, selectedFiles = 0): string {
  const limits: BackupCounts = { trips: 1000, visits: 5000, photos: 5000, thumbnails: 5000, links: 150000 };
  const exceeded = (Object.keys(limits) as Array<keyof BackupCounts>).some(key => counts[key] > limits[key]);
  const near = (Object.keys(limits) as Array<keyof BackupCounts>).some(key => counts[key] >= limits[key] * 0.9);
  const risk = exceeded ? '現在、全体ZIPの件数上限を超えています。全体バックアップを作成できません。'
    : near ? '全体ZIPの件数上限に近づいています。追加前にバックアップを確認してください。' : '';
  return `全旅行・ごみ箱を含む保存件数 / ZIP上限: 写真 ${counts.photos}/5000、旅行 ${counts.trips}/1000、アルバム ${counts.visits}/5000、サムネイル ${counts.thumbnails}/5000、所属 ${counts.links}/150000。${risk}`
    + (counts.photos + selectedFiles > limits.photos && selectedFiles > 0 ? '選択した写真の追加後に全体ZIPの上限を超える可能性があります。' : '')
    + (selectedFiles ? `選択した${selectedFiles}枚がすべて追加される場合、写真は最大${counts.photos + selectedFiles}枚です。重複・失敗で減る場合があります。` : '')
    + '通常保存は64 MiB、対応ブラウザの直接保存は256 MiBまで。件数内でもサイズ上限で保存できない場合があります。出力サイズは事前に確定できず、書き出しと再検証が必要です。復元でも累積件数が増えます。復元後に上限内となる保証はありません。';
}
