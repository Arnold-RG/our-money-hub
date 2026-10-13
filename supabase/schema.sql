-- Our Money Hub
-- Run this once in the Supabase SQL editor for a new project.
-- Household rows are visible only to members of that household.
-- Passwords stay in Supabase Auth. Do not put the service role key in the website.

create extension if not exists pgcrypto with schema extensions;

create or replace function public.is_member(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.members
    where household_id = hid
      and user_id = auth.uid()
  );
$$;

create or replace function public.is_admin(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.members
    where household_id = hid
      and user_id = auth.uid()
      and role = 'admin'
  );
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  constraint profiles_name_len check (char_length(name) between 1 and 80)
);

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  currency text not null default 'PLN',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint households_name_len check (char_length(name) between 1 and 80),
  constraint households_currency_ok check (currency ~ '^[A-Z]{3}$')
);

create table if not exists public.members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null,
  created_at timestamptz not null default now(),
  primary key (household_id, user_id),
  constraint members_role_ok check (role in ('admin', 'member'))
);

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.join_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  attempted_at timestamptz not null default now()
);

create index if not exists join_attempts_user_time on public.join_attempts (user_id, attempted_at);

create table if not exists public.incomes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  owner_id uuid references public.profiles (id) on delete set null,
  owner_name text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  source text not null,
  category text not null,
  amount_cents integer not null,
  received_on date not null,
  recurring text not null default 'none',
  notes text not null default '',
  created_at timestamptz not null default now(),
  constraint incomes_source_len check (char_length(source) between 1 and 120),
  constraint incomes_amount_ok check (amount_cents >= 0 and amount_cents <= 100000000000),
  constraint incomes_date_ok check (received_on between '2000-01-01' and '2100-01-01'),
  constraint incomes_recurring_ok check (recurring in ('none', 'weekly', 'monthly', 'yearly')),
  constraint incomes_category_ok check (category in ('Salary', 'Business', 'Freelance', 'Gift', 'Investment', 'Support', 'Other')),
  constraint incomes_notes_len check (char_length(notes) <= 400)
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  owner_id uuid references public.profiles (id) on delete set null,
  owner_name text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  merchant text not null,
  category text not null,
  amount_cents integer not null,
  spent_on date not null,
  recurring text not null default 'none',
  notes text not null default '',
  created_at timestamptz not null default now(),
  constraint expenses_merchant_len check (char_length(merchant) between 1 and 120),
  constraint expenses_amount_ok check (amount_cents >= 0 and amount_cents <= 100000000000),
  constraint expenses_date_ok check (spent_on between '2000-01-01' and '2100-01-01'),
  constraint expenses_recurring_ok check (recurring in ('none', 'weekly', 'monthly', 'yearly')),
  constraint expenses_category_ok check (category in ('Housing', 'Food', 'Transport', 'Utilities', 'Health', 'Education', 'Family', 'Entertainment', 'Debt', 'Other')),
  constraint expenses_notes_len check (char_length(notes) <= 400)
);

create table if not exists public.costs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  owner_id uuid references public.profiles (id) on delete set null,
  owner_name text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  title text not null,
  category text not null,
  amount_cents integer not null,
  due_on date not null,
  recurring text not null default 'none',
  notes text not null default '',
  created_at timestamptz not null default now(),
  constraint costs_title_len check (char_length(title) between 1 and 120),
  constraint costs_amount_ok check (amount_cents >= 0 and amount_cents <= 100000000000),
  constraint costs_date_ok check (due_on between '2000-01-01' and '2100-01-01'),
  constraint costs_recurring_ok check (recurring in ('none', 'weekly', 'monthly', 'yearly')),
  constraint costs_category_ok check (category in ('Insurance', 'Fees', 'Maintenance', 'Subscriptions', 'Unexpected', 'Other')),
  constraint costs_notes_len check (char_length(notes) <= 400)
);

create table if not exists public.savings (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  owner_id uuid references public.profiles (id) on delete set null,
  owner_name text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  name text not null,
  target_cents integer not null default 0,
  current_cents integer not null default 0,
  monthly_cents integer not null default 0,
  target_date date,
  notes text not null default '',
  created_at timestamptz not null default now(),
  constraint savings_name_len check (char_length(name) between 1 and 120),
  constraint savings_amounts_ok check (
    target_cents >= 0 and target_cents <= 100000000000
    and current_cents >= 0 and current_cents <= 100000000000
    and monthly_cents >= 0 and monthly_cents <= 100000000000
  ),
  constraint savings_notes_len check (char_length(notes) <= 400)
);

