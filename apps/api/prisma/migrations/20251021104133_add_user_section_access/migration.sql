-- CreateTable
CREATE TABLE "user_section_access" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "user_section_access_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "user_section_access_userId_section_idx" ON "user_section_access"("userId", "section");

-- CreateIndex
CREATE UNIQUE INDEX "user_section_access_userId_section_key" ON "user_section_access"("userId", "section");
