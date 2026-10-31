/** Stage video facts without confirming when their sales occurred. */
import { findDuplicateVideoImport, normalizeCreator, normalizeVideoProduct, parseNumber, retainVideoViewMaxima, stableKey } from './creator-engine.mjs';
import { publicationViewsMetadata } from './video-views.mjs';

const text = value => value === undefined || value === null ? '' : String(value).trim();
const sourceHashOf = value => text(value.sourceHash || value.sha256);
const sheetOf = value => text(value.sheetName || value.sourceSheet || value.records?.[0]?.sourceSheet);
const periodFields = ['periodStart', 'periodEnd', 'reportMonth', 'rangeStart', 'rangeEnd', 'snapshotPeriod', 'month', 'salesDate'];

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function validVideoId(value) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return '';
  const id = text(value);
  if (/^(?:[-_]+|undefined|null|nan)$/i.test(id)) return '';
  return /^[A-Za-z0-9_-]+$/.test(id) ? id : '';
}

function stagedRow(input, pendingId, fileName, sheetName, publicationOnly = false) {
  const row = normalizeVideoProduct(structuredClone(input));
  row.videoId = validVideoId(input.videoId);
  row.creatorId = normalizeCreator(input.creatorId);
  row.sourceFile = text(input.sourceFile) || fileName;
  row.sourceSheet = text(input.sourceSheet) || sheetName;

  const sourcePeriod = { ...(row.unconfirmedSourcePeriod || {}) };
  for (const key of periodFields) {
    if (text(row[key])) sourcePeriod[key] = row[key];
    row[key] = '';
  }
  if (Object.keys(sourcePeriod).length) row.unconfirmedSourcePeriod = sourcePeriod;
  for (const key of Object.keys(row)) {
    if (/^(?:confirmed|baseline)/.test(key) || key === 'reportKind') delete row[key];
  }
  row.periodStatus = publicationOnly ? 'not_applicable' : 'unconfirmed';
  row.pendingPeriod = !publicationOnly;
  row.publicationOnly = publicationOnly;
  row.reportPurpose = publicationOnly ? 'publication' : 'pending';
  row.pendingImportId = pendingId;
  row.id = stableKey('pending', pendingId, row.videoId, row.productId || 'unmapped');
  return row;
}

/**
 * Pure staging operation. It never calls mergeImport('videos'), writes active
 * videos/baselines, or infers a sales period from a filename/publication date.
 * Full original valid rows remain available for the existing period/baseline
 * confirmation flows. Their current report summary uses the last video/PID row.
 */
