const stringifyForLog = (value: unknown): string => {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};

/** 情報ログを統一形式で出力する。 */
export const logInfo = (context: string, message: unknown): void => {
  console.log(`[INFO][${context}] ${stringifyForLog(message)}`);
};

/** エラーログを統一形式で出力する。 */
export const logError = (context: string, error: unknown): void => {
  const detail = error instanceof Error && error.stack ? error.stack : stringifyForLog(error);
  console.error(`[ERROR][${context}] ${detail}`);
};
