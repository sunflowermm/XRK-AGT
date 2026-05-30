/** @param {unknown} err @returns {Error} */
export function normalizeError(err) {
  return Error.isError(err) ? err : new Error(String(err));
}
