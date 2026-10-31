/** Configurable, explicitly maintained cooperation willingness. No sales inference. */
import { defaultSettings, deriveData, getWillingnessConfig, normalizeCreator } from './creator-engine.mjs';

export { getWillingnessConfig };

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

/** Validate a settings draft; missing fields retain backward-compatible defaults. */
export function validateWillingnessConfig(settings = {}) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    fail('INVALID_WILLINGNESS_CONFIG', '合作意愿设置格式不正确，请重新设置。');
  }
  const suppliedOptions = settings.willingnessOptions === undefined ? defaultSettings.willingnessOptions : settings.willingnessOptions;
  if (!Array.isArray(suppliedOptions) || !suppliedOptions.length || suppliedOptions.some(value => typeof value !== 'string' || !value.trim())) {
    fail('INVALID_WILLINGNESS_CONFIG', '请至少保留一个合作意愿选项，每个选项都要填写名称。');
  }
  const options = suppliedOptions.map(value => value.trim());
  if (new Set(options).size !== options.length) {
    fail('INVALID_WILLINGNESS_CONFIG', '合作意愿选项名称不能重复。');
  }
  const fallback = options.includes(defaultSettings.defaultWillingness) ? defaultSettings.defaultWillingness : options[0];
  const suppliedDefault = settings.defaultWillingness === undefined ? fallback : settings.defaultWillingness;
  if (typeof suppliedDefault !== 'string' || !options.includes(suppliedDefault.trim())) {
    fail('INVALID_WILLINGNESS_CONFIG', '请选择现有的合作意愿选项作为默认值。');
  }
  return { options, defaultValue: suppliedDefault.trim() };
}

/**
 * Apply one explicit choice to managed creators only. Counts refer to unique
 * normalized creator IDs, not duplicate raw profile rows. Existing references
 * outside the affected profile rows are retained and the input is never mutated.
 */
export function updateCreatorWillingness(state, creatorIds, value, options = {}) {
  if (!state || typeof state !== 'object' || Array.isArray(state) || (state.creators !== undefined && !Array.isArray(state.creators))) {
    fail('INVALID_WILLINGNESS_STATE', '达人数据格式不正确，请刷新后重试。');
  }
  if (!Array.isArray(creatorIds) || !creatorIds.length || creatorIds.some(id => typeof id !== 'string' || !normalizeCreator(id))) {
    fail('INVALID_CREATOR_SELECTION', '请至少勾选一位有效达人，再修改合作意愿。');
  }
  const config = validateWillingnessConfig(state.settings);
  if (typeof value !== 'string' || !config.options.includes(value.trim())) {
    fail('INVALID_WILLINGNESS_OPTION', '请选择规则设置中已有的合作意愿选项。');
  }
  const willingness = value.trim();
  const selected = new Set(creatorIds.map(normalizeCreator));
  const managed = new Map(deriveData(state).creators.map(creator => [creator.creatorId, creator]));
  const unknown = [...selected].filter(id => !managed.has(id));
  if (unknown.length) {
    fail('UNKNOWN_CREATOR_SELECTION', `以下账号尚不在达人管理名单中，本次未修改：${unknown.map(id => `@${id}`).join('、')}。请刷新列表后重新选择。`);
  }
  if (!options || typeof options !== 'object' || Array.isArray(options) || (options.at !== undefined && (typeof options.at !== 'string' || !Number.isFinite(Date.parse(options.at))))) {
    fail('INVALID_WILLINGNESS_TIMESTAMP', '合作意愿更新时间无效，请重试。');
  }
  const at = options.at || new Date().toISOString();
  const found = new Set();
  const changed = new Set();
  const creators = (state.creators || []).map(profile => {
    const id = normalizeCreator(profile.creatorId);
    if (!selected.has(id)) return profile;
    found.add(id);
    const manualFields = Array.isArray(profile.manualFields) ? profile.manualFields : [];
    if (profile.willingness === willingness && profile._manual?.willingness === true && manualFields.includes('willingness')) return profile;
    changed.add(id);
    return {
      ...profile,
      willingness,
      _manual: { ...profile._manual, willingness: true },
      manualFields: [...new Set([...manualFields, 'willingness'])],
      updatedAt: at
    };
  });
  let createdProfiles = 0;
  for (const id of selected) {
    if (found.has(id)) continue;
    // Retain the original admission reason when a sales-qualified creator first
    // acquires a manual profile; real receipt history still takes precedence.
    const origin = managed.get(id).rosterSource === 'salesThreshold' ? { admissionOrigin: 'salesThreshold' } : {};
    creators.push({ creatorId: id, ...origin, willingness, _manual: { willingness: true }, manualFields: ['willingness'], updatedAt: at });
    changed.add(id);
    createdProfiles++;
  }
  return {
    state: changed.size ? { ...state, creators } : state,
    summary: { selected: selected.size, updated: changed.size, unchanged: selected.size - changed.size, createdProfiles }
  };
}
