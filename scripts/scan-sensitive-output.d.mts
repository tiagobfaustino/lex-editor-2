export type SensitiveOutputViolation = Readonly<{
  rule: string;
  path: string;
}>;

export type SensitivePattern = Readonly<{
  pattern: RegExp;
  rule: string;
}>;

export const SENSITIVE_CONTENT_PATTERNS: readonly SensitivePattern[];
export const PRIVATE_PATH_PATTERNS: readonly SensitivePattern[];

export function scanSensitiveOutput(inputPaths: readonly string[]): Promise<
  Readonly<{
    scannedFiles: number;
    violations: readonly SensitiveOutputViolation[];
  }>
>;
