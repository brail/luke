-- Add cleanup tracking fields to FileObject
ALTER TABLE "file_objects" ADD COLUMN "cleanupStatus" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "file_objects" ADD COLUMN "cleanupAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "file_objects" ADD COLUMN "lastCleanupAt" DATETIME;

-- CreateTable UserGrantedPermission
CREATE TABLE "user_granted_permissions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "grantedBy" TEXT,
    "reason" TEXT,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "user_granted_permissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE,
    CONSTRAINT "user_granted_permissions_grantedBy_fkey" FOREIGN KEY ("grantedBy") REFERENCES "users" ("id") ON DELETE SET NULL
);

-- CreateTable PermissionAudit
CREATE TABLE "permission_audits" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permission" TEXT,
    "oldRole" TEXT,
    "newRole" TEXT,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "permission_audits_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users" ("id") ON DELETE SET NULL,
    CONSTRAINT "permission_audits_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "user_granted_permissions_userId_permission_key" ON "user_granted_permissions"("userId", "permission");

-- CreateIndex
CREATE INDEX "user_granted_permissions_userId_idx" ON "user_granted_permissions"("userId");

-- CreateIndex
CREATE INDEX "user_granted_permissions_permission_idx" ON "user_granted_permissions"("permission");

-- CreateIndex
CREATE INDEX "user_granted_permissions_expiresAt_idx" ON "user_granted_permissions"("expiresAt");

-- CreateIndex
CREATE INDEX "permission_audits_action_createdAt_idx" ON "permission_audits"("action", "createdAt");

-- CreateIndex
CREATE INDEX "permission_audits_userId_idx" ON "permission_audits"("userId");

-- CreateIndex
CREATE INDEX "permission_audits_actorId_idx" ON "permission_audits"("actorId");

-- CreateIndex for FileObject cleanup tracking
CREATE INDEX "file_objects_cleanupStatus_idx" ON "file_objects"("cleanupStatus");
