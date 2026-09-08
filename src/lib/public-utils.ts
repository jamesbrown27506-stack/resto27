/** PostgREST represents a to-one join as an object; older reads may return arrays. */
export function relationOne<T>(value: T | T[] | null | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value ?? undefined;
}
