/** Explicit, reviewable activation of an undated Video Analysis report. */
import { deriveData, findDuplicateVideoImport, mergeImport, normalizeCreator, parseNumber, retainVideoViewMaxima, stableKey } from './creator-engine.mjs';
import { preserveReplacedVideoViews } from './video-views.mjs';

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function validIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function checkedPeriod(options = {}) {
  const { rangeStart, rangeEnd } = options;
  if (!validIsoDate(rangeStart) || !validIsoDate(rangeEnd)) {
    fail('INVALID_PERIOD', '请填写报表实际统计开始和结束日期（YYYY-MM-DD）；不能用视频发布日期或文件名代替。');
  }
  if (rangeStart > rangeEnd) fail('INVALID_PERIOD', '统计结束日期不能早于开始日期。');
  return { rangeStart, rangeEnd, reportMonth: rangeStart.slice(0, 7) === rangeEnd.slice(0, 7) ? rangeStart.slice(0, 7) : '' };
}

function rowPeriod(row) {
  const month = row.reportMonth || row.snapshotPeriod || row.month || '';
  let start = row.periodStart || row.rangeStart || '';
  let end = row.periodEnd || row.rangeEnd || '';
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    const next = new Date(`${month}-01T00:00:00.000Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    next.setUTCDate(0);
    start ||= `${month}-01`;
    end ||= next.toISOString().slice(0, 10);
  }
  return { start, end };
}

function pendingReport(state, pendingId) {
  const pending = (state.pendingVideoImports || []).find(item => item.id === pendingId);
  if (!pending) fail('PENDING_NOT_FOUND', '未找到这份待确认报表，请刷新后重试。');
  if (pending.status === 'confirmed' || pending.status === 'activated') {
    fail('PENDING_ALREADY_CONFIRMED', '这份报表已经确认并计入统计，请刷新查看最新数据。');
  }
  if (pending.status !== 'period_unconfirmed') fail('PENDING_NOT_AVAILABLE', '这份报表当前不在待确认状态。');
  if (!Array.isArray(pending.records) || !pending.records.length) fail('EMPTY_PENDING_REPORT', '这份待确认报表没有可导入的视频记录。');
  return pending;
}

function datedRecords(pending, period, keepDuplicates = false) {
  const records = new Map(), originals = [];
  for (const input of pending.records) {
    if (!input || typeof input !== 'object' || !/^[A-Za-z0-9_-]+$/.test(String(input.videoId || ''))) {
      fail('INVALID_PENDING_REPORT', '待确认报表含有无效视频 ID，请重新导入原文件。');
    }
    const videoId = String(input.videoId);
    const productId = String(input.productId || '');
    const id = stableKey(period.rangeStart, period.rangeEnd, videoId, productId || 'unmapped');
    const row = {
      ...input,
      id,
      videoId,
      productId,
      creatorId: normalizeCreator(input.creatorId),
      periodStart: period.rangeStart,
      periodEnd: period.rangeEnd,
      reportMonth: period.reportMonth,
      periodStatus: 'confirmed',
      pendingPeriod: false,
      publicationOnly: false,
      reportPurpose: 'sales',
      viewsKind: input.viewsKind === 'lifetime_snapshot' ? 'lifetime_snapshot' : 'period',
      reportKind: '',
      confirmedReportId: pending.id,
      sourceFile: pending.fileName || input.sourceFile || '',
      sourceSheet: input.sourceSheet || pending.sheetName || '',
    };
    records.set(id, row);
    originals.push(row);
  }
  return keepDuplicates ? originals : [...records.values()];
}

function periodGroups(rows) {
  const groups = new Map();
  for (const row of rows || []) {
    const period = rowPeriod(row);
    if (!period.start || !period.end) continue;
    const key = stableKey(period.start, period.end);
    if (!groups.has(key)) groups.set(key, { periodStart: period.start, periodEnd: period.end, records: new Map(), originalRecords: [] });
    groups.get(key).originalRecords.push(row);
    // The engine uses the latest row of each period/video/PID key as well.
    groups.get(key).records.set(stableKey(row.videoId, row.productId || 'unmapped'), row);
  }
  return [...groups.values()].map(group => {
    const records = [...group.records.values()];
    return {
      periodStart: group.periodStart,
      periodEnd: group.periodEnd,
      recordCount: group.originalRecords.length,
      videoCount: new Set(records.map(row => row.videoId)).size,
      itemsSold: records.reduce((total, row) => total + parseNumber(row.itemsSold), 0),
      sourceFiles: [...new Set(records.map(row => row.sourceFile).filter(Boolean))],
      records: group.originalRecords,
    };
  }).sort((a, b) => a.periodStart.localeCompare(b.periodStart) || a.periodEnd.localeCompare(b.periodEnd));
}

function review(state, pendingId, options) {
  const pending = pendingReport(state, pendingId);
  const period = checkedPeriod(options);
  const records = datedRecords(pending, period);
  const sourceHash = pending.sourceHash || pending.sha256 || '';
  const sheetName = pending.sheetName || records[0]?.sourceSheet || '';
  const duplicateOf = findDuplicateVideoImport(state, { sourceHash, sheetName, mappingSignature: pending.mappingSignature, rangeStart: period.rangeStart, rangeEnd: period.rangeEnd });
  const baselineOverlaps = (state.videoBaselines || []).filter(baseline => baseline.cutoffDate >= period.rangeStart).map(baseline => ({
    id: baseline.id,
    cutoffDate: baseline.cutoffDate,
    fileName: baseline.fileName || '',
    recordCount: baseline.records?.length || 0,
  }));
  const groups = periodGroups(state.videos);
  const exact = groups.filter(group => group.periodStart === period.rangeStart && group.periodEnd === period.rangeEnd);
  const overlapping = groups.filter(group => group.periodStart <= period.rangeEnd && group.periodEnd >= period.rangeStart && !exact.includes(group));
  const replacing = [...exact, ...overlapping];
  const replacingKeys = new Set(replacing.map(group => stableKey(group.periodStart, group.periodEnd)));
  const kept = (state.videos || []).filter(row => {
    const existing = rowPeriod(row);
    return !replacingKeys.has(stableKey(existing.start, existing.end));
  });
  const describe = group => {
    const { records: _records, ...description } = group;
    return { ...description, partialOverlap: period.rangeStart > group.periodStart || period.rangeEnd < group.periodEnd };
  };
  const overlappingPeriods = overlapping.map(describe);
  const exactPeriods = exact.map(describe);
  // Use the same metric projection as the dashboard, including missing-PID exclusions.
  const projectedItemsSold = duplicateOf ? deriveData(state).stats.itemsSold : baselineOverlaps.length ? null : deriveData({ ...state, videos: [...kept, ...records.map(row => ({ ...row, excludedFromMetrics: !row.productId }))], pendingVideoImports: [] }).stats.itemsSold;
  const preview = {
    pendingId,
    fileName: pending.fileName || '',
    ...period,
    videoCount: new Set(records.map(row => row.videoId)).size,
    recordCount: records.length,
    creatorCount: new Set(records.map(row => row.creatorId).filter(Boolean)).size,
    itemsSold: records.reduce((total, row) => total + parseNumber(row.itemsSold), 0),
    overlappingPeriods,
    exactPeriods,
    baselineOverlaps,
    duplicateFile: !!duplicateOf,
    duplicateOf,
    requiresOverlapConfirmation: overlapping.length > 0,
    hasPartialOverlaps: overlappingPeriods.some(group => group.partialOverlap),
    willArchiveRecordCount: replacing.reduce((total, group) => total + group.recordCount, 0),
    willArchiveItemsSold: replacing.reduce((total, group) => total + group.itemsSold, 0),
    projectedItemsSold,
  };
  return { pending, period, records, replacing, preview };
}

/** Preview only. No incoming rows, existing state, or import history are mutated. */
export function previewPendingVideoImport(state, pendingId, options = {}) {
  return review(state, pendingId, options).preview;
}

/** Activate only after the administrator has reviewed the exact reporting interval. */
export function confirmPendingVideoImport(state, pendingId, options = {}) {
  const { pending, period, records, replacing, preview } = review(state, pendingId, options);
  if (preview.duplicateFile) return completeDuplicate(state, pending, preview, options);
  if (preview.baselineOverlaps.length) {
    fail('BASELINE_PERIOD_OVERLAP', '所选统计周期已包含在历史底表中，不能再次累计。请导入历史截止日之后的区间，或使用新的完整历史底表更新。');
  }
  if (preview.hasPartialOverlaps) {
    fail('PARTIAL_PERIOD_OVERLAP', '新周期只覆盖已有报告的一部分，无法准确拆分旧报告销量。请使用覆盖完整旧周期的报告，或选择完全不重叠的新周期。');
  }
  if (preview.requiresOverlapConfirmation && options.replaceOverlapping !== true) {
    fail('OVERLAPPING_PERIOD', '统计周期与已有报告重叠。请先核对将被替换的完整周期，再明确确认归档旧报告并以新报告计数。');
  }
  const at = options.at || new Date().toISOString();
  const importId = stableKey('confirmed-video-report', pendingId, period.rangeStart, period.rangeEnd);
  const result = mergeImport(state, 'videos', records, {
    sourceName: pending.fileName || '',
    sheetName: pending.sheetName || records[0]?.sourceSheet || '',
    sourceHash: pending.sourceHash || pending.sha256 || '',
    mappingSignature: pending.mappingSignature,
    month: period.reportMonth,
    rangeStart: period.rangeStart,
    rangeEnd: period.rangeEnd,
    replacePeriod: true,
    replaceOverlapping: options.replaceOverlapping === true,
    importId,
    at,
  });
  if (result.summary.duplicateFile) return completeDuplicate(state, pending, { ...preview, duplicateFile: true, duplicateOf: result.summary.duplicateOf }, options);
  // datedRecords chooses the current sales row, while every accepted input row
  // remains eligible to establish the video's independent lifetime view peak.
  result.state = retainVideoViewMaxima(result.state, pending.records, { sourceName: pending.fileName, sheetName: pending.sheetName, at });
  result.state = preserveReplacedVideoViews(state, result.state, datedRecords(pending, period, true));
  const archives = replacing.map(group => ({
    id: stableKey('video-report-archive', importId, group.periodStart, group.periodEnd),
    pendingImportId: pendingId,
    archivedAt: at,
    reason: '统计周期已确认：旧报告保留供核对，累计销量以新报告为准。',
    viewsSuperseded: true,
    periodStart: group.periodStart,
    periodEnd: group.periodEnd,
    records: structuredClone(group.records),
  }));
  result.state.videoReportArchives = [...(state.videoReportArchives || []), ...archives];
  result.state.pendingVideoImports = (state.pendingVideoImports || []).map(item => item.id === pendingId ? {
    ...item,
    status: 'confirmed',
    confirmedAt: at,
    confirmedPeriodStart: period.rangeStart,
    confirmedPeriodEnd: period.rangeEnd,
    confirmedImportId: importId,
  } : item);
  return {
    state: result.state,
    preview,
    summary: { ...result.summary, archivedPeriods: archives.length, archivedRecords: preview.willArchiveRecordCount, projectedItemsSold: preview.projectedItemsSold },
  };
}

function reportSummary(records) {
  return {
    recordCount: records.length,
    videoCount: new Set(records.map(row => row.videoId)).size,
    creatorCount: new Set(records.map(row => normalizeCreator(row.creatorId)).filter(Boolean)).size,
    itemsSold: records.reduce((total, row) => total + parseNumber(row.itemsSold), 0),
  };
}

function completeDuplicate(state, pending, preview, options) {
  const at = options.at || new Date().toISOString();
  const sourceHash = pending.sourceHash || pending.sha256 || '';
  const sheetName = pending.sheetName || pending.records[0]?.sourceSheet || '';
  const matchingBaseline = (state.videoBaselines || []).find(baseline => (baseline.sourceHash || baseline.sha256) === sourceHash && (baseline.sheetName || baseline.records?.[0]?.sourceSheet || '') === sheetName);
  const next = structuredClone(state);
  const warning = '这份文件的同一工作表已经处理过，本次重复文件已跳过；不会改变历史截止日或再次增加销量。';
  next.pendingVideoImports = (next.pendingVideoImports || []).map(item => item.id === pending.id ? {
    ...item,
    status: 'confirmed',
    confirmationMode: 'duplicateSkipped',
    confirmedAt: at,
    duplicateSkipped: true,
    duplicateOf: preview.duplicateOf || null,
    confirmedBaselineId: matchingBaseline?.id || '',
    originalRecordCount: item.records.length,
    records: [],
  } : item);
  const summary = { added: 0, updated: 0, unchanged: preview.recordCount, rejected: 0, warnings: [warning], duplicateFile: true, duplicateSourceHash: sourceHash, duplicateOf: preview.duplicateOf || null, archivedRecords: 0, archivedPeriods: 0, projectedItemsSold: deriveData(state).stats.itemsSold };
  next.imports = [...(next.imports || []), { id: stableKey('duplicate-video-report', pending.id, at), type: 'videos', fileName: pending.fileName || '', sheetName: pending.sheetName || pending.records[0]?.sourceSheet || '', sourceHash, at, status: 'duplicateSkipped', ...summary }];
  return { state: next, preview: { ...preview, projectedItemsSold: summary.projectedItemsSold }, summary };
}

function historicalRecords(pending, cutoffDate, baselineId, existingRows = []) {
  const winners = new Map();
  const incomingSeen = new Set();
  const valueVariants = new Map();
  const sourceDuplicateRows = [];
  let duplicateRows = 0;
  let maxResolvedRows = 0;
  // Historical exports lack sales dates. The user's chosen rule is MAX for each
  // video/PID across all historical sources, followed by SUM across distinct videos.
  // Incoming rows are considered last, so an equal maximum keeps the latest source.
  const candidates = [...existingRows.map(row => ({ row, incoming: false })), ...pending.records.map(row => ({ row, incoming: true }))];
  for (const candidate of candidates) {
    const input = candidate.row;
    if (!input || typeof input !== 'object' || !/^[A-Za-z0-9_-]+$/.test(String(input.videoId || ''))) {
      fail('INVALID_PENDING_REPORT', '历史底表含有无效视频 ID，请重新导入原文件。');
    }
    const videoId = String(input.videoId);
    const productId = String(input.productId || '');
    const key = stableKey(videoId, productId || 'unmapped');
    const sold = parseNumber(input.itemsSold);
    if (!valueVariants.has(key)) valueVariants.set(key, new Set());
    valueVariants.get(key).add(sold);
    if (candidate.incoming) {
      const signature = stableKey(key, input.postDate || '', sold, normalizeCreator(input.creatorId));
      if (incomingSeen.has(signature)) duplicateRows++;
      incomingSeen.add(signature);
    }
    const existing = winners.get(key);
    if (existing) {
      if (sold !== parseNumber(existing.row.itemsSold)) maxResolvedRows++;
      if (sold < parseNumber(existing.row.itemsSold)) {
        if (candidate.incoming) sourceDuplicateRows.push(structuredClone(input));
        continue;
      }
      // Covered older sources are preserved by the ordinary archive. Only losing
      // incoming rows need a separate copy before pending.records is cleared.
      if (existing.incoming) sourceDuplicateRows.push(structuredClone(existing.row));
    }
    winners.set(key, candidate);
  }
  const records = [...winners.values()].map(({ row: input, incoming }) => {
    const videoId = String(input.videoId), productId = String(input.productId || '');
    return {
      ...input,
      sourceRecordId: input.sourceRecordId || input.id || '',
      sourcePeriodStart: input.sourcePeriodStart || input.periodStart || '',
      sourcePeriodEnd: input.sourcePeriodEnd || input.periodEnd || '',
      id: stableKey('historical-baseline', baselineId, videoId, productId || 'unmapped'),
      videoId,
      productId,
      creatorId: normalizeCreator(input.creatorId),
      reportKind: 'historicalBaseline',
      baselineId,
      baselineCutoff: cutoffDate,
      periodStart: '',
      periodEnd: cutoffDate,
      rangeStart: '',
      rangeEnd: '',
      reportMonth: '',
      snapshotPeriod: '',
      month: '',
      periodStatus: 'confirmed',
      pendingPeriod: false,
      publicationOnly: false,
      reportPurpose: 'sales',
      confirmedReportId: pending.id,
      sourceFile: incoming ? pending.fileName || input.sourceFile || '' : input.sourceFile || '',
      sourceSheet: input.sourceSheet || (incoming ? pending.sheetName || '' : ''),
      excludedFromMetrics: !productId,
    };
  });
  return { records, duplicateRows, maxResolvedRows, maxResolvedVideos: [...valueVariants.values()].filter(values => values.size > 1).length, sourceDuplicateRows, retainedExistingVideos: [...winners.values()].filter(winner => !winner.incoming).length };
}

function historicalReview(state, pendingId, options = {}) {
  const pending = pendingReport(state, pendingId);
  const cutoffDate = options.cutoffDate;
  if (!validIsoDate(cutoffDate)) fail('INVALID_BASELINE_CUTOFF', '请填写历史底表的实际截止日期（YYYY-MM-DD）；起始日期未知时可以留空。');
  const baselineId = stableKey('historical-baseline', pendingId, cutoffDate);
  const sourceHash = pending.sourceHash || pending.sha256 || '';
  const sheetName = pending.sheetName || pending.records[0]?.sourceSheet || '';
  const duplicateOf = findDuplicateVideoImport(state, { sourceHash, sheetName, mappingSignature: pending.mappingSignature });
  const groups = periodGroups(state.videos);
  const invalidExisting = (state.videos || []).filter(row => {
    const period = rowPeriod(row);
    return !validIsoDate(period.start) || !validIsoDate(period.end) || period.start > period.end;
  });
  const covered = groups.filter(group => group.periodEnd <= cutoffDate);
  const partial = groups.filter(group => group.periodStart <= cutoffDate && group.periodEnd > cutoffDate);
  const future = (state.videos || []).filter(row => rowPeriod(row).start > cutoffDate);
  const oldBaselines = state.videoBaselines || [];
  const newerBaselines = oldBaselines.filter(baseline => baseline.cutoffDate > cutoffDate);
  const describe = group => { const { records: _records, ...summary } = group; return summary; };
  const baselineDescriptions = oldBaselines.map(baseline => ({ id: baseline.id, fileName: baseline.fileName || '', cutoffDate: baseline.cutoffDate, ...reportSummary(baseline.records || []) }));
  const existingRows = [...covered.flatMap(group => group.records), ...oldBaselines.flatMap(baseline => (baseline.records || []).map(row => ({ ...row, sourceFile: row.sourceFile || baseline.fileName || '', sourceSheet: row.sourceSheet || baseline.sheetName || '' })))];
  const { records, duplicateRows, maxResolvedRows, maxResolvedVideos, sourceDuplicateRows, retainedExistingVideos } = historicalRecords(pending, cutoffDate, baselineId, existingRows);
  const duplicateKeys = new Set(existingRows.map(row => stableKey(row.videoId, row.productId || 'unmapped', row.postDate || '', parseNumber(row.itemsSold))));
  const incomingByIdentity = new Map(pending.records.map(row => [stableKey(row.videoId, row.productId || 'unmapped'), row]));
  const duplicates = [...incomingByIdentity.values()].filter(row => duplicateKeys.has(stableKey(row.videoId, row.productId || 'unmapped', row.postDate || '', parseNumber(row.itemsSold))));
  const baseline = { id: baselineId, fileName: pending.fileName || '', sheetName, sourceHash, sha256: pending.sha256 || sourceHash, mappingSignature: pending.mappingSignature || '', cutoffDate, aggregationMethod: 'maxPerVideoProduct', records, sourceDuplicateRows };
  const blocked = !!(partial.length || newerBaselines.length || invalidExisting.length);
  const projectedItemsSold = duplicateOf ? deriveData(state).stats.itemsSold : blocked ? null : deriveData({ ...state, videos: future, videoBaselines: [baseline], pendingVideoImports: [] }).stats.itemsSold;
  const preview = {
    pendingId,
    fileName: pending.fileName || '',
    mode: 'historicalBaseline',
    cutoffDate,
    ...reportSummary(records),
    originalRecordCount: pending.records.length,
    duplicateRows,
    conflictingRows: 0,
    maxResolvedRows,
    maxResolvedVideos,
    retainedExistingVideos,
    aggregationMethod: 'maxPerVideoProduct',
    duplicateExistingVideos: duplicates.length,
    duplicateExistingItemsSold: duplicates.reduce((total, row) => total + parseNumber(row.itemsSold), 0),
    duplicateFile: !!duplicateOf,
    duplicateOf,
    coveredPeriods: covered.map(describe),
    coveredBaselines: baselineDescriptions,
    partialPeriods: partial.map(describe),
    newerBaselines: newerBaselines.map(baseline => ({ id: baseline.id, cutoffDate: baseline.cutoffDate })),
    invalidExistingRecords: invalidExisting.length,
    requiresOverlapConfirmation: covered.length > 0 || oldBaselines.length > 0,
    hasPartialOverlaps: partial.length > 0,
    willArchiveRecordCount: covered.reduce((total, group) => total + group.recordCount, 0) + oldBaselines.reduce((total, old) => total + (old.records?.length || 0), 0),
    willArchiveItemsSold: covered.reduce((total, group) => total + group.itemsSold, 0) + baselineDescriptions.reduce((total, old) => total + old.itemsSold, 0),
    preservedFutureRecordCount: future.length,
    projectedItemsSold,
    canActivate: !!duplicateOf || !blocked,
  };
  return { pending, baseline, covered, oldBaselines, future, preview };
}

/** Preview historical per-video maxima with a known cutoff and an unknown start. */
export function previewHistoricalBaseline(state, pendingId, options = {}) {
  return historicalReview(state, pendingId, options).preview;
}

/** Consolidate historical per-video maxima once, while retaining later increments. */
export function confirmHistoricalBaseline(state, pendingId, options = {}) {
  const { pending, baseline, covered, oldBaselines, future, preview } = historicalReview(state, pendingId, options);
  if (preview.duplicateFile) return completeDuplicate(state, pending, preview, options);
  if (preview.newerBaselines.length) fail('BASELINE_CUTOFF_REGRESSION', '已有历史底表的截止日期更晚，不能用更早的底表覆盖；请保留当前底表或提供更新的完整历史数据。');
  if (preview.invalidExistingRecords) fail('UNCONFIRMED_EXISTING_PERIOD', '已有视频记录缺少有效统计周期，暂不能确定是否已包含在历史底表中。请先核对这些记录。');
  if (preview.hasPartialOverlaps) fail('PARTIAL_PERIOD_OVERLAP', '历史截止日落在已有报告区间内，无法准确拆分该报告。请使用覆盖完整旧区间的历史底表。');
  if (preview.requiresOverlapConfirmation && options.replaceOverlapping !== true) fail('OVERLAPPING_PERIOD', '历史底表将覆盖此前已经计入的报告。请核对后确认归档旧明细，累计只使用这份历史底表。');
  const at = options.at || new Date().toISOString();
  const importId = stableKey('confirmed-historical-baseline', pendingId, baseline.cutoffDate);
  const reason = '历史报告按每个视频 ID 与 PID 的最大出单值合并；原始明细保留核对，不再重复计入累计销量。';
  const archives = [
    ...covered.map(group => ({ id: stableKey('video-report-archive', importId, group.periodStart, group.periodEnd), pendingImportId: pendingId, archivedAt: at, reason, periodStart: group.periodStart, periodEnd: group.periodEnd, records: structuredClone(group.records) })),
    ...oldBaselines.map(old => ({ id: stableKey('historical-baseline-archive', importId, old.id), pendingImportId: pendingId, archivedAt: at, reason, reportKind: 'historicalBaseline', baselineId: old.id, cutoffDate: old.cutoffDate, periodStart: '', periodEnd: old.cutoffDate, fileName: old.fileName || '', sourceHash: old.sourceHash || old.sha256 || '', records: structuredClone(old.records || []), sourceDuplicateRows: structuredClone(old.sourceDuplicateRows || []) })),
  ];
  const next = structuredClone(state);
  next.videos = structuredClone(future);
  next.videoViewMaxima = retainVideoViewMaxima(state, pending.records, { sourceName: pending.fileName, sheetName: pending.sheetName, at }).videoViewMaxima;
  next.videoBaselines = [{ ...baseline, confirmedAt: at, sourceReportId: pendingId, originalRecordCount: pending.records.length, cutoffReason: options.cutoffReason || '用户确认本文件为此前的历史数据，后续从截止日之后按统计周期追加。', periodStartKnown: false }];
  next.videoReportArchives = [...(next.videoReportArchives || []), ...archives];
  next.pendingVideoImports = (next.pendingVideoImports || []).map(item => item.id === pendingId ? {
    ...item, status: 'confirmed', confirmationMode: 'historicalBaseline', confirmedAt: at, confirmedCutoffDate: baseline.cutoffDate, confirmedPeriodStart: '', confirmedPeriodEnd: baseline.cutoffDate, confirmedImportId: importId, baselineId: baseline.id,
    confirmedBaselineId: baseline.id, originalRecordCount: item.records.length, recordCount: baseline.records.length, records: [],
  } : item);
  const warnings = ['历史数据按每个视频 ID 与 PID 的最大出单值计入；不同视频分别求和。起始日期未知，不按视频发布日期分配月度销量。', '底表覆盖范围内的旧明细已归档，后续有销售日期或明确统计周期的新数据继续累计。'];
  if (preview.duplicateRows) warnings.push(`历史底表内 ${preview.duplicateRows} 条相同视频、发布日期和出单值的重复记录只计一次。`);
  if (preview.maxResolvedVideos) warnings.push(`${preview.maxResolvedVideos} 个视频与产品组合出现多个历史出单值，已采用各自最大值。`);
  const summary = { added: baseline.records.length, updated: 0, unchanged: 0, rejected: 0, warnings, archivedPeriods: covered.length, archivedBaselines: oldBaselines.length, archivedRecords: preview.willArchiveRecordCount, duplicateRows: preview.duplicateRows, maxResolvedVideos: preview.maxResolvedVideos, retainedExistingVideos: preview.retainedExistingVideos, projectedItemsSold: preview.projectedItemsSold };
  next.imports = [...(next.imports || []), { id: importId, type: 'videos', mode: 'historicalBaseline', status: 'confirmed', aggregationMethod: 'maxPerVideoProduct', fileName: baseline.fileName, sheetName: baseline.sheetName, sourceHash: baseline.sourceHash, cutoffDate: baseline.cutoffDate, at, ...summary }];
  return { state: next, preview, summary };
}
