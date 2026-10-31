/** Order commission observations and explicitly maintained Target agreements.
 * These collections never feed sales, samples, roster admission or grading. */
import { normalizeCreator, parseDate, stableKey } from './creator-engine.mjs';

const text = value => value == null ? '' : String(value).trim().replace(/^'/, '');
const unique = values => [...new Set(values.filter(value => value !== '' && value != null))];
const field = (key, label, aliases = [], kind = 'text', required = false) => ({ key, label, aliases, kind, required });
const numberFields = ['quantity', 'estimatedStandard', 'actualStandard', 'estimatedShopAds', 'actualShopAds', 'estimatedBonus', 'actualBonus'];
const amountFields = numberFields.filter(key => key !== 'quantity');
const rateFields = ['standardRate', 'shopAdsRate'];
const targetScopes = ['creator', 'group', 'unspecified'];
const targetStatuses = ['active', 'archived'];

export const commissionFieldSchemas = {
  affiliateOrders: [
    field('orderId', '订单ID', ['Order ID', '订单号'], 'id', true),
    field('productId', '产品PID', ['Product ID', 'PID', '商品ID'], 'id', true),
    field('productName', '商品名称', ['Product Name', '产品名称']),
    field('skuId', 'SKU ID', ['SKU ID', '平台SKU ID'], 'id'),
    field('sku', '商品SKU', ['Seller SKU', '商家SKU']),
    field('currency', '币种', ['Currency']),
    field('quantity', '订单商品件数', ['Quantity', '数量'], 'number'),
    field('status', '订单状态', ['Order Status'], 'text', true),
    field('creatorId', '达人ID', ['Creator Username', 'Creator username', '达人账号'], 'creator', true),
    field('standardRate', '标准佣金率', ['Standard commission rate'], 'rate'),
    field('shopAdsRate', 'Shop Ads佣金率', ['Shop Ads commission rate', '广告佣金率'], 'rate'),
    field('estimatedStandard', '预估标准佣金', ['Est. standard commission payment', '预估普通佣金'], 'number'),
    field('actualStandard', '实际标准佣金', ['Actual Commission Payment', '实际普通佣金'], 'number'),
    field('estimatedShopAds', '预估Shop Ads佣金', ['Est. Shop Ads commission payment'], 'number'),
    field('actualShopAds', '实际Shop Ads佣金', ['Actual Shop Ads commission payment'], 'number'),
    field('estimatedBonus', '预估共同资助达人奖金', ['Est. co-funded creator bonus'], 'number'),
    field('actualBonus', '实际共同资助达人奖金', ['Actual co-funded creator bonus'], 'number'),
    field('createdAt', '订单创建时间', ['Time Created', 'Order Created', '创建时间'], 'datetime'),
    field('commissionModel', '佣金模式', ['commission model']),
  ],
  targetCommissions: [
    field('id', '记录ID', ['Target ID', 'recordId'], 'id'),
    field('scope', '对象类型', ['Target scope', 'Scope'], 'text', true),
    field('creatorId', '达人ID', ['Creator Username', 'Creator ID', '达人账号'], 'creator', true),
    field('groupName', '达人群组', ['Group', 'Group name', '群组名称']),
    field('sku', '商品SKU', ['Seller SKU', 'SKU', '商家SKU'], 'text', true),
    field('productId', '产品PID', ['Product ID', 'PID'], 'id', true),
    field('commissionRate', 'Target佣金率', ['Target commission rate', '佣金率', '约定佣金率'], 'rate', true),
    field('expiresOn', '到期日期', ['Expiry date', 'Expiration date', '过期日期'], 'date'),
    field('expiryOriginal', '原始到期说明', ['Original expiry', '原始日期']),
    field('expiryConfirmed', '到期日期已确认', ['Expiry confirmed'], 'boolean'),
    field('remindDays', '提前提醒天数', ['Reminder days'], 'number'),
    field('notes', '备注', ['Notes']),
    field('sourceText', '原始记录', ['Source text']),
    field('productReviewRequired', 'PID待核对', ['Product review required'], 'boolean'),
    field('creatorReviewRequired', '达人ID待核对', ['Creator review required'], 'boolean'),
    field('candidateProductIds', '候选PID', ['Candidate product IDs'], 'list'),
    field('status', '记录状态', ['Target status']),
  ],
};

// Store repeated orders as tuples rather than duplicating long field names,
// product descriptions and source filenames in a large workspace snapshot.
export const affiliateCommissionColumns = Object.freeze([
  'orderId', 'skuId', 'productId', 'creatorId', 'status', 'createdAt',
  'standardRate', 'shopAdsRate', 'estimatedStandard', 'actualStandard',
  'estimatedShopAds', 'actualShopAds', 'estimatedBonus', 'actualBonus',
  'currency', 'quantity', 'sourceIndex', 'sourceRow', 'sku', 'commissionModel',
]);
const columnIndex = Object.fromEntries(affiliateCommissionColumns.map((key, index) => [key, index]));
const numericColumnIndexes = [...rateFields, ...numberFields, 'sourceIndex', 'sourceRow'].map(key => columnIndex[key]);

function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function object(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text(value))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function headerKey(value) { return text(value).normalize('NFKC').toLowerCase().replace(/[\s_\-\/.()（）%:：]/g, ''); }
function bool(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (/^(是|已确认|true|yes|y|1|确认)$/i.test(text(value))) return true;
  if (/^(否|未确认|false|no|n|0|待确认)$/i.test(text(value))) return false;
  return fallback;
}
function identifier(value, label) {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) fail('UNSAFE_COMMISSION_ID', `${label} 已作为不安全的数字读取，请使用原始文本ID列，不能猜测被四舍五入的ID。`);
  const result = text(value);
  if (/^\d+(?:\.\d+)?e[+-]?\d+$/i.test(result)) fail('UNSAFE_COMMISSION_ID', `${label} 使用科学计数法，请改用完整文本ID。`);
  return result;
}
function optionalNumber(value) {
  if (value == null || text(value) === '' || /^[-—–]$/.test(text(value))) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let valueText = text(value).replace(/[€$£\s]/g, '');
  if (!/^-?[\d.,]+$/.test(valueText)) return null;
  if (valueText.includes(',') && valueText.includes('.')) valueText = valueText.lastIndexOf(',') > valueText.lastIndexOf('.') ? valueText.replace(/\./g, '').replace(',', '.') : valueText.replace(/,/g, '');
  else if (valueText.includes(',')) valueText = /^-?\d{1,3}(,\d{3})+$/.test(valueText) ? valueText.replace(/,/g, '') : valueText.replace(',', '.');
  const parsed = Number(valueText);
  return Number.isFinite(parsed) ? parsed : null;
}
/** Canonical rates use percentage points: 15 means 15%. Numeric spreadsheet
 * percentage cells use fractions; explicit percent strings are unambiguous. */
