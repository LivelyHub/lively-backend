CREATE TABLE "revoked_tokens" (
	"jti" uuid PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exercise_logs" ADD COLUMN "photo_url" text;--> statement-breakpoint
ALTER TABLE "medication_logs" ADD COLUMN "photo_url" text;