const MAX_REDACTED_TEXT_CHARACTERS = 512;

const sensitiveDetectors = [
  /\b(?:authorization|proxy-authorization|cookie|set-cookie|password|passwd|secret|client_secret|token|access_token|refresh_token|api[_-]?key)\b\s*[:=]\s*[^\s,;]+/iu,
  /https?:\/\/\S+[?&](?:x-amz-signature|signature|token|access_token|api[_-]?key|key)=[^\s&]+/iu,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /(?:^|\s)\/(?:home|Users|root|tmp|var|etc|opt)\/[^\s]+/u,
  /(?:^|\s)[A-Za-z]:\\(?:Users|Windows|Temp|Program Files)\\[^\s]+/u,
  /(?:^|\n)\s*at\s+(?:async\s+)?[^\n]+:\d+:\d+/u,
  /<\/?[A-Za-z][^>]{0,255}>/u,
] as const;

const redactors: readonly (readonly [RegExp, string])[] = [
  [
    /\b(?:authorization|proxy-authorization|cookie|set-cookie|password|passwd|secret|client_secret|token|access_token|refresh_token|api[_-]?key)\b\s*[:=]\s*[^\s,;]+/giu,
    '[REDACTED_CREDENTIAL]',
  ],
  [
    /https?:\/\/\S+[?&](?:x-amz-signature|signature|token|access_token|api[_-]?key|key)=[^\s&]+(?:&[^\s]*)?/giu,
    '[REDACTED_SIGNED_URL]',
  ],
  [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gu,
    '[REDACTED_PRIVATE_KEY]',
  ],
  [/(^|\s)\/(?:home|Users|root|tmp|var|etc|opt)\/[^\s]+/gu, '$1[REDACTED_PATH]'],
  [/(^|\s)[A-Za-z]:\\(?:Users|Windows|Temp|Program Files)\\[^\s]+/gu, '$1[REDACTED_PATH]'],
  [/(^|\n)\s*at\s+(?:async\s+)?[^\n]+:\d+:\d+/gu, '$1[REDACTED_STACK]'],
  [/<\/?[A-Za-z][^>]{0,255}>/gu, '[REDACTED_MARKUP]'],
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gu, '[REDACTED_PRIVATE_KEY]'],
];

export const containsSensitiveAuditText = (value: string): boolean =>
  sensitiveDetectors.some((pattern) => pattern.test(value));

export const redactOperationalAuditText = (value: string): string => {
  let redacted = value;
  for (const [pattern, replacement] of redactors) {
    redacted = redacted.replace(pattern, replacement);
  }
  redacted = redacted.trim();
  if (redacted.length === 0) return '[REDACTED]';
  return redacted.length <= MAX_REDACTED_TEXT_CHARACTERS
    ? redacted
    : `${redacted.slice(0, MAX_REDACTED_TEXT_CHARACTERS - 1)}…`;
};

export const redactOperationalAuditError = (
  error: unknown,
): Readonly<{ code: 'internal_error'; message: string }> => {
  void error;
  return Object.freeze({
    code: 'internal_error',
    message: 'Falha interna não detalhada.',
  });
};
