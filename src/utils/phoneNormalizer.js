'use strict';

function normalizePhone(t) {
  if (!t) return '';
  let d = String(t).replace(/\D/g, '');
  if (d.startsWith('0')) d = d.slice(1);
  if (d.length === 10 || d.length === 11) d = '55' + d;
  return d;
}

// Returns true for Brazilian mobile numbers (9-digit local part after DDD)
function isMobilePhone(normalized) {
  if (!normalized) return false;
  // 55 + DDD(2) + 9-digit local = 14 digits, local starts with 9
  const local = normalized.startsWith('55') ? normalized.slice(4) : normalized.slice(2);
  return local.length === 9 && local.startsWith('9');
}

module.exports = { normalizePhone, isMobilePhone };
