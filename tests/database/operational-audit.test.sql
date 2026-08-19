\set ON_ERROR_STOP on

create role audit_reader_test login;
create role audit_unauthorized_test login;
grant lex_audit_reader to audit_reader_test;

do $test$
begin
  if pg_catalog.has_table_privilege(
    'audit_reader_test', 'private.publication_events', 'SELECT'
  ) or pg_catalog.has_table_privilege(
    'audit_reader_test', 'private.legislative_update_events', 'SELECT'
  ) or pg_catalog.has_table_privilege(
    'audit_reader_test', 'private.source_catalog_events', 'SELECT'
  ) or pg_catalog.has_table_privilege(
    'audit_reader_test', 'private.source_check_events', 'SELECT'
  ) then
    raise exception 'audit reader unexpectedly has a direct table grant';
  end if;
end
$test$;

set session authorization audit_reader_test;

do $test$
declare
  v_admin_id uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  v_projection jsonb;
  v_publication_sequence bigint;
  v_update_sequence bigint;
  v_catalog_sequence bigint;
  v_check_sequence bigint;
  v_detail jsonb;
begin
  if (select pg_catalog.count(*) from private.list_publication_audit_events(
    v_admin_id, null, '2100-01-01T00:00:00Z', 200
  )) = 0 then
    raise exception 'publication audit projection is empty';
  end if;
  if (select pg_catalog.count(*) from private.list_legislative_update_audit_events(
    v_admin_id, null, '2100-01-01T00:00:00Z', 200
  )) = 0 then
    raise exception 'legislative update audit projection is empty';
  end if;
  if (select pg_catalog.count(*) from private.list_source_catalog_audit_events(
    v_admin_id, null, '2100-01-01T00:00:00Z', 200
  )) = 0 then
    raise exception 'source catalog audit projection is empty';
  end if;
  if (select pg_catalog.count(*) from private.list_source_check_audit_events(
    v_admin_id, null, '2100-01-01T00:00:00Z', 200
  )) = 0 then
    raise exception 'source check audit projection is empty';
  end if;

  select projected.event_sequence, pg_catalog.to_jsonb(projected) into v_publication_sequence, v_projection
  from private.list_publication_audit_events(
    v_admin_id, null, '2100-01-01T00:00:00Z', 1
  ) as projected;
  if v_projection ?| array[
    'actor_user_id', 'manifest_digest', 'git_commit_sha', 'failure_code', 'detail_code'
  ] then
    raise exception 'safe audit projection exposed internal detail';
  end if;
  if not (v_projection ?& array[
    'event_sequence', 'occurred_at', 'event_level', 'event_module', 'event_origin',
    'event_code', 'display_message', 'actor_role', 'law_id', 'correlation_id'
  ]) then
    raise exception 'safe audit projection omitted required fields';
  end if;

  select projected.event_sequence into v_update_sequence
  from private.list_legislative_update_audit_events(
    v_admin_id, null, '2100-01-01T00:00:00Z', 1
  ) as projected;
  select projected.event_sequence into v_catalog_sequence
  from private.list_source_catalog_audit_events(
    v_admin_id, null, '2100-01-01T00:00:00Z', 1
  ) as projected;
  select projected.event_sequence into v_check_sequence
  from private.list_source_check_audit_events(
    v_admin_id, null, '2100-01-01T00:00:00Z', 1
  ) as projected;

  select pg_catalog.to_jsonb(detail) into v_detail
  from private.get_publication_audit_event(v_admin_id, v_publication_sequence) as detail;
  if not (v_detail ?& array['manifest_digest', 'git_commit_sha', 'failure_code']) then
    raise exception 'publication audit detail omitted redacted evidence fields';
  end if;

  select pg_catalog.to_jsonb(detail) into v_detail
  from private.get_legislative_update_audit_event(v_admin_id, v_update_sequence) as detail;
  if not (v_detail ?& array[
    'base_normative_sha256', 'candidate_normative_sha256', 'detail_code'
  ]) then
    raise exception 'legislative update audit detail omitted redacted evidence fields';
  end if;

  select pg_catalog.to_jsonb(detail) into v_detail
  from private.get_source_catalog_audit_event(v_admin_id, v_catalog_sequence) as detail;
  if not (v_detail ?& array[
    'source_catalog_entity_type', 'provider_revision_id', 'binding_revision_id', 'detail_code'
  ]) then
    raise exception 'source catalog audit detail omitted redacted evidence fields';
  end if;

  select pg_catalog.to_jsonb(detail) into v_detail
  from private.get_source_check_audit_event(v_admin_id, v_check_sequence) as detail;
  if not (v_detail ?& array['binding_revision_id', 'detail_code']) then
    raise exception 'source check audit detail omitted redacted evidence fields';
  end if;

  begin
    perform * from private.list_publication_audit_events(
      '44444444-4444-4444-8444-444444444444', null, pg_catalog.now(), 10
    );
    raise exception 'non-administrator unexpectedly read audit events';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform * from private.list_publication_audit_events(v_admin_id, -1, pg_catalog.now(), 10);
    raise exception 'invalid cursor unexpectedly succeeded';
  exception
    when invalid_parameter_value then null;
  end;
  begin
    perform * from private.list_publication_audit_events(v_admin_id, null, pg_catalog.now(), 201);
    raise exception 'oversized page unexpectedly succeeded';
  exception
    when invalid_parameter_value then null;
  end;
  begin
    perform * from private.list_publication_audit_events(
      v_admin_id, null, pg_catalog.now(), null
    );
    raise exception 'null page bounds unexpectedly succeeded';
  exception
    when invalid_parameter_value then null;
  end;
  begin
    perform * from private.get_publication_audit_event(v_admin_id, -1);
    raise exception 'invalid detail sequence unexpectedly succeeded';
  exception
    when invalid_parameter_value then null;
  end;

  begin
    execute 'select * from private.publication_events';
    raise exception 'audit reader unexpectedly selected the private event table';
  exception
    when insufficient_privilege then null;
  end;
  begin
    execute $sql$insert into private.publication_events (
      publication_id, event_type
    ) values ('11111111-1111-4111-8111-111111111111', 'failed')$sql$;
    raise exception 'audit reader unexpectedly appended an event directly';
  exception
    when insufficient_privilege then null;
  end;
end
$test$;

reset session authorization;
set session authorization audit_unauthorized_test;

do $test$
begin
  begin
    perform * from private.list_publication_audit_events(
      'aaaaaaaa-0000-4000-8000-000000000001', null, pg_catalog.now(), 10
    );
    raise exception 'unauthorized identity unexpectedly reached audit projection';
  exception
    when insufficient_privilege then null;
  end;
end
$test$;

reset session authorization;