create table if not exists public.savings_entries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  savings_id uuid not null references public.savings (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,
  created_by_name text not null default '',
  kind text not null,
  amount_cents integer not null,
  entry_on date not null,
  notes text not null default '',
  created_at timestamptz not null default now(),
  constraint savings_entries_kind_ok check (kind in ('deposit', 'withdraw')),
  constraint savings_entries_amount_ok check (amount_cents > 0 and amount_cents <= 100000000000),
  constraint savings_entries_notes_len check (char_length(notes) <= 200)
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  owner_id uuid references public.profiles (id) on delete set null,
  owner_name text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  name text not null,
  budget_cents integer not null default 0,
  status text not null default 'planned',
  target_date date,
  notes text not null default '',
  created_at timestamptz not null default now(),
  constraint projects_name_len check (char_length(name) between 1 and 120),
  constraint projects_budget_ok check (budget_cents >= 0 and budget_cents <= 100000000000),
  constraint projects_status_ok check (status in ('planned', 'active', 'paused', 'done')),
  constraint projects_notes_len check (char_length(notes) <= 400)
);

create table if not exists public.project_entries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,
  created_by_name text not null default '',
  amount_cents integer not null,
  entry_on date not null,
  notes text not null default '',
  created_at timestamptz not null default now(),
  constraint project_entries_amount_ok check (amount_cents > 0 and amount_cents <= 100000000000),
  constraint project_entries_notes_len check (char_length(notes) <= 200)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  name text not null default '',
  role text not null default 'member',
  body text not null,
  created_at timestamptz not null default now(),
  constraint messages_body_len check (char_length(body) between 1 and 800),
  constraint messages_role_ok check (role in ('admin', 'member'))
);

create table if not exists public.activity (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  actor_name text not null default '',
  action text not null,
  detail text not null default '',
  created_at timestamptz not null default now(),
  constraint activity_action_len check (char_length(action) between 1 and 40),
  constraint activity_detail_len check (char_length(detail) <= 200)
);

create table if not exists public.lists (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  title text not null,
  position integer not null default 0,
  constraint lists_title_len check (char_length(title) between 1 and 60)
);

create table if not exists public.cards (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  list_id uuid not null references public.lists (id) on delete cascade,
  title text not null,
  plan text not null default '',
  labels text[] not null default '{}',
  owner_id uuid references public.profiles (id) on delete set null,
  owner_name text not null default '',
  due_on date,
  position integer not null default 0,
  checklist jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint cards_title_len check (char_length(title) between 1 and 140),
  constraint cards_plan_len check (char_length(plan) <= 8000),
  constraint cards_labels_ok check (
    cardinality(labels) <= 4
    and labels <@ array['Home', 'Travel', 'School', 'Work', 'Family', 'Urgent']::text[]
  ),
  constraint cards_checklist_ok check (
    jsonb_typeof(checklist) = 'array' and jsonb_array_length(checklist) <= 30
  )
);

create index if not exists incomes_house_date on public.incomes (household_id, received_on);
create index if not exists expenses_house_date on public.expenses (household_id, spent_on);
create index if not exists costs_house_date on public.costs (household_id, due_on);
create index if not exists savings_house on public.savings (household_id);
create index if not exists savings_entries_pot on public.savings_entries (savings_id, entry_on);
create index if not exists projects_house on public.projects (household_id);
create index if not exists project_entries_project on public.project_entries (project_id, entry_on);
create index if not exists messages_house_time on public.messages (household_id, created_at);
create index if not exists activity_house_time on public.activity (household_id, created_at);
create index if not exists lists_house_pos on public.lists (household_id, position);
create index if not exists cards_list_pos on public.cards (list_id, position);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  chosen text;
begin
  chosen := left(trim(coalesce(new.raw_user_meta_data->>'name', '')), 80);
  if chosen is null or char_length(chosen) < 1 then
    chosen := 'Member';
  end if;
  insert into public.profiles (id, name) values (new.id, chosen)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.stamp_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.id := old.id;
  new.created_at := old.created_at;
  new.name := left(trim(coalesce(new.name, '')), 80);
  if char_length(new.name) < 1 then
    raise exception 'Add your name.';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_stamp on public.profiles;
create trigger profiles_stamp
  before update on public.profiles
  for each row execute function public.stamp_profile();

