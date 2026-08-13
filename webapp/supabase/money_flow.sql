-- Global Money Flow Monitor — logical Supabase schema (MVP persists to R2).
-- Apply when promoting off R2 snapshots. Do not mix Flow/Position/Activity/Liquidity.

create table if not exists money_flow_snapshots (
  id uuid primary key default gen_random_uuid(),
  as_of_kst date not null,
  period text not null check (period in ('1w', '1m', '3m')),
  payload jsonb not null,
  generated_at timestamptz not null default now(),
  unique (as_of_kst, period)
);

create table if not exists money_flow_observations (
  id uuid primary key default gen_random_uuid(),
  asset_id text not null,
  metric_kind text not null check (metric_kind in ('flow', 'position', 'activity', 'liquidity', 'price')),
  metric_key text not null,
  value double precision,
  unit text,
  source text not null,
  method text,
  observation_date date,
  published_date date,
  created_at timestamptz not null default now()
);

create index if not exists money_flow_obs_asset_kind_idx
  on money_flow_observations (asset_id, metric_kind, observation_date desc);

comment on table money_flow_observations is
  'Atomic observations only. Never store cross-family sums (Flow+OI+Volume).';
