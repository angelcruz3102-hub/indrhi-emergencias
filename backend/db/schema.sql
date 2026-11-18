create or replace function was_inside_at(d device, p_at timestamptz)
returns boolean language sql immutable as $$
  select
    case
      when d.last_entered_at is null then
        d.presence_state = 'DENTRO'
      when d.presence_source = 'QR' then
        d.last_entered_at <= p_at
        and (d.qr_expires_at is null or d.qr_expires_at >= p_at)
        and (d.last_left_at is null or d.last_left_at < d.last_entered_at or d.last_left_at > p_at)
      else
        d.last_entered_at <= p_at
        and (d.last_left_at is null or d.last_left_at < d.last_entered_at or d.last_left_at > p_at)
    end
$$;

create or replace function resolve_alert_audience(
  p_severity text,
  p_level int,
  p_origin_building_id uuid,
  p_affected_buildings uuid[],
  p_at timestamptz default now()
)
returns table (person_id uuid, delivery_reason text) language sql stable as $$
  with policy as (
    select * from alert_policy where severity = p_severity
  ),
  role_candidates as (
    -- Nivel 1 y 2: candidatos según asignación vigente
    select distinct
      a.person_id,
      coalesce(a.building_id, p.home_building_id) as building_id,
      a.role_code
    from assignment a
    join person p on p.id = a.person_id and p.active = true
    where a.starts_at <= p_at
      and (a.ends_at is null or a.ends_at > p_at)
      and (
        (p_level = 1 and (
          a.role_code in ('COORD_INCIDENTES', 'RRHH', 'JEFE_SEGURIDAD')
          or (
            a.role_code in ('JEFE_BRIGADA', 'DISPENSARIO', 'SEGURIDAD')
            and (a.building_id is null or a.building_id = p_origin_building_id)
          )
        ))
        or (p_level = 2 and (
          a.building_id = any(p_affected_buildings)
          or a.building_id = p_origin_building_id
          or (a.building_id is null and p.home_building_id = p_origin_building_id)
        ))
      )
    union
    -- Nivel 3: todo el personal activo del recinto
    select distinct
      p.id as person_id,
      coalesce(a.building_id, p.home_building_id) as building_id,
      a.role_code
    from person p
    left join assignment a on a.person_id = p.id
      and a.starts_at <= p_at
      and (a.ends_at is null or a.ends_at > p_at)
    where p_level = 3
      and p.active = true
  ),
  active_override as (
    select o.* from duty_override o where o.during @> p_at
  ),
  presence_eval as (
    select
      rc.person_id,
      rc.building_id,
      rc.role_code,
      (
        not exists (select 1 from device d where d.person_id = rc.person_id)
        or exists (
          select 1 from device d
          where d.person_id = rc.person_id
            and (was_inside_at(d, p_at) or d.presence_state = 'DESCONOCIDA')
        )
      ) as is_inside_or_unknown
    from role_candidates rc
  )
  select distinct pe.person_id,
    case
      when exists (select 1 from on_duty(p_at) od where od.person_id = pe.person_id) then 'EN_TURNO'
      when exists (
        select 1 from active_override ao
        where ao.scope = 'TODOS'
           or (ao.scope = 'EDIFICIO' and ao.building_id = pe.building_id)
           or (ao.scope = 'ROL' and ao.role_code = pe.role_code)
      ) then 'CONVOCATORIA_SEGURIDAD'
      when (select presence_overrides_shift from policy) and pe.is_inside_or_unknown then 'DENTRO_FUERA_DE_TURNO'
    end as delivery_reason
  from presence_eval pe
  where
    not (select respects_shift from policy)
    or exists (select 1 from on_duty(p_at) od where od.person_id = pe.person_id)
    or exists (
      select 1 from active_override ao
      where ao.scope = 'TODOS'
         or (ao.scope = 'EDIFICIO' and ao.building_id = pe.building_id)
         or (ao.scope = 'ROL' and ao.role_code = pe.role_code)
    )
    or ((select presence_overrides_shift from policy) and pe.is_inside_or_unknown)
$$;