create or replace function public.stamp_household()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin(old.id) then
    raise exception 'Only an admin can do that.';
  end if;
  new.id := old.id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.name := left(trim(coalesce(new.name, '')), 80);
  new.currency := upper(trim(coalesce(new.currency, '')));
  if char_length(new.name) < 1 then
    raise exception 'Household name is required.';
  end if;
  if new.currency !~ '^[A-Z]{3}$' then
    raise exception 'Choose a valid currency.';
  end if;
  return new;
end;
$$;

drop trigger if exists households_stamp on public.households;
create trigger households_stamp
  before update on public.households
  for each row execute function public.stamp_household();

create or replace function public.stamp_owned()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first.';
  end if;
  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.household_id := old.household_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  else
    new.created_by := auth.uid();
  end if;
  if not public.is_member(new.household_id) then
    raise exception 'You are not in this household.';
  end if;
  if tg_op = 'INSERT' and new.owner_id is null then
    raise exception 'Choose a person.';
  end if;
  if new.owner_id is not null and not exists (
    select 1 from public.members
    where household_id = new.household_id and user_id = new.owner_id
  ) then
    raise exception 'That person is not in this household.';
  end if;
  if new.owner_name is null or char_length(trim(new.owner_name)) = 0 then
    select name into new.owner_name from public.profiles where id = new.owner_id;
  end if;
  new.owner_name := left(coalesce(new.owner_name, ''), 80);
  return new;
end;
$$;

drop trigger if exists incomes_stamp on public.incomes;
create trigger incomes_stamp before insert or update on public.incomes
  for each row execute function public.stamp_owned();
drop trigger if exists expenses_stamp on public.expenses;
create trigger expenses_stamp before insert or update on public.expenses
  for each row execute function public.stamp_owned();
drop trigger if exists costs_stamp on public.costs;
create trigger costs_stamp before insert or update on public.costs
  for each row execute function public.stamp_owned();
drop trigger if exists savings_stamp on public.savings;
create trigger savings_stamp before insert or update on public.savings
  for each row execute function public.stamp_owned();
drop trigger if exists projects_stamp on public.projects;
create trigger projects_stamp before insert or update on public.projects
  for each row execute function public.stamp_owned();
drop trigger if exists cards_stamp on public.cards;
create trigger cards_stamp before insert or update on public.cards
  for each row execute function public.stamp_owned();

create or replace function public.savings_opening()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor text;
begin
  if new.current_cents > 0 then
    select name into actor from public.profiles where id = auth.uid();
    insert into public.savings_entries (
      household_id, savings_id, created_by, created_by_name, kind, amount_cents, entry_on, notes
    ) values (
      new.household_id, new.id, auth.uid(), coalesce(actor, ''), 'deposit', new.current_cents, current_date, 'Opening balance'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists savings_opening_entry on public.savings;
create trigger savings_opening_entry
  after insert on public.savings
  for each row execute function public.savings_opening();

create or replace function public.stamp_savings_entry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  hid uuid;
begin
  select household_id into hid from public.savings where id = new.savings_id;
  if hid is null then
    raise exception 'Savings pot not found.';
  end if;
  new.household_id := hid;
  if auth.uid() is null or not public.is_member(hid) then
    raise exception 'You are not in this household.';
  end if;
  new.created_by := auth.uid();
  if new.created_by_name is null or char_length(trim(new.created_by_name)) = 0 then
    select name into new.created_by_name from public.profiles where id = auth.uid();
  end if;
  new.created_by_name := left(coalesce(new.created_by_name, ''), 80);
  new.notes := left(coalesce(new.notes, ''), 200);
  return new;
end;
$$;

drop trigger if exists savings_entries_stamp on public.savings_entries;
create trigger savings_entries_stamp
  before insert on public.savings_entries
  for each row execute function public.stamp_savings_entry();

create or replace function public.rewind_savings_entry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.savings where id = old.savings_id) then
    update public.savings
      set current_cents = case
        when old.kind = 'deposit' then current_cents - old.amount_cents
        else current_cents + old.amount_cents
      end
      where id = old.savings_id;
  end if;
  return old;
end;
$$;

drop trigger if exists savings_entries_rewind on public.savings_entries;
create trigger savings_entries_rewind
  before delete on public.savings_entries
  for each row execute function public.rewind_savings_entry();

