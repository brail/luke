-- Add rowversion indexes for efficient incremental sync filtering
-- These indexes speed up sync queries that filter by navRowversion > lastSync
-- Used in: portafoglio-pg-query.ts incremental upsert patterns

-- Sales Header / Line tables (frequently synced)
CREATE INDEX "nav_pf_sales_header_navRowversion_idx" ON "nav_pf_sales_header"("navRowversion");
CREATE INDEX "nav_pf_sales_line_navRowversion_idx" ON "nav_pf_sales_line"("navRowversion");
CREATE INDEX "nav_pf_sales_header_ext_navRowversion_idx" ON "nav_pf_sales_header_ext"("navRowversion");

-- Master data (Item, Customer, Vendor, etc.)
CREATE INDEX "nav_pf_item_navRowversion_idx" ON "nav_pf_item"("navRowversion");
CREATE INDEX "nav_pf_customer_navRowversion_idx" ON "nav_pf_customer"("navRowversion");
CREATE INDEX "nav_pf_ship_to_address_navRowversion_idx" ON "nav_pf_ship_to_address"("navRowversion");
CREATE INDEX "nav_pf_vendor_navRowversion_idx" ON "nav_pf_vendor"("navRowversion");

-- Lookup tables (Salesperson, GeoZone, ShipmentMethod, etc.)
CREATE INDEX "nav_pf_salesperson_navRowversion_idx" ON "nav_pf_salesperson"("navRowversion");
CREATE INDEX "nav_pf_geo_zone_navRowversion_idx" ON "nav_pf_geo_zone"("navRowversion");
CREATE INDEX "nav_pf_shipment_method_navRowversion_idx" ON "nav_pf_shipment_method"("navRowversion");
CREATE INDEX "nav_pf_transport_reason_navRowversion_idx" ON "nav_pf_transport_reason"("navRowversion");
CREATE INDEX "nav_pf_variable_code_navRowversion_idx" ON "nav_pf_variable_code"("navRowversion");
CREATE INDEX "nav_pf_budget_header_navRowversion_idx" ON "nav_pf_budget_header"("navRowversion");
