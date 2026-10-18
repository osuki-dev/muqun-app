/** `record` without the keys `keep` refuses; the same object when nothing goes. */
export function keepKeys<T>(
  record: Record<string, T>,
  keep: (key: string) => boolean
): Record<string, T> {
  const keys = Object.keys(record);
  if (keys.every(keep)) return record;
  return Object.fromEntries(keys.filter(keep).map((key) => [key, record[key]!]));
}
