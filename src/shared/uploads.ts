import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MultipartFile } from "@fastify/multipart";
import { HttpError } from "./http-errors.js";

// Local disk storage under UPLOAD_DIR (default ./uploads), served back via
// @fastify/static at /uploads/*. Backs the 'photo' log-method enum value,
// which previously had no upload path at all — bot/mobile could claim a log
// was a photo with nothing behind it.
// ponytail: local disk, not S3 — fine for hackathon single-instance deploy.
// Swap for object storage if this ever runs on more than one instance.
export const UPLOAD_DIR = process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads");

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);
const MAX_BYTES = 8 * 1024 * 1024;

export async function saveUploadedPhoto(file: MultipartFile): Promise<string> {
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    throw new HttpError(400, "VALIDATION", "Unsupported file type", { photo: "Must be jpeg, png, webp, or heic" });
  }

  await mkdir(UPLOAD_DIR, { recursive: true });
  const ext = path.extname(file.filename) || ".jpg";
  const filename = `${randomUUID()}${ext}`;
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of file.file) {
    total += chunk.length;
    if (total > MAX_BYTES) {
      throw new HttpError(400, "VALIDATION", "File too large (max 8MB)", { photo: "Exceeds 8MB limit" });
    }
    chunks.push(chunk);
  }

  await writeFile(path.join(UPLOAD_DIR, filename), Buffer.concat(chunks));
  return `/uploads/${filename}`;
}
