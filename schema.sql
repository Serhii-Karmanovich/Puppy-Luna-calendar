create extension if not exists pgcrypto;

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Сім’я Луни',
  invite_code text not null unique default upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8)),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table if not exists public.luna_state (
  household_id uuid primary key references public.households(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create table if not exists public.household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null default (now() + interval '7 days'),
  max_uses integer not null default 1 check (max_uses between 1 and 10),
  used_count integer not null default 0 check (used_count >= 0),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  first_used_at timestamptz,
  revoked_at timestamptz
);

create or replace function public.is_luna_member(target_household uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.household_members
    where household_id = target_household and user_id = auth.uid()
  );
$$;

create or replace function public.create_luna_household()
returns table (household_id uuid, invite_code text)
language plpgsql
security definer
set search_path = public
as $$
declare new_household public.households;
begin
  if auth.uid() is null then raise exception 'Потрібно увійти'; end if;
  select * into new_household from public.households where created_by = auth.uid() limit 1;
  if new_household.id is null then
    insert into public.households (created_by) values (auth.uid()) returning * into new_household;
    insert into public.household_members (household_id, user_id, role) values (new_household.id, auth.uid(), 'owner');
    insert into public.luna_state (household_id, data, updated_by) values (new_household.id, '{}'::jsonb, auth.uid());
  else
    insert into public.household_members (household_id, user_id, role) values (new_household.id, auth.uid(), 'owner') on conflict do nothing;
  end if;
  return query select new_household.id, new_household.invite_code;
end;
$$;

create or replace function public.join_luna_household(code text)
returns table (household_id uuid, invite_code text)
language plpgsql
security definer
set search_path = public
as $$
declare target public.households;
begin
  if auth.uid() is null then raise exception 'Потрібно увійти'; end if;
  select * into target from public.households where invite_code = upper(trim(code)) limit 1;
  if target.id is null then raise exception 'Код сім’ї не знайдено'; end if;
  insert into public.household_members (household_id, user_id, role) values (target.id, auth.uid(), 'member') on conflict do nothing;
  return query select target.id, target.invite_code;
end;
$$;

create or replace function public.create_luna_invite(target_household uuid default null)
returns table (invite_id uuid, invite_token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid := target_household;
  token text := encode(extensions.gen_random_bytes(24), 'hex');
  created public.household_invites;
begin
  if auth.uid() is null then raise exception 'Потрібно увійти'; end if;
  if target is null then
    select household_id into target from public.household_members where user_id = auth.uid() and role = 'owner' order by created_at limit 1;
  end if;
  if target is null or not exists (select 1 from public.household_members where household_id = target and user_id = auth.uid() and role = 'owner') then
    raise exception 'Створювати запрошення може лише власник сім’ї';
  end if;
  insert into public.household_invites (household_id, token_hash, created_by)
  values (target, encode(extensions.digest(token, 'sha256'), 'hex'), auth.uid())
  returning * into created;
  return query select created.id, token, created.expires_at;
end;
$$;

create or replace function public.redeem_luna_invite(token text)
returns table (household_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  invite public.household_invites;
begin
  if auth.uid() is null then raise exception 'Потрібно увійти'; end if;
  select * into invite from public.household_invites
  where token_hash = encode(extensions.digest(trim(token), 'sha256'), 'hex')
    and revoked_at is null
    and expires_at > now()
    and used_count < max_uses
  for update;
  if invite.id is null then raise exception 'Посилання недійсне, прострочене або вже використане'; end if;
  if exists (select 1 from public.household_members where household_id = invite.household_id and user_id = auth.uid()) then
    return query select invite.household_id;
  end if;
  insert into public.household_members (household_id, user_id, role) values (invite.household_id, auth.uid(), 'member') on conflict do nothing;
  update public.household_invites set used_count = used_count + 1, first_used_at = coalesce(first_used_at, now()) where id = invite.id;
  return query select invite.household_id;
end;
$$;

create or replace function public.revoke_luna_invite(target_invite uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Потрібно увійти'; end if;
  update public.household_invites
  set revoked_at = now()
  where id = target_invite
    and exists (select 1 from public.household_members where household_id = household_invites.household_id and user_id = auth.uid() and role = 'owner');
  return found;
end;
$$;

create or replace function public.save_luna_state(
  target_household uuid,
  payload jsonb,
  expected_updated_at timestamptz default null
)
returns public.luna_state
language plpgsql
security definer
set search_path = public
as $$
declare saved public.luna_state;
begin
  if auth.uid() is null or not public.is_luna_member(target_household) then
    raise exception 'Доступ заборонено';
  end if;

  if expected_updated_at is null then
    insert into public.luna_state (household_id, data, updated_by)
    values (target_household, payload, auth.uid())
    on conflict (household_id) do nothing
    returning * into saved;
    if saved.household_id is null then
      raise exception 'LUNA_STATE_CONFLICT';
    end if;
  else
    update public.luna_state
    set data = payload, updated_at = now(), updated_by = auth.uid()
    where household_id = target_household
      and updated_at = expected_updated_at
    returning * into saved;
    if saved.household_id is null then
      raise exception 'LUNA_STATE_CONFLICT';
    end if;
  end if;

  return saved;
end;
$$;

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.luna_state enable row level security;
alter table public.household_invites enable row level security;

drop policy if exists "Members can read their household" on public.households;
create policy "Members can read their household" on public.households for select to authenticated using (public.is_luna_member(id));

drop policy if exists "Members can read membership" on public.household_members;
create policy "Members can read membership" on public.household_members for select to authenticated using (public.is_luna_member(household_id));

drop policy if exists "Members can read Luna state" on public.luna_state;
create policy "Members can read Luna state" on public.luna_state for select to authenticated using (public.is_luna_member(household_id));

drop policy if exists "Members can write Luna state" on public.luna_state;
create policy "Members can write Luna state" on public.luna_state for insert to authenticated with check (public.is_luna_member(household_id));

drop policy if exists "Members can update Luna state" on public.luna_state;
create policy "Members can update Luna state" on public.luna_state for update to authenticated using (public.is_luna_member(household_id)) with check (public.is_luna_member(household_id));

grant execute on function public.create_luna_household() to authenticated;
-- v2.1: joining is invite-link-only. Keep the legacy function for existing
-- database compatibility, but do not expose it through the client API.
revoke execute on function public.join_luna_household(text) from authenticated;
grant execute on function public.create_luna_invite(uuid) to authenticated;
grant execute on function public.redeem_luna_invite(text) to authenticated;
grant execute on function public.revoke_luna_invite(uuid) to authenticated;
revoke execute on function public.save_luna_state(uuid, jsonb, timestamptz) from public;
grant execute on function public.save_luna_state(uuid, jsonb, timestamptz) to authenticated;
grant select on public.households, public.household_members, public.luna_state to authenticated;
grant insert, update on public.luna_state to authenticated;
revoke all on public.household_invites from anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'luna_state'
  ) then
    alter publication supabase_realtime add table public.luna_state;
  end if;
end
$$;
