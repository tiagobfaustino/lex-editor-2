const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
};

export const serializeCanonicalAuditJson = (value: unknown): string =>
  JSON.stringify(canonicalize(value));