create or replace function public.stamp_project_entry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  hid uuid;
begin
  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.project_id := old.project_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  select household_id into hid from public.projects where id = new.project_id;
  if hid is null then
    raise exception 'Project not found.';
  end if;
  new.household_id := hid;
  if auth.uid() is null or not public.is_member(hid) then
    raise exception 'You are not in this household.';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  end if;
  if new.created_by_name is null or char_length(trim(new.created_by_name)) = 0 then
    select name into new.created_by_name from public.profiles where id = coalesce(new.created_by, auth.uid());
  end if;
  new.created_by_name := left(coalesce(new.created_by_name, ''), 80);
  new.notes := left(coalesce(new.notes, ''), 200);
  return new;
end;
$$;

drop trigger if exists project_entries_stamp on public.project_entries;
create trigger project_entries_stamp
  before insert or update on public.project_entries
  for each row execute function public.stamp_project_entry();

create or replace function public.stamp_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recent integer;
  actor text;
  actor_role text;
begin
  if auth.uid() is null or not public.is_member(new.household_id) then
    raise exception 'You are not in this household.';
  end if;
  select count(*) into recent
  from public.messages
  where user_id = auth.uid()
    and created_at > now() - interval '5 minutes';
  if recent >= 30 then
    raise exception 'Too many messages. Wait a minute and try again.';
  end if;
  select m.role, p.name into actor_role, actor
  from public.members m
  join public.profiles p on p.id = m.user_id
  where m.household_id = new.household_id and m.user_id = auth.uid();
  new.user_id := auth.uid();
  new.name := left(coalesce(actor, 'Member'), 80);
  new.role := coalesce(actor_role, 'member');
  new.body := left(trim(coalesce(new.body, '')), 800);
  if char_length(new.body) < 1 then
    raise exception 'Write a message first.';
  end if;
  return new;
end;
$$;

drop trigger if exists messages_stamp on public.messages;
create trigger messages_stamp
  before insert on public.messages
  for each row execute function public.stamp_message();

create or replace function public.stamp_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor text;
begin
  if auth.uid() is null or not public.is_member(new.household_id) then
    raise exception 'You are not in this household.';
  end if;
  select name into actor from public.profiles where id = auth.uid();
  new.user_id := auth.uid();
  new.actor_name := left(coalesce(actor, 'Member'), 80);
  new.action := left(trim(coalesce(new.action, '')), 40);
  new.detail := left(trim(coalesce(new.detail, '')), 200);
  return new;
end;
$$;

drop trigger if exists activity_stamp on public.activity;
create trigger activity_stamp
  before insert on public.activity
  for each row execute function public.stamp_activity();

create or replace function public.stamp_list()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.household_id := old.household_id;
  end if;
  if not public.is_member(new.household_id) then
    raise exception 'You are not in this household.';
  end if;
  new.title := left(trim(coalesce(new.title, '')), 60);
  if char_length(new.title) < 1 then
    raise exception 'Give the column a name.';
  end if;
  return new;
end;
$$;

drop trigger if exists lists_stamp on public.lists;
create trigger lists_stamp
  before insert or update on public.lists
  for each row execute function public.stamp_list();

create or replace function public.keep_a_list()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.lists where household_id = old.household_id) <= 1 then
    raise exception 'Keep at least one column.';
  end if;
  return old;
end;
$$;

drop trigger if exists lists_keep_one on public.lists;
create trigger lists_keep_one
  before delete on public.lists
  for each row execute function public.keep_a_list();

create or replace function public.currency_ok(code text)
returns boolean
language sql
immutable
as $$
  select upper(trim(coalesce(code, ''))) = any (array[
    'PLN', 'EUR', 'USD', 'RWF', 'XAF', 'CDF', 'XOF', 'GBP', 'KES', 'UGX', 'NGN',
    'ZAR', 'CAD', 'AUD', 'CHF', 'CZK', 'UAH', 'SEK', 'NOK', 'DKK', 'JPY', 'CNY', 'INR'
  ]);
$$;

