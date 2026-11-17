-- Bloquea UPDATE y DELETE sobre incident_event y audit_log (regla §1.3).
-- TRUNCATE se permite solo al rol owner (para tests y migraciones).
CREATE OR REPLACE FUNCTION reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Tabla % es inmutable (operación % bloqueada).', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_incident_event_immutable ON incident_event;
CREATE TRIGGER trg_incident_event_immutable
  BEFORE UPDATE OR DELETE ON incident_event
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();

DROP TRIGGER IF EXISTS trg_audit_log_immutable ON audit_log;
CREATE TRIGGER trg_audit_log_immutable
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
