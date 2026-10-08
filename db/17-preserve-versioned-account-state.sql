-- Preserve fields unknown to older open clients during whole-state saves.
-- Forward-only: no backfill, course attribution, deletion or RLS change.
-- Apply before enabling the upgraded learner/preferences in a hosted release.

create function public.preserve_versioned_account_state()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  field text;
begin
  -- An array/scalar/null cannot represent an account-state snapshot. Do not let
  -- such a replacement erase already-present versioned data.
  if (old.state ? '_learningV2' or old.state ? '_courseMaterialDefaults')
     and jsonb_typeof(new.state) is distinct from 'object' then
    raise exception 'Account state must be an object' using errcode = '22023';
  end if;

  if jsonb_typeof(old.state) = 'object' and jsonb_typeof(new.state) = 'object' then
    foreach field in array array['_learningV2', '_courseMaterialDefaults'] loop
      if old.state ? field and not (new.state ? field) then
        new.state := jsonb_set(new.state, array[field], old.state -> field, true);
      end if;
    end loop;
  end if;

  -- Modern clients use updated_at for optimistic concurrency. A legacy writer
  -- can have an old/equal clock; every accepted update must invalidate old reads.
  new.updated_at := greatest(new.updated_at, old.updated_at + interval '1 microsecond');
  return new;
end;
$$;

revoke all on function public.preserve_versioned_account_state() from public, anon, authenticated, service_role;

create trigger preserve_versioned_account_state
before update on public.user_state
for each row execute function public.preserve_versioned_account_state();