export function parseCommissionRate(value, options = {}) {
  if (value == null || text(value) === '' || /^[-—–]$/.test(text(value))) return null;
  const marked = typeof value === 'string' && /[%％]/.test(value);
  let parsed = optionalNumber(marked ? value.replace(/[%％]/g, '') : value);
  if (parsed === null) return null;
  if (options.spreadsheet && typeof value === 'number' && parsed > 0 && parsed <= 1) parsed *= 100;
  return parsed >= 0 && parsed <= 100 ? Math.round(parsed * 1e8) / 1e8 : null;
}
function parseTimestamp(value, dateFormat = 'dmy') {
  const date = parseDate(value, dateFormat);
  if (!validDate(date)) return '';
  if (value instanceof Date) return `${date} ${value.toISOString().slice(11, 19)}`;
  if (typeof value === 'number') {
    const fraction = value - Math.floor(value), seconds = Math.round(fraction * 86400) % 86400;
    return `${date} ${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }
  const match = text(value).match(/[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return date;
  if (+match[1] > 23 || +match[2] > 59 || +(match[3] || 0) > 59) return '';
  return `${date} ${match[1].padStart(2, '0')}:${match[2]}:${match[3] || '00'}`;
}
function normalizeScope(scope, creatorId, groupName) {
  const supplied = text(scope).toLowerCase();
  if (['creator', '达人', '个人', '指定达人'].includes(supplied)) return 'creator';
  if (['group', '群组', '达人群组', '老达人'].includes(supplied)) return 'group';
  if (['unspecified', '未指定', '待确认'].includes(supplied)) return 'unspecified';
  if (supplied) fail('INVALID_TARGET_SCOPE', '对象类型请填写达人、群组或未指定。');
  return creatorId ? 'creator' : groupName ? 'group' : 'unspecified';
}

export function guessCommissionMappings(headers, type = 'affiliateOrders') {
  const schema = commissionFieldSchemas[type];
  if (!schema) fail('UNKNOWN_COMMISSION_IMPORT', '未知的佣金导入类型。');
  const indexed = new Map();
  headers.forEach((header, index) => { const key = headerKey(header); if (!key) return; if (!indexed.has(key)) indexed.set(key, []); indexed.get(key).push(index); });
  return Object.fromEntries(schema.map(item => {
    for (const alias of [item.label, ...item.aliases, item.key]) { const choices = indexed.get(headerKey(alias)); if (choices?.length === 1) return [item.key, String(choices[0])]; if (choices?.length > 1) return [item.key, '']; }
    return [item.key, ''];
  }));
}

export function normalizeCommissionRows(type, rows, mapping, context = {}) {
  const schema = commissionFieldSchemas[type];
  if (!schema) fail('UNKNOWN_COMMISSION_IMPORT', '未知的佣金导入类型。');
  const records = [], warnings = [];
  let rejected = 0;
  for (let index = 0; index < rows.length; index++) {
    const values = Array.isArray(rows[index]) ? rows[index] : rows[index]?.values;
    if (!Array.isArray(values) || !values.some(value => text(value) !== '')) continue;
    const record = {}, rowNumber = (Number(context.headerRow) || 1) + index + 1;
    try {
      for (const item of schema) {
        const position = mapping?.[item.key];
        if (position === '' || position == null || !/^\d+$/.test(String(position))) continue;
        const value = values[Number(position)];
        if (value == null || text(value) === '') continue;
        if (item.kind === 'id') record[item.key] = identifier(value, item.label);
        else if (item.kind === 'creator') record[item.key] = normalizeCreator(value);
        else if (item.kind === 'rate') {
          const parsed = parseCommissionRate(value, { spreadsheet: context.rateUnit !== 'percent' });
          if (parsed === null) warnings.push(`第 ${rowNumber} 行「${item.label}」无效，保留为未提供，未当作0。`);
          else record[item.key] = parsed;
          if (typeof value === 'number' && value === 1 && context.rateUnit !== 'percent') warnings.push(`第 ${rowNumber} 行「${item.label}」数字1按Excel百分比存储解释为100%；如原意为1%，请在源表填1%后重新预览。`);
        } else if (item.kind === 'number') record[item.key] = type === 'targetCommissions' && item.key === 'remindDays' ? value : optionalNumber(value);
        else if (item.kind === 'boolean') record[item.key] = bool(value);
        else if (item.kind === 'list') record[item.key] = unique(text(value).split(/[,，;；\n|]+/).map(text));
        else if (item.kind === 'datetime') {
          record[item.key] = parseTimestamp(value, context.dateFormat || 'dmy');
          if (!record[item.key]) warnings.push(`第 ${rowNumber} 行「${item.label}」无法识别，不能据此判断最近费率。`);
        } else if (item.kind === 'date') {
          const date = parseDate(value, context.dateFormat || 'dmy');
          record[item.key] = validDate(date) ? date : context.strictRequired ? value : '';
          if (!validDate(date)) { record.expiryOriginal = record.expiryOriginal || text(value); record.expiryConfirmed = false; if (!context.strictRequired) warnings.push(`第 ${rowNumber} 行到期日期不完整，已保留原始说明等待确认年份。`); }
        } else record[item.key] = text(value);
      }
      record.sourceRow = rowNumber;
      if (type === 'affiliateOrders') {
        record.status = text(record.status).toLowerCase();
        if (!record.orderId || !record.status || !(record.skuId || record.productId)) throw new Error('缺少订单ID、订单状态，或SKU ID/PID，无法安全更新同一订单行。');
        if (record.status !== 'ineligible' && (!record.creatorId || !record.productId)) throw new Error('有效订单缺少达人ID或PID，无法归到达人商品佣金。');
        record.currency = text(record.currency).toUpperCase();
        records.push(record);
      } else records.push(normalizeTargetCommission(record, { ...context, sourceRow: rowNumber }));
    } catch (error) { rejected++; warnings.push(`第 ${rowNumber} 行未导入：${error.message}`); }
  }
  return { records, warnings: unique(warnings), rejected };
}

function decodeRow(values) { return Object.fromEntries(affiliateCommissionColumns.map((key, index) => [key, values[index] ?? (numericColumnIndexes.includes(index) ? null : '')])); }
function encodeRow(row) {
  const values = affiliateCommissionColumns.map((key, index) => row[key] ?? (numericColumnIndexes.includes(index) ? null : ''));
  while (values.length && (values.at(-1) == null || values.at(-1) === '')) values.pop();
  return values;
}
function orderKey(row) { return row.orderId && (row.skuId || row.productId) ? stableKey(row.orderId, row.skuId ? `sku:${row.skuId}` : `pid:${row.productId}`) : ''; }
function comparableRow(row) {
  return JSON.stringify(affiliateCommissionColumns.filter(key => !['sourceIndex', 'sourceRow'].includes(key)).map(key => row[key] ?? null));
}
function ledgerOf(state) {
  const input = state?.affiliateCommissionLedger;
  if (!input) return { version: 1, rows: [], products: [], skus: [], sources: [] };
  if (input.version !== 1 || !Array.isArray(input.rows)) fail('INVALID_COMMISSION_LEDGER', '联盟佣金记录格式无效，请恢复有效备份。');
  return input;
}
function sourceKey(context) {
  return context.sourceHash ? stableKey(context.sourceHash, context.sheetName || '', context.mappingSignature || '') : '';
}
function importSummary(context = {}) {
  return { added: 0, updated: 0, unchanged: 0, rejected: Number(context.rejected) || 0, duplicateRows: 0, duplicateFile: false, acceptedRows: 0, excludedIneligible: 0, warnings: [...(context.warnings || [])] };
}
function logEntry(type, context, summary) {
  const at = context.at || context.importedAt || new Date().toISOString();
  return { id: stableKey(type, context.sourceHash || '', context.sheetName || '', at), type, fileName: context.sourceName || context.fileName || '', sheetName: context.sheetName || '', at, ...summary, warnings: summary.warnings.slice(0, 30) };
}

/** Re-import updates stable order + SKU lines. Ineligible is a terminal exclusion
 * so an older export cannot silently resurrect a cancelled order observation. */
export function mergeAffiliateCommissions(state, records, context = {}) {
  if (!object(state) || !Array.isArray(records)) fail('INVALID_COMMISSION_IMPORT', '联盟订单导入内容无效。');
  const ledger = ledgerOf(state), summary = importSummary(context), sources = [...(ledger.sources || [])], signature = sourceKey(context);
  if (signature && sources.some(source => source.signature === signature)) { summary.duplicateFile = true; summary.unchanged = records.length; summary.warnings.push('这份联盟订单文件和工作表已导入，本次没有重复添加佣金观察。'); return { state, summary }; }
  const existing = new Map((ledger.rows || []).map(values => { const row = decodeRow(values); return [orderKey(row), row]; }));
  const incoming = new Map(), products = new Map((ledger.products || []).map(product => [product.productId, product])), skus = new Map((ledger.skus || []).map(sku => [stableKey(sku.skuId, sku.sku, sku.productId), sku]));
  const orderIndex = new Map();
  const indexOrder = (key, row) => { if (!orderIndex.has(row.orderId)) orderIndex.set(row.orderId, new Set()); orderIndex.get(row.orderId).add(key); };
  for (const [key, row] of existing) indexOrder(key, row);
  const sourceIndex = sources.length;
  for (const input of records) {
    try {
      const row = { orderId: identifier(input.orderId, '订单ID'), skuId: identifier(input.skuId, 'SKU ID'), productId: identifier(input.productId, '产品PID'), creatorId: normalizeCreator(input.creatorId), status: text(input.status).toLowerCase(), createdAt: parseTimestamp(input.createdAt, context.dateFormat || 'dmy'), currency: text(input.currency).toUpperCase(), sku: text(input.sku), commissionModel: text(input.commissionModel), sourceIndex, sourceRow: Number.isInteger(input.sourceRow) ? input.sourceRow : null };
      if (!row.orderId || !row.status || !(row.skuId || row.productId)) throw new Error('缺少安全的订单行键或状态。');
      if (row.status !== 'ineligible' && (!row.creatorId || !row.productId)) throw new Error('有效行缺少达人或PID。');
      for (const key of rateFields) row[key] = parseCommissionRate(input[key]);
      for (const key of numberFields) row[key] = optionalNumber(input[key]);
      const key = orderKey(row), previous = incoming.get(key);
      if (previous) {
        summary.duplicateRows++;
        if (comparableRow(previous) !== comparableRow(row)) summary.warnings.push(`订单 ${row.orderId} 同一SKU有不同记录，失效状态优先，其余采用本文件最后一行。`);
        if (previous.status === 'ineligible' && row.status !== 'ineligible') continue;
      }
      incoming.set(key, row);
      if (row.productId && text(input.productName)) products.set(row.productId, { productId: row.productId, productName: text(input.productName) });
      if (row.productId && (row.skuId || row.sku)) skus.set(stableKey(row.skuId, row.sku, row.productId), { skuId: row.skuId, sku: row.sku, productId: row.productId });
    } catch (error) { summary.rejected++; summary.warnings.push(error.message); }
  }
  for (const [key, row] of incoming) {
    if (row.status === 'ineligible') summary.excludedIneligible++; else summary.acceptedRows++;
    let oldKey = key, previous = existing.get(key);
    if (!previous) {
      const sameOrderProduct = [...(orderIndex.get(row.orderId) || [])].map(key => [key, existing.get(key)]).filter(([, item]) => item && item.productId === row.productId && (!item.skuId || !row.skuId));
      if (sameOrderProduct.length > 1) { summary.rejected++; summary.warnings.push(`订单 ${row.orderId} 缺少唯一SKU ID，找到多个商品行，本行未合并。`); continue; }
      if (sameOrderProduct.length === 1) { [oldKey, previous] = sameOrderProduct[0]; row.skuId ||= previous.skuId; }
    }
    if (previous?.status === 'ineligible' && row.status !== 'ineligible') { summary.unchanged++; summary.warnings.push(`订单 ${row.orderId} 已标记Ineligible，后续有效状态未自动恢复，避免旧文件复活已取消订单。`); continue; }
    if (previous && comparableRow(previous) === comparableRow(row)) { summary.unchanged++; continue; }
    if (previous) { summary.updated++; existing.delete(oldKey); orderIndex.get(previous.orderId)?.delete(oldKey); } else summary.added++;
    const nextKey = orderKey(row); existing.set(nextKey, row); indexOrder(nextKey, row);
  }
  summary.warnings = unique(summary.warnings);
  const at = context.at || context.importedAt || new Date().toISOString();
  sources.push({ signature, sourceHash: context.sourceHash || '', fileName: context.sourceName || context.fileName || '', sheetName: context.sheetName || '', at, rowCount: records.length, acceptedRows: summary.acceptedRows, excludedIneligible: summary.excludedIneligible });
  const nextLedger = { version: 1, rows: [...existing.values()].map(encodeRow), products: [...products.values()], skus: [...skus.values()], sources };
  return { state: { ...state, affiliateCommissionLedger: nextLedger, imports: [...(state.imports || []), logEntry('affiliateOrders', context, summary)] }, summary };
}

/** New manual/imported entries require all five explicitly supplied fields.
 * Expiry is optional, but a supplied date must include a valid year, month and day.
 * Existing records remain readable and archivable without this input gate. */
export function validateTargetCommissionInput(input, context = {}) {
  if (!object(input)) fail('INVALID_TARGET_INPUT', 'Target记录格式无效。');
  const fieldErrors = {};
  for (const item of commissionFieldSchemas.targetCommissions.filter(item => item.required)) {
    if (input[item.key] == null || text(input[item.key]) === '') fieldErrors[item.key] = `${item.label}为必填项，请明确填写。`;
  }
  if (!fieldErrors.scope) { try { normalizeScope(input.scope, '', ''); } catch (error) { fieldErrors.scope = error.message; } }
  if (!fieldErrors.creatorId && !normalizeCreator(input.creatorId)) fieldErrors.creatorId = '达人ID为必填项，请填写完整账号。';
  if (!fieldErrors.productId) { try { identifier(input.productId, '产品PID'); } catch (error) { fieldErrors.productId = error.message; } }
  if (!fieldErrors.commissionRate && parseCommissionRate(input.commissionRate) === null) fieldErrors.commissionRate = 'Target佣金率请填写0到100之间的百分数。';
  if (text(input.expiresOn) !== '' && !validDate(parseDate(input.expiresOn, context.dateFormat || 'dmy'))) fieldErrors.expiresOn = '到期日期为选填；填写时必须是有效的完整年月日，不能只填写月日或推测年份。';
  if (Object.keys(fieldErrors).length) {
    const error = new Error(Object.values(fieldErrors).join('；'));
    error.code = 'INVALID_TARGET_INPUT'; error.fields = Object.keys(fieldErrors); error.fieldErrors = fieldErrors;
    throw error;
  }
  return input;
}

/** Validate one canonical Target entry. Strings from a manual percent input are
 * percentage points; spreadsheet fractions are handled by normalizeRows above. */
export function normalizeTargetCommission(input, context = {}) {
  if (!object(input)) fail('INVALID_TARGET_RECORD', 'Target记录格式无效。');
  if (context.strictRequired) validateTargetCommissionInput(input, context);
  const creatorId = normalizeCreator(input.creatorId), groupName = text(input.groupName), scope = normalizeScope(input.scope, creatorId, groupName);
  if (scope === 'creator' && !creatorId) fail('TARGET_CREATOR_REQUIRED', '指定达人时需要填写达人ID。');
  if (scope === 'group' && !groupName && !creatorId) fail('TARGET_GROUP_REQUIRED', '未指定达人ID的群组记录需要群组名称，例如老达人；不能假定它属于所有达人。');
  const sku = text(input.sku), productId = identifier(input.productId, '产品PID');
  if (!sku && !productId) fail('TARGET_PRODUCT_REQUIRED', '请填写商品SKU或产品PID。');
  const commissionRate = parseCommissionRate(input.commissionRate);
  if (commissionRate === null) fail('INVALID_TARGET_RATE', 'Target佣金率请填写0到100之间的百分数。');
  const expiresOn = parseDate(input.expiresOn, context.dateFormat || 'dmy');
  const expiryOriginal = text(input.expiryOriginal || (!validDate(expiresOn) ? input.expiresOn : ''));
  const expiryConfirmed = validDate(expiresOn) && (input.expiryConfirmed === undefined || text(input.expiryConfirmed) === '' ? true : bool(input.expiryConfirmed));
  const remindDays = input.remindDays == null || text(input.remindDays) === '' ? null : optionalNumber(input.remindDays);
  if (input.remindDays != null && text(input.remindDays) !== '' && remindDays === null) fail('INVALID_TARGET_REMINDER', '提前提醒天数必须为数字；只有留空才使用全局设置。');
  if (remindDays !== null && (!Number.isInteger(remindDays) || remindDays < 0 || remindDays > 365)) fail('INVALID_TARGET_REMINDER', '提前提醒天数应为0到365之间的整数，留空使用全局设置。');
  const suppliedStatus = text(input.status).toLowerCase();
  const status = !suppliedStatus || ['active', '启用', '生效'].includes(suppliedStatus) ? 'active' : ['archived', '归档', '已归档'].includes(suppliedStatus) ? 'archived' : '';
  if (!status) fail('INVALID_TARGET_STATUS', 'Target记录状态请填写启用或已归档。');
  const at = context.at || context.importedAt || input.updatedAt || new Date().toISOString();
  return { id: text(input.id), scope, creatorId, groupName: scope === 'group' ? groupName : '', sku, productId, commissionRate, expiresOn: validDate(expiresOn) ? expiresOn : '', expiryOriginal, expiryConfirmed, remindDays, notes: text(input.notes), sourceText: text(input.sourceText), sourceFile: text(input.sourceFile || context.sourceName || context.fileName), sourceRow: input.sourceRow || context.sourceRow || null, creatorReviewRequired: !!creatorId && bool(input.creatorReviewRequired), productReviewRequired: !productId && bool(input.productReviewRequired), candidateProductIds: unique((Array.isArray(input.candidateProductIds) ? input.candidateProductIds : text(input.candidateProductIds).split(/[,，;；\n|]+/)).map(text)), status, createdAt: input.createdAt || at, updatedAt: at };
}
function targetNaturalKey(row, catalog) {
  const resolved = catalog ? targetProduct(row, catalog).productId : '';
  return stableKey(row.scope, row.creatorId, row.groupName, row.productId || resolved || text(row.sku).toLowerCase(), row.commissionRate, row.expiresOn || text(row.expiryOriginal));
}
function comparableTarget(row) { return JSON.stringify(Object.fromEntries(Object.entries(row).filter(([key]) => !['id', 'createdAt', 'updatedAt', 'sourceFile', 'sourceRow'].includes(key)).sort(([a], [b]) => a.localeCompare(b)))); }

export function mergeTargetCommissions(state, records, context = {}) {
  if (!object(state) || !Array.isArray(records)) fail('INVALID_TARGET_IMPORT', 'Target导入内容无效。');
  const targets = [...(state.targetCommissions || [])], summary = importSummary(context), catalog = productCatalog(state, ledgerOf(state));
  const seen = new Set();
  for (const input of records) {
    try {
      let record = normalizeTargetCommission(input, context);
      const natural = targetNaturalKey(record, catalog);
      let matches = record.id ? targets.map((row, index) => row.id === record.id ? index : -1).filter(index => index >= 0) : targets.map((row, index) => targetNaturalKey(row, catalog) === natural ? index : -1).filter(index => index >= 0);
      if (matches.length > 1) fail('AMBIGUOUS_TARGET_RECORD', '这条Target安排匹配多条旧记录，请保留唯一记录ID后再更新。');
      const index = matches[0] ?? -1, existing = targets[index];
      if (existing && !record.id) {
        // A repeated arrangement without its export ID does not erase manual
        // notes, resolved identities or a deliberately archived status.
        const supplied = Object.fromEntries(Object.entries(input).filter(([, value]) => value != null && text(value) !== ''));
        record = normalizeTargetCommission({ ...existing, ...supplied, status: existing.status }, context);
      }
      const id = record.id || existing?.id || `target:${natural}`;
      if (seen.has(id)) summary.duplicateRows++;
      seen.add(id); record.id = id;
      if (existing && comparableTarget(existing) === comparableTarget(record)) { summary.unchanged++; continue; }
      if (existing) { targets[index] = { ...record, createdAt: existing.createdAt || record.createdAt }; summary.updated++; }
      else { targets.push(record); summary.added++; }
      summary.acceptedRows++;
    } catch (error) { summary.rejected++; summary.warnings.push(error.message); }
  }
  summary.warnings = unique(summary.warnings);
  if (!summary.added && !summary.updated) return { state, summary };
  return { state: { ...state, targetCommissions: targets, imports: [...(state.imports || []), logEntry('targetCommissions', context, summary)] }, summary };
}

export function setTargetCommissionArchived(state, id, archived, options = {}) {
  const target = (state.targetCommissions || []).find(record => record.id === id);
  if (!target) fail('TARGET_NOT_FOUND', '未找到这条Target安排，请刷新后重试。');
  return mergeTargetCommissions(state, [{ ...target, status: archived ? 'archived' : 'active' }], { ...options, strictRequired: false, sourceName: archived ? '手动归档Target' : '恢复Target' });
}
/** Delete exactly one current arrangement; storage owns the one-step undo.
 * Keep all other business collections and prior import history untouched. */
export function deleteTargetCommission(state, id, options = {}) {
  if (!object(state) || state.targetCommissions !== undefined && !Array.isArray(state.targetCommissions)) fail('INVALID_TARGET_COLLECTION', 'Target记录格式不正确，请刷新后重试。');
  if (typeof id !== 'string' || !text(id)) fail('TARGET_ID_REQUIRED', '缺少Target记录ID，未删除任何安排。');
  const targets = state.targetCommissions || [], matches = targets.map((record, index) => record?.id === id ? index : -1).filter(index => index >= 0);
  if (!matches.length) fail('TARGET_NOT_FOUND', '这条Target安排已删除或不存在，请刷新后重试。');
  if (matches.length !== 1) fail('AMBIGUOUS_TARGET_RECORD', '这个记录ID对应多条Target安排，未执行删除，请先核对记录ID。');
  const index = matches[0], current = targets[index];
  if (options.expectedRecord !== undefined && (!object(options.expectedRecord) || options.expectedRecord.id !== id || JSON.stringify(options.expectedRecord) !== JSON.stringify(current))) fail('TARGET_CHANGED', '这条Target安排在确认期间已更新，请取消并重新选择后核对。');
  return { state: { ...state, targetCommissions: targets.filter((_, position) => position !== index) }, summary: { deleted: 1, deletedId: id } };
}
export function updateCommissionSettings(state, patch, options = {}) {
  const days = optionalNumber(patch?.targetCommissionReminderDays);
  if (!Number.isInteger(days) || days < 0 || days > 365) fail('INVALID_TARGET_REMINDER', '提前提醒天数应为0到365之间的整数。');
  if (state.settings?.targetCommissionReminderDays === days) return { state, summary: { updated: 0, unchanged: 1 } };
  return { state: { ...state, settings: { ...state.settings, targetCommissionReminderDays: days } }, summary: { updated: 1, unchanged: 0 } };
}

function latestRate(rows, key) {
  const supplied = rows.filter(row => row[key] != null), dated = supplied.filter(row => row.createdAt), latest = dated.map(row => row.createdAt).sort().at(-1) || '';
  const latestRows = latest ? dated.filter(row => row.createdAt === latest) : [];
  const latestRates = unique(latestRows.map(row => row[key])).sort((a, b) => a - b);
  const rates = unique(supplied.map(row => row[key])).sort((a, b) => a - b);
  const history = rates.map(rate => { const observations = supplied.filter(row => row[key] === rate), dates = observations.map(row => row.createdAt).filter(Boolean).sort(); return { rate, firstOrderDate: dates[0] || '', lastOrderDate: dates.at(-1) || '', orderCount: unique(observations.map(row => row.orderId)).length }; });
  return { value: latestRates.length === 1 ? latestRates[0] : null, latestRates, observedAt: latest, rates, history, conflict: latestRates.length > 1 };
}
function currencyAmounts(rows) {
  return unique(rows.map(row => row.currency || '未提供')).sort().map(currency => {
    const group = rows.filter(row => (row.currency || '未提供') === currency);
    return { currency, ...Object.fromEntries(amountFields.map(key => { const values = group.map(row => row[key]).filter(value => value != null); return [key, values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) * 100) / 100 : null]; })) };
  });
}
function todayInClientTimezone() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function productCatalog(state, ledger) {
  const mappings = [...(state.productMappings || []), ...(ledger.skus || [])];
  const names = new Map((ledger.products || []).map(item => [item.productId, item.productName]));
  for (const row of state.productMappings || []) if (row.productId && row.productName) names.set(row.productId, row.productName);
  return { mappings, names };
}
function representativeSkus(state, catalog, rows) {
  const candidates = new Map();
  for (const row of [...catalog.mappings, ...rows]) {
    const productId = text(row.productId), sku = text(row.sku);
    if (!productId || !sku) continue;
    if (!candidates.has(productId)) candidates.set(productId, new Set());
    candidates.get(productId).add(sku);
  }
  return new Map([...candidates].map(([productId, values]) => {
    const preferred = text(state.settings?.representativeSkus?.[productId]);
    const sorted = [...values].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }) || a.localeCompare(b, 'en'));
    return [productId, values.has(preferred) ? preferred : sorted[0]];
  }));
}
function targetProduct(record, catalog) {
  if (record.productId) return { productId: record.productId, productName: catalog.names.get(record.productId) || '', productMatch: 'provided', candidateProductIds: record.candidateProductIds || [] };
  if (record.productReviewRequired) return { productId: '', productName: '', productMatch: 'ambiguous', candidateProductIds: record.candidateProductIds || [] };
  const sku = text(record.sku).toLowerCase();
  const exact = catalog.mappings.filter(row => text(row.sku).toLowerCase() === sku || text(row.skuId).toLowerCase() === sku);
  // A bare product-family label may resolve only when every simple variant has
  // one PID. Bundles and compound SKU names never contribute a guessed PID.
  const family = /^[a-z]+\d+$/i.test(sku) ? catalog.mappings.filter(row => {
    const candidate = text(row.sku).toLowerCase();
    return candidate.startsWith(`${sku}-`) && /^[a-z0-9]+$/i.test(candidate.slice(sku.length + 1));
  }) : [];
  const candidates = unique((family.length ? [...exact, ...family] : exact).map(row => text(row.productId)));
  return candidates.length === 1 ? { productId: candidates[0], productName: catalog.names.get(candidates[0]) || '', productMatch: 'matched', candidateProductIds: candidates } : { productId: '', productName: '', productMatch: candidates.length > 1 ? 'ambiguous' : 'unmatched', candidateProductIds: candidates };
}

export function deriveCommissions(state, options = {}) {
  const ledger = ledgerOf(state), rows = (ledger.rows || []).map(decodeRow), eligible = rows.filter(row => row.status !== 'ineligible' && row.creatorId && row.productId), catalog = productCatalog(state, ledger);
  const representatives = representativeSkus(state, catalog, eligible);
  const groups = new Map(), issues = [];
  for (const row of eligible) { const key = stableKey(row.creatorId, row.productId); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row); }
  let creatorProducts = [...groups].map(([id, records]) => {
    const { creatorId, productId } = records[0], standard = latestRate(records, 'standardRate'), ads = latestRate(records, 'shopAdsRate'), dates = records.map(row => row.createdAt).filter(Boolean).sort(), amountsByCurrency = currencyAmounts(records), singleCurrency = amountsByCurrency.length === 1 ? amountsByCurrency[0] : null;
    if (standard.conflict || ads.conflict) issues.push({ type: 'commissionRateConflict', creatorId, productId, message: '最近同一订单时间出现不同佣金率，已保留全部观察值，未求平均。' });
    if (records.some(row => !row.createdAt && (row.standardRate != null || row.shopAdsRate != null))) issues.push({ type: 'commissionDateMissing', creatorId, productId, message: '部分佣金观察没有有效订单时间，已保留历史费率，但不能用来确定最近费率。' });
    return { id, creatorId, productId, productName: catalog.names.get(productId) || '', representativeSku: representatives.get(productId) || '', skus: unique(records.map(row => row.sku)), skuIds: unique(records.map(row => row.skuId)), orderCount: unique(records.map(row => row.orderId)).length, lineCount: records.length, latestStandardRate: standard.value, latestStandardRates: standard.latestRates, latestStandardObservedAt: standard.observedAt, standardRates: standard.rates, standardRateHistory: standard.history, standardRateConflict: standard.conflict, latestShopAdsRate: ads.value, latestShopAdsRates: ads.latestRates, latestShopAdsObservedAt: ads.observedAt, shopAdsRates: ads.rates, shopAdsRateHistory: ads.history, shopAdsRateConflict: ads.conflict, currency: singleCurrency?.currency || '', ...Object.fromEntries(amountFields.map(key => [key, singleCurrency?.[key] ?? null])), amountsByCurrency, firstOrderDate: dates[0] || '', lastOrderDate: dates.at(-1) || '' };
  }).sort((a, b) => a.creatorId.localeCompare(b.creatorId) || a.productId.localeCompare(b.productId));
  const byCreator = Object.create(null);
  for (const product of creatorProducts) { const group = byCreator[product.creatorId] ||= { creatorId: product.creatorId, products: [], productCount: 0, orderCount: 0 }; group.products.push(product); group.productCount++; }
  for (const group of Object.values(byCreator)) group.orderCount = unique(eligible.filter(row => row.creatorId === group.creatorId).map(row => row.orderId)).length;
  const dates = eligible.map(row => row.createdAt).filter(Boolean).sort();
  const summary = { storedRows: rows.length, eligibleRows: eligible.length, ineligibleRows: rows.filter(row => row.status === 'ineligible').length, creatorCount: Object.keys(byCreator).length, productCount: unique(eligible.map(row => row.productId)).length, creatorProductCount: creatorProducts.length, firstOrderDate: dates[0] || '', lastOrderDate: dates.at(-1) || '', importCount: (ledger.sources || []).length };
  const today = options.today || todayInClientTimezone();
  if (!validDate(today)) fail('INVALID_TARGET_TODAY', '提醒参考日期必须为有效的YYYY-MM-DD日期。');
  const configuredDays = Number(state.settings?.targetCommissionReminderDays), defaultReminderDays = Number.isInteger(configuredDays) && configuredDays >= 0 && configuredDays <= 365 ? configuredDays : 30;
  const knownCreators = new Set(options.creatorIds || unique([...(state.creators || []).map(row => normalizeCreator(row.creatorId)), ...(state.samples || []).map(row => normalizeCreator(row.creatorId)), ...eligible.map(row => row.creatorId)]));
  let targets = (state.targetCommissions || []).map(raw => {
    const record = { ...raw }, product = targetProduct(record, catalog), creatorMatch = record.creatorId ? !record.creatorReviewRequired && knownCreators.has(record.creatorId) ? 'matched' : 'unmatched' : record.scope === 'group' ? 'group' : 'unspecified';
    const daysRemaining = record.expiryConfirmed && validDate(record.expiresOn) ? Math.round((Date.parse(`${record.expiresOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000) : null;
    const reminderDays = Number.isInteger(record.remindDays) && record.remindDays >= 0 && record.remindDays <= 365 ? record.remindDays : defaultReminderDays;
    const expiryStatus = record.status === 'archived' ? 'archived' : daysRemaining === null ? 'needs_confirmation' : daysRemaining < 0 ? 'expired' : daysRemaining === 0 ? 'due_today' : daysRemaining <= reminderDays ? 'expiring' : 'active';
    const reviewIssues = [];
    if (creatorMatch === 'unmatched') reviewIssues.push('达人ID未与已有档案或联盟订单精确匹配，请核对账号；未进行模糊匹配。');
    if (creatorMatch === 'unspecified') reviewIssues.push('尚未指定达人或群组，这条安排不会分摊到每位达人。');
    if (product.productMatch === 'ambiguous') reviewIssues.push('SKU对应多个可能的PID，请明确选择产品。');
    if (product.productMatch === 'unmatched') reviewIssues.push('尚未匹配产品PID，原SKU已保留。');
    if (daysRemaining === null) reviewIssues.push('到期日期或年份尚待确认，未猜测到期时间。');
    return { ...record, ...product, expiryStatus, daysRemaining, reminderDays, creatorMatch, reviewIssues, displayCreator: record.creatorId ? `@${record.creatorId}` : record.scope === 'group' ? record.groupName : '未指定达人' };
  });
  const statusOrder = { expired: 0, due_today: 1, expiring: 2, needs_confirmation: 3, active: 4, archived: 5 };
  targets.sort((a, b) => statusOrder[a.expiryStatus] - statusOrder[b.expiryStatus] || (a.daysRemaining ?? Infinity) - (b.daysRemaining ?? Infinity) || a.displayCreator.localeCompare(b.displayCreator));
  const targetStats = { total: targets.length, active: targets.filter(row => row.status !== 'archived').length, archived: targets.filter(row => row.status === 'archived').length, expired: targets.filter(row => row.expiryStatus === 'expired').length, dueToday: targets.filter(row => row.expiryStatus === 'due_today').length, expiring: targets.filter(row => row.expiryStatus === 'expiring').length, needsConfirmation: targets.filter(row => row.expiryStatus === 'needs_confirmation').length, reviewCount: targets.filter(row => row.status !== 'archived' && row.reviewIssues.length).length, defaultReminderDays };
  if (options.creatorId) { const id = normalizeCreator(options.creatorId); creatorProducts = creatorProducts.filter(row => row.creatorId === id); targets = targets.filter(row => row.creatorId === id); }
  return { creatorProducts, byCreator, targets, targetStats, summary, issues, today };
}

