/** Keep negotiated Target arrangements private to authenticated administrators. */
export function visibleWorkbenchSnapshot(snapshot, user) {
  if (user?.role === 'admin') return snapshot;
  const state = { ...(snapshot?.state || {}) };
  delete state.targetCommissions;
  if (state.settings && typeof state.settings === 'object') {
    state.settings = { ...state.settings };
    delete state.settings.targetCommissionReminderDays;
  }
  if (Array.isArray(state.imports)) {
    state.imports = state.imports.filter(entry => entry?.type !== 'targetCommissions' && entry?.privateToAdmin !== true);
  }
  return { ...snapshot, state };
}