create or replace function public.issue_invite(hid uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  code text;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.';
  end if;
  if not public.is_admin(hid) then
    raise exception 'Only an admin can do that.';
  end if;
  code := 'OMH-' || encode(extensions.gen_random_bytes(16), 'hex');
  delete from public.invites where household_id = hid;
  insert into public.invites (household_id, code_hash, expires_at, created_by)
  values (
    hid,
    encode(extensions.digest(code, 'sha256'), 'hex'),
    now() + interval '14 days',
    auth.uid()
  );
  return code;
end;
$$;

create or replace function public.create_household(hname text, hcurrency text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  hid uuid;
  code text;
  chosen text;
  money text;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.';
  end if;
  if not exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'Your profile is not ready yet. Sign out and try again.';
  end if;
  if (select count(*) from public.members where user_id = auth.uid()) >= 20 then
    raise exception 'This account already has enough households.';
  end if;
  chosen := left(trim(coalesce(hname, '')), 80);
  if char_length(chosen) < 1 then
    raise exception 'Add a household name.';
  end if;
  money := upper(trim(coalesce(hcurrency, 'PLN')));
  if not public.currency_ok(money) then
    raise exception 'Choose a valid currency.';
  end if;
  insert into public.households (name, currency, created_by)
  values (chosen, money, auth.uid())
  returning id into hid;
  insert into public.members (household_id, user_id, role)
  values (hid, auth.uid(), 'admin');
  insert into public.lists (household_id, title, position) values
    (hid, 'How we start', 0),
    (hid, 'Ready', 1),
    (hid, 'In motion', 2),
    (hid, 'Waiting', 3),
    (hid, 'Finished', 4);
  code := public.issue_invite(hid);
  return jsonb_build_object('household_id', hid, 'invite_code', code);
end;
$$;

create or replace function public.rotate_invite(hid uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.issue_invite(hid);
end;
$$;

create or replace function public.join_household(invite_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  hid uuid;
  attempts integer;
  normalized text;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.';
  end if;
  if not exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'Your profile is not ready yet. Sign out and try again.';
  end if;
  normalized := trim(coalesce(invite_code, ''));
  if char_length(normalized) < 20 or char_length(normalized) > 80 then
    raise exception 'That code is not valid.';
  end if;
  delete from public.join_attempts
  where user_id = auth.uid()
    and attempted_at < now() - interval '1 day';
  select count(*) into attempts
  from public.join_attempts
  where user_id = auth.uid()
    and attempted_at > now() - interval '15 minutes';
  if attempts >= 8 then
    raise exception 'Too many attempts. Wait a few minutes and try again.';
  end if;
  insert into public.join_attempts (user_id) values (auth.uid());
  select household_id into hid
  from public.invites
  where code_hash = encode(extensions.digest(normalized, 'sha256'), 'hex')
    and expires_at > now();
  if hid is null then
    raise exception 'That code is not valid.';
  end if;
  if (select count(*) from public.members where household_id = hid) >= 30
     and not exists (select 1 from public.members where household_id = hid and user_id = auth.uid()) then
    raise exception 'This household is full.';
  end if;
  insert into public.members (household_id, user_id, role)
  values (hid, auth.uid(), 'member')
  on conflict (household_id, user_id) do nothing;
  return hid;
end;
$$;

create or replace function public.set_member_role(hid uuid, target uuid, next_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_role text;
  admins integer;
begin
  if not public.is_admin(hid) then
    raise exception 'Only an admin can do that.';
  end if;
  if next_role not in ('admin', 'member') then
    raise exception 'That role is not valid.';
  end if;
  select role into current_role
  from public.members
  where household_id = hid and user_id = target;
  if current_role is null then
    raise exception 'Person not found.';
  end if;
  select count(*) into admins
  from public.members
  where household_id = hid and role = 'admin';
  if current_role = 'admin' and next_role <> 'admin' and admins < 2 then
    raise exception 'Keep at least one admin in this household.';
  end if;
  update public.members set role = next_role
  where household_id = hid and user_id = target;
end;
$$;

create or replace function public.remove_member(hid uuid, target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_role text;
  admins integer;
begin
  if not public.is_admin(hid) then
    raise exception 'Only an admin can do that.';
  end if;
  if target = auth.uid() then
    raise exception 'You cannot remove yourself.';
  end if;
  select role into current_role
  from public.members
  where household_id = hid and user_id = target;
  if current_role is null then
    raise exception 'Person not found.';
  end if;
  select count(*) into admins
  from public.members
  where household_id = hid and role = 'admin';
  if current_role = 'admin' and admins < 2 then
    raise exception 'Keep at least one admin in this household.';
  end if;
  delete from public.members where household_id = hid and user_id = target;
end;
$$;

create or replace function public.move_savings(
  pot uuid,
  kind text,
  amount integer,
  entry_on date,
  note text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  pot_row public.savings%rowtype;
  actor text;
  next_balance integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.';
  end if;
  if kind not in ('deposit', 'withdraw') then
    raise exception 'That action is not valid.';
  end if;
  if amount is null or amount <= 0 or amount > 100000000000 then
    raise exception 'Enter an amount.';
  end if;
  if entry_on is null or entry_on < '2000-01-01' or entry_on > '2100-01-01' then
    raise exception 'A date is required.';
  end if;
  select * into pot_row from public.savings where id = pot for update;
  if not found then
    raise exception 'Savings pot not found.';
  end if;
  if not public.is_member(pot_row.household_id) then
    raise exception 'You are not in this household.';
  end if;
  if kind = 'withdraw' and pot_row.current_cents < amount then
    raise exception 'That withdrawal is larger than the current balance.';
  end if;
  next_balance := case
    when kind = 'deposit' then pot_row.current_cents + amount
    else pot_row.current_cents - amount
  end;
  update public.savings set current_cents = next_balance where id = pot;
  select name into actor from public.profiles where id = auth.uid();
  insert into public.savings_entries (
    household_id, savings_id, created_by, created_by_name, kind, amount_cents, entry_on, notes
  ) values (
    pot_row.household_id,
    pot,
    auth.uid(),
    coalesce(actor, ''),
    kind,
    amount,
    entry_on,
    left(trim(coalesce(note, '')), 200)
  );
  return next_balance;
end;
$$;

alter table public.profiles enable row level security;
alter table public.households enable row level security;
alter table public.members enable row level security;
alter table public.invites enable row level security;
alter table public.join_attempts enable row level security;
alter table public.incomes enable row level security;
alter table public.expenses enable row level security;
alter table public.costs enable row level security;
alter table public.savings enable row level security;
alter table public.savings_entries enable row level security;
alter table public.projects enable row level security;
alter table public.project_entries enable row level security;
alter table public.messages enable row level security;
alter table public.activity enable row level security;
alter table public.lists enable row level security;
alter table public.cards enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1
      from public.members mine
      join public.members theirs on theirs.household_id = mine.household_id
      where mine.user_id = auth.uid()
        and theirs.user_id = profiles.id
    )
  );

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists households_select on public.households;
create policy households_select on public.households
  for select to authenticated
  using (public.is_member(id));

drop policy if exists households_update on public.households;
create policy households_update on public.households
  for update to authenticated
  using (public.is_admin(id))
  with check (public.is_admin(id));

drop policy if exists members_select on public.members;
create policy members_select on public.members
  for select to authenticated
  using (public.is_member(household_id));

do $$
declare
  t text;
begin
  foreach t in array array[
    'incomes', 'expenses', 'costs', 'savings', 'projects', 'project_entries',
    'lists', 'cards', 'messages', 'activity'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_member(household_id))',
      t || '_select', t
    );
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.is_member(household_id))',
      t || '_insert', t
    );
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.is_member(household_id)) with check (public.is_member(household_id))',
      t || '_update', t
    );
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.is_member(household_id))',
      t || '_delete', t
    );
  end loop;
end $$;

drop policy if exists savings_entries_select on public.savings_entries;
create policy savings_entries_select on public.savings_entries
  for select to authenticated
  using (public.is_member(household_id));

drop policy if exists savings_entries_delete on public.savings_entries;
create policy savings_entries_delete on public.savings_entries
  for delete to authenticated
  using (public.is_member(household_id));

revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant usage on schema public to authenticated;

grant select, update (name) on public.profiles to authenticated;
grant select, update (name, currency) on public.households to authenticated;
grant select on public.members to authenticated;

grant select, insert, update, delete on public.incomes to authenticated;
grant select, insert, update, delete on public.expenses to authenticated;
grant select, insert, update, delete on public.costs to authenticated;
grant select, delete on public.savings to authenticated;
grant insert (
  household_id, owner_id, owner_name, name, target_cents, current_cents, monthly_cents, target_date, notes
) on public.savings to authenticated;
grant update (
  owner_id, owner_name, name, target_cents, monthly_cents, target_date, notes
) on public.savings to authenticated;
grant select, delete on public.savings_entries to authenticated;
grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, update, delete on public.project_entries to authenticated;
grant select, insert on public.messages to authenticated;
grant select, insert on public.activity to authenticated;
grant select, insert, update, delete on public.lists to authenticated;
grant select, insert, update, delete on public.cards to authenticated;

grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.is_admin(uuid) to authenticated;
grant execute on function public.currency_ok(text) to authenticated;
grant execute on function public.create_household(text, text) to authenticated;
grant execute on function public.rotate_invite(uuid) to authenticated;
grant execute on function public.join_household(text) to authenticated;
grant execute on function public.set_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
grant execute on function public.move_savings(uuid, text, integer, date, text) to authenticated;

notify pgrst, 'reload schema';