/** Server-facing optional-collection validation. It does not add defaults or
 * rewrite historical state, and accepts ordinary workspaces without this feature. */
export function validateCommissionState(state) {
  if (!object(state)) fail('INVALID_COMMISSION_STATE', '佣金工作台数据格式无效。');
  if (state.affiliateCommissionLedger !== undefined) {
    const ledger = state.affiliateCommissionLedger;
    if (!object(ledger) || ledger.version !== 1 || !Array.isArray(ledger.rows) || ledger.rows.length > 150000) fail('INVALID_COMMISSION_LEDGER', '联盟佣金记录格式或数量无效。');
    for (const values of ledger.rows) {
      if (!Array.isArray(values) || values.length < 5 || values.length > affiliateCommissionColumns.length) fail('INVALID_COMMISSION_ROW', '联盟佣金中存在无效订单行。');
      for (let index = 0; index < values.length; index++) {
        const value = values[index];
        if (numericColumnIndexes.includes(index)) { if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) fail('INVALID_COMMISSION_NUMBER', '联盟佣金中存在无效数字。'); }
        else if (value !== null && typeof value !== 'string') fail('INVALID_COMMISSION_TEXT', '联盟佣金中的ID与文字必须保留为文本。');
      }
      const row = decodeRow(values);
      if (!orderKey(row) || !row.status) fail('INVALID_COMMISSION_ROW', '联盟订单缺少ID或状态。');
      if (rateFields.some(key => row[key] != null && (row[key] < 0 || row[key] > 100))) fail('INVALID_COMMISSION_RATE', '联盟佣金率必须介于0与100。');
    }
    for (const name of ['products', 'skus', 'sources']) if (!Array.isArray(ledger[name]) || ledger[name].length > 150000 || ledger[name].some(value => !object(value))) fail('INVALID_COMMISSION_CATALOG', '联盟佣金来源或商品目录格式无效。');
  }
  if (state.targetCommissions !== undefined) {
    if (!Array.isArray(state.targetCommissions) || state.targetCommissions.length > 150000) fail('INVALID_TARGET_COLLECTION', 'Target记录格式或数量无效。');
    const seen = new Set();
    for (const record of state.targetCommissions) {
      if (!object(record) || !text(record.id) || seen.has(record.id) || !targetScopes.includes(record.scope) || !targetStatuses.includes(record.status)) fail('INVALID_TARGET_RECORD', 'Target记录ID、对象类型或状态无效。');
      seen.add(record.id);
      if (typeof record.commissionRate !== 'number' || parseCommissionRate(record.commissionRate) === null) fail('INVALID_TARGET_RATE', 'Target佣金率无效。');
      if (!text(record.productId) && !text(record.sku)) fail('TARGET_PRODUCT_REQUIRED', 'Target记录缺少商品。');
      if (record.scope === 'creator' && !text(record.creatorId) || record.scope === 'group' && !text(record.creatorId) && !text(record.groupName)) fail('TARGET_CREATOR_REQUIRED', 'Target记录缺少指定达人或群组。');
      if (record.expiryConfirmed && !validDate(record.expiresOn)) fail('INVALID_TARGET_EXPIRY', '已确认的Target到期日期无效。');
      if (record.remindDays != null && (!Number.isInteger(record.remindDays) || record.remindDays < 0 || record.remindDays > 365)) fail('INVALID_TARGET_REMINDER', 'Target提前提醒天数无效。');
    }
  }
  return state;
}
