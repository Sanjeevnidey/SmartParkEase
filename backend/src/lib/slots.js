// A lot with `total` spots has spot ids in rows of ten: A-01 ... A-10, B-01 ... and so on.
// Spot ids are derived, not stored, so they always match the lot's capacity.
const ROW_SIZE = 10;

function rowLabel(index) {
  let label = '';
  let n = index;
  do { label = String.fromCharCode(65 + (n % 26)) + label; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return label;
}

function slotIds(total) {
  return Array.from({ length: total }, (_, i) => `${rowLabel(Math.floor(i / ROW_SIZE))}-${String((i % ROW_SIZE) + 1).padStart(2, '0')}`);
}

function slotIndex(slot) {
  const match = /^([A-Z]+)-(\d{2})$/.exec(String(slot));
  if (!match) return -1;
  let row = 0;
  for (const ch of match[1]) row = row * 26 + (ch.charCodeAt(0) - 64);
  const col = Number(match[2]);
  if (col < 1 || col > ROW_SIZE) return -1;
  return (row - 1) * ROW_SIZE + (col - 1);
}

function isValidSlot(slot, total) {
  const i = slotIndex(slot);
  return i >= 0 && i < total;
}

module.exports = { ROW_SIZE, slotIds, slotIndex, isValidSlot };
