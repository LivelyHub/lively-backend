import type { ZodError, ZodType } from "zod";

export class HttpError extends Error {
  statusCode: number;
  code: string;
  fields?: Record<string, string>;

  constructor(statusCode: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.fields = fields;
  }
}

function fieldsFromZodError(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_root";
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}

export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new HttpError(400, "VALIDATION", "Invalid request body", fieldsFromZodError(result.error));
  }
  return result.data;
}

function pgErrorCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const record = err as { code?: string; cause?: unknown };
  // Drizzle wraps the underlying pg driver error in a DrizzleQueryError —
  // the real Postgres error code lives on .cause, not the top-level error.
  return record.code ?? pgErrorCode(record.cause);
}

export function isUniqueViolation(err: unknown): boolean {
  return pgErrorCode(err) === "23505";
}
