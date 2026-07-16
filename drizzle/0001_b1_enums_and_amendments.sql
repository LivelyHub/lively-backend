CREATE TYPE "public"."alert_type" AS ENUM('missed_days', 'pain_mention', 'dizziness_mention', 'medication_missed', 'no_response', 'emergency');--> statement-breakpoint
CREATE TYPE "public"."chair_test_source" AS ENUM('chat');--> statement-breakpoint
CREATE TYPE "public"."companion_key" AS ENUM('mbak_asih', 'mas_budi');--> statement-breakpoint
CREATE TYPE "public"."direction" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TYPE "public"."log_method" AS ENUM('reply', 'emoji', 'photo');--> statement-breakpoint
ALTER TABLE "alerts" ALTER COLUMN "type" SET DATA TYPE "public"."alert_type" USING "type"::"public"."alert_type";--> statement-breakpoint
ALTER TABLE "chair_test_results" ALTER COLUMN "source" SET DATA TYPE "public"."chair_test_source" USING "source"::"public"."chair_test_source";--> statement-breakpoint
ALTER TABLE "companions" ALTER COLUMN "key" SET DATA TYPE "public"."companion_key" USING "key"::"public"."companion_key";--> statement-breakpoint
ALTER TABLE "conversations" ALTER COLUMN "direction" SET DATA TYPE "public"."direction" USING "direction"::"public"."direction";--> statement-breakpoint
ALTER TABLE "exercise_logs" ALTER COLUMN "method" SET DATA TYPE "public"."log_method" USING "method"::"public"."log_method";--> statement-breakpoint
ALTER TABLE "medication_logs" ALTER COLUMN "method" SET DATA TYPE "public"."log_method" USING "method"::"public"."log_method";--> statement-breakpoint
ALTER TABLE "elders" ADD COLUMN "paused" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "family_members" ADD COLUMN "password_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "companions" ADD CONSTRAINT "companions_key_unique" UNIQUE("key");--> statement-breakpoint
ALTER TABLE "elders" ADD CONSTRAINT "elders_phone_e164_unique" UNIQUE("phone_e164");