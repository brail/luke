-- CreateTable
CREATE TABLE "dashboard_configs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "widgets" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dashboard_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboard_tasks" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "dueDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dashboard_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dashboard_configs_userId_key" ON "dashboard_configs"("userId");

-- CreateIndex
CREATE INDEX "dashboard_tasks_userId_createdAt_idx" ON "dashboard_tasks"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "dashboard_configs" ADD CONSTRAINT "dashboard_configs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboard_tasks" ADD CONSTRAINT "dashboard_tasks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
