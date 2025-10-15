export const norm = (s='') => s.trim().toLowerCase().replace(/\s+/g,' ');
export const normalizeWorkCode = (raw='') => {
  const d = raw.replace(/\D/g,'');
  if (d.length !== 8) return null;
  const f = `${d.slice(0,3)}-${d.slice(3,7)}-${d.slice(7)}`;
  return /^\d{3}-\d{4}-\d$/.test(f) ? f : null;
};
