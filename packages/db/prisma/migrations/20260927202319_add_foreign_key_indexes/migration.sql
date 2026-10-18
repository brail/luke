-- CreateIndex
CREATE INDEX "backup_records_createdById_idx" ON "backup_records"("createdById");

-- CreateIndex
CREATE INDEX "calendar_event_user_visibilities_grantedBy_idx" ON "calendar_event_user_visibilities"("grantedBy");

-- CreateIndex
CREATE INDEX "calendar_events_templateItemId_idx" ON "calendar_events"("templateItemId");

-- CreateIndex
CREATE INDEX "calendar_events_cancelledByUserId_idx" ON "calendar_events"("cancelledByUserId");

-- CreateIndex
CREATE INDEX "collection_layout_revisions_createdByUserId_idx" ON "collection_layout_revisions"("createdByUserId");

-- CreateIndex
CREATE INDEX "collection_layout_row_revisions_sourceGroupRevisionId_idx" ON "collection_layout_row_revisions"("sourceGroupRevisionId");

-- CreateIndex
CREATE INDEX "collection_layouts_seasonId_idx" ON "collection_layouts"("seasonId");

-- CreateIndex
CREATE INDEX "collection_row_phase_history_recordedByUserId_idx" ON "collection_row_phase_history"("recordedByUserId");

-- CreateIndex
CREATE INDEX "edit_locks_lockedByUserId_idx" ON "edit_locks"("lockedByUserId");

-- CreateIndex
CREATE INDEX "google_event_mappings_companyFunctionId_idx" ON "google_event_mappings"("companyFunctionId");

-- CreateIndex
CREATE INDEX "identities_userId_idx" ON "identities"("userId");

-- CreateIndex
CREATE INDEX "merchandising_plans_seasonId_idx" ON "merchandising_plans"("seasonId");

-- CreateIndex
CREATE INDEX "pricing_parameter_sets_seasonId_idx" ON "pricing_parameter_sets"("seasonId");

-- CreateIndex
CREATE INDEX "vendor_closure_periods_countryCode_idx" ON "vendor_closure_periods"("countryCode");

-- CreateIndex
CREATE INDEX "vendor_closure_periods_sourceHolidayId_idx" ON "vendor_closure_periods"("sourceHolidayId");

-- CreateIndex
CREATE INDEX "vendor_closure_periods_confirmedByUserId_idx" ON "vendor_closure_periods"("confirmedByUserId");
