-- DRAFT, not applied: applied only after the Phase 1 review, together with report_data.sql.
-- Patient details printed on the doctor reports. Report-only: nothing else reads them. The date of birth already
-- exists (settings.child_birth_date, used by growth). Adding nullable columns changes no existing row's meaning.
alter table carb.settings
  add column if not exists report_patient_name text check (report_patient_name is null or length(report_patient_name) <= 80),
  add column if not exists diagnosis_date date,
  add column if not exists clinic_name text check (clinic_name is null or length(clinic_name) <= 120);