export function stageVideoImport(inputState, records, context = {}) {
  if (!inputState || typeof inputState !== 'object' || Array.isArray(inputState)) fail('INVALID_STATE', '未找到有效工作台数据，请刷新后重试。');
  if (!Array.isArray(records)) fail('INVALID_VIDEO_ROWS', '视频记录格式无效，请重新读取文件。');
  const sourceHash = sourceHashOf(context);
  if (!sourceHash) fail('MISSING_SOURCE_HASH', '缺少文件校验值，请重新选择视频文件后暂存。');
  const sheetName = text(context.sheetName || records[0]?.sourceSheet);
  const fileName = text(context.sourceName || context.fileName || records[0]?.sourceFile);
  const publicationOnly = context.reportPurpose === 'publication';
  const viewMetadata = publicationOnly ? publicationViewsMetadata(context) : { viewsKind: 'unconfirmed' };
  const warnings = [...(Array.isArray(context.warnings) ? context.warnings : [])];
  const summary = { added: 0, updated: 0, unchanged: 0, duplicates: 0, rejected: Math.max(0, Number(context.rejected) || 0), warnings, duplicateFile: false, pendingImportId: '', reportPurpose: publicationOnly ? 'publication' : 'pending', publicationOnly };

  // Clear every range in replay detection so a changed mapping/default month
  // cannot relabel accepted bytes as a new unconfirmed report.
  const accepted = findDuplicateVideoImport(inputState, { sourceHash, sheetName, mappingSignature: context.mappingSignature || '' });
  const pending = (inputState.pendingVideoImports || []).find(report => sourceHashOf(report) === sourceHash && sheetOf(report) === sheetName);
  if (accepted || pending) {
    const duplicateOf = accepted || { id: pending.id, fileName: pending.fileName || '', sheetName, sourceHash, type: 'pendingVideoImport' };
    summary.duplicateFile = true;
    summary.duplicateSourceHash = sourceHash;
    summary.duplicateOf = duplicateOf;
    summary.pendingImportId = pending?.id || '';
    summary.unchanged = records.length;
    summary.duplicates = records.length;
    warnings.push('同一文件的这一工作表已有记录，本次已跳过；不会重复暂存或增加销量。');
    return { state: inputState, summary };
  }

  const pendingId = stableKey('pending-video-report', sourceHash, sheetName);
  const acceptedRows = [];
  for (const input of records) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || !validVideoId(input.videoId)) {
      summary.rejected++;
      continue;
    }
    acceptedRows.push(stagedRow(input, pendingId, fileName, sheetName, publicationOnly));
  }
  if (!acceptedRows.length) fail('EMPTY_PENDING_REPORT', '没有可暂存的有效 Video ID；请核对视频 ID 的字段映射和原始文本格式。');

  const latest = new Map();
  let conflictingDuplicates = 0;
  for (const row of acceptedRows) {
    const key = stableKey(row.videoId, row.productId || 'unmapped');
    const previous = latest.get(key);
    if (previous && ['itemsSold', 'orders', 'gmv'].some(field => parseNumber(previous[field]) !== parseNumber(row[field]))) conflictingDuplicates++;
    latest.set(key, row);
  }
  const uniqueRows = [...latest.values()];
  const multiProductRows = acceptedRows.filter(row => row.productReviewRequired).length;
  summary.added = uniqueRows.length;
  summary.duplicates = acceptedRows.length - uniqueRows.length;
  summary.pendingImportId = pendingId;
  if (summary.rejected) warnings.push(`${summary.rejected} 行缺少有效视频 ID 或未通过规范化，已跳过。`);
  if (summary.duplicates) warnings.push(`${summary.duplicates} 行使用重复的视频 / PID 键，已保留原始行供确认时核对${conflictingDuplicates ? `，其中 ${conflictingDuplicates} 行销量不同` : ''}。`);
  if (multiProductRows) warnings.push(`${multiProductRows} 行包含多个 PID，已保留原值等待核对；没有创建拼接 PID，也没有分摊或重复计算销量。`);
  warnings.push(publicationOnly ? `已更新 ${new Set(acceptedRows.map(row => row.videoId)).size} 条发布视频的日期和候选链接；${viewMetadata.viewsKind === 'period' ? '月度推广按已确认统计期间使用本表的出单与播放' : '月度推广先显示发布报表参考，实际统计期间待确认'}。达人累计出单、GMV和播放仍由出单报表更新，本表不会再加一遍。` : `已暂存 ${new Set(acceptedRows.map(row => row.videoId)).size} 条视频；发布日期可用于视频数量和链接匹配，销量和期间播放量在实际统计周期确认后汇总。`);

  const reportSummary = {
    originalRecordCount: records.length,
    validRecordCount: acceptedRows.length,
    recordCount: uniqueRows.length,
    videoCount: new Set(acceptedRows.map(row => row.videoId)).size,
    creatorCount: new Set(acceptedRows.map(row => row.creatorId).filter(Boolean)).size,
    productCount: new Set(uniqueRows.map(row => row.productId).filter(Boolean)).size,
    itemsSold: uniqueRows.reduce((total, row) => total + parseNumber(row.itemsSold), 0),
    sourceItemsSold: acceptedRows.reduce((total, row) => total + parseNumber(row.itemsSold), 0),
    missingPostDateCount: new Set(acceptedRows.filter(row => !row.postDate).map(row => row.videoId)).size,
    multiProductRows,
    duplicates: summary.duplicates,
    conflictingDuplicates,
  };
  const at = context.at || context.importedAt || new Date().toISOString();
  const report = {
    id: pendingId, fileName, sheetName, sourceHash, sha256: sourceHash,
    mappingSignature: text(context.mappingSignature), importedAt: at,
    status: publicationOnly ? 'publication_only' : 'period_unconfirmed', reportPurpose: publicationOnly ? 'publication' : 'pending', publicationOnly, periodStart: '', periodEnd: '', reportMonth: '',
    ...viewMetadata,
    reason: text(context.reason) || (publicationOnly ? '此表用于月度推广；发布日期用于发布视频数量，出单与播放按确认统计期间汇总。未确认期间时标注参考，不重复计入达人累计。' : '视频发布日期不等于出单统计期间。已暂存视频事实；确认实际统计起止日期后才会累计销量。'),
    summary: reportSummary, records: acceptedRows,
    originalRecordCount: records.length, recordCount: uniqueRows.length,
  };
  // Suggestions remain labelled evidence, never active period metadata.
  for (const field of ['suggestedRangeStart', 'suggestedRangeEnd']) if (text(context[field])) report[field] = text(context[field]);
  summary.reportSummary = reportSummary;
  const entry = {
    id: stableKey('staged-video-report', pendingId), type: 'videos',
    fileName, sheetName, sourceHash, mappingSignature: text(context.mappingSignature),
    at, status: publicationOnly ? 'publication_only' : 'period_unconfirmed', month: '', rangeStart: '', rangeEnd: '',
    ...viewMetadata,
    ...summary,
  };
  const next = { ...inputState, pendingVideoImports: [...(inputState.pendingVideoImports || []), report], imports: [...(inputState.imports || []), entry] };
  return { state: publicationOnly ? retainVideoViewMaxima(next, acceptedRows, { sourceName: fileName, sheetName, at }) : next, summary };
}

