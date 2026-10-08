-- Supabase default privileges may grant service_role all table privileges.
-- Explicitly remove them before allowing reads; only the postgres-owned
-- security-definer decision function may append audit entries through the app.
revoke all on public.course_moderation_audit from service_role;
grant select on public.course_moderation_audit to service_role;
