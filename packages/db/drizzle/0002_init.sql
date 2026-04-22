DROP INDEX "account_providerId_accountId_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "account_providerId_accountId_uidx" ON "account" USING btree ("providerId","accountId");