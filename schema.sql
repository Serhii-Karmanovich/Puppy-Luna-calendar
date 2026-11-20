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

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.luna_state enable row level security;

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
grant execute on function public.join_luna_household(text) to authenticated;
grant select on public.households, public.household_members, public.luna_state to authenticated;
grant insert, update on public.luna_state to authenticated;

alter publication supabase_realtime add table public.luna_state;
