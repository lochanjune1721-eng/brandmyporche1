-- supabase/schema.sql — run this once in the Supabase SQL editor.
--
-- One table. A zone is sold when a row for it reaches status 'paid', and one partial unique
-- index per status is what stops the same panel being sold twice while two people are both
-- standing at the PayPal checkout.
--
-- Nothing in here is reachable from a browser: the site's serverless functions hold the
-- service-role key, so RLS below denies everything and every read and write goes through
-- /api. That is deliberate — it is what lets the price be set by the server instead of
-- being posted up from a form anyone can edit.

create extension if not exists "pgcrypto";

create table if not exists public.purchases (
  id                uuid primary key default gen_random_uuid(),
  zone_id           text        not null,          -- 'H5', 'LF11', … matches zones.js
  status            text        not null default 'pending'
                                check (status in ('pending', 'paid', 'released', 'refunded')),
  price_cents       integer     not null check (price_cents > 0),
  currency          text        not null default 'USD',

  -- Filled in from PayPal when the payment lands. The checkout form never asks for them:
  -- it collects a website and an icon, and nothing else.
  buyer_name        text,
  buyer_email       text,
  brand_name        text        not null,        -- the bare domain, derived server-side
  brand_url         text        not null,
  artwork_url       text,

  paypal_order_id   text unique,
  paypal_capture_id text,

  hold_expires_at   timestamptz,                   -- pending rows only
  created_at        timestamptz not null default now(),
  paid_at           timestamptz
);

-- A zone can be sold once, and reserved by one person at a time. These two indexes are the
-- whole concurrency story: a second checkout on a held or sold zone fails at the database,
-- not at a race in application code.
create unique index if not exists purchases_one_paid_per_zone
  on public.purchases (zone_id) where status = 'paid';
create unique index if not exists purchases_one_hold_per_zone
  on public.purchases (zone_id) where status = 'pending';

create index if not exists purchases_zone_idx  on public.purchases (zone_id);
create index if not exists purchases_email_idx on public.purchases (lower(buyer_email));

-- Expired holds go back on the board. /api/checkout calls this before it tries to reserve,
-- so an abandoned checkout frees its zone without anyone having to sweep the table.
create or replace function public.release_expired_holds() returns integer
language sql security definer as $$
  with released as (
    update public.purchases set status = 'released'
     where status = 'pending' and hold_expires_at < now()
     returning 1
  ) select count(*)::int from released;
$$;

alter table public.purchases enable row level security;
-- No policies, on purpose. Anon and authenticated roles can do nothing here; the service-role
-- key used by /api bypasses RLS. If you ever add a browser-side read, add a policy that
-- exposes zone_id, brand_name, brand_url and artwork_url for paid rows and nothing else.

-- Artwork lives in Storage. Public read so the 3D car can show a winner's logo; writes are
-- server-side only.
insert into storage.buckets (id, name, public)
values ('artwork', 'artwork', true)
on conflict (id) do nothing;