/** Explicitly classify an already staged file as publication evidence. */
export function markPendingVideoAsPublication(inputState, pendingId, context = {}) {
  const report = (inputState.pendingVideoImports || []).find(item => item.id === pendingId);
  if (!report) fail('PENDING_NOT_FOUND', '未找到这份待确认报表，请刷新后重试。');
  if (report.active === false) fail('PENDING_NOT_AVAILABLE', '这份报表已停用，不能改变统计用途。');
  const warnings = [];
  const summary = { added: 0, updated: 0, unchanged: 0, duplicates: 0, rejected: 0, warnings, duplicateFile: false, pendingImportId: pendingId, reportPurpose: 'publication', publicationOnly: true };
  if (report.status === 'publication_only') {
    summary.unchanged = report.records?.length || 0;
    summary.duplicateFile = true;
    warnings.push('这份报表已经设为发布视频用途，本次没有重复更新。');
    return { state: inputState, summary };
  }
  if (report.status !== 'period_unconfirmed') fail('PENDING_NOT_AVAILABLE', '只有仍待确认的报表可以改为发布视频用途；已确认销售记录不会被移除。');
  if (!Array.isArray(report.records) || !report.records.length || report.records.some(row => !row || !validVideoId(row.videoId))) fail('INVALID_PENDING_REPORT', '待确认报表的视频记录无效，请重新核对源文件。');
  const at = context.at || context.importedAt || new Date().toISOString();
  const records = report.records.map(row => stagedRow(row, pendingId, report.fileName || '', report.sheetName || '', true));
  const reason = text(context.reason) || '已确认为发布视频报表，用于月度推广；发布日期和候选链接继续使用，出单与播放按确认统计期间汇总，未确认期间时先标注参考。达人累计只使用已确认历史底表与出单报表。';
  const nextReport = { ...report, status: 'publication_only', reportPurpose: 'publication', publicationOnly: true, classifiedAt: at, originalReason: report.originalReason || report.reason || '', reason, periodStart: '', periodEnd: '', reportMonth: '', ...publicationViewsMetadata(context), records };
  summary.updated = report.recordCount || records.length;
  summary.reportSummary = report.summary || {};
  warnings.push(reason);
  const next = {
    ...inputState,
    pendingVideoImports: inputState.pendingVideoImports.map(item => item.id === pendingId ? nextReport : item),
    imports: [...(inputState.imports || []), { id: stableKey('publication-purpose', pendingId), type: 'videos', fileName: report.fileName || '', sheetName: report.sheetName || '', sourceHash: sourceHashOf(report), mappingSignature: report.mappingSignature || '', at, status: 'publication_only', month: '', rangeStart: '', rangeEnd: '', ...summary }],
  };
  return { state: retainVideoViewMaxima(next, records, { sourceName: report.fileName, sheetName: report.sheetName, at }), summary };
}
