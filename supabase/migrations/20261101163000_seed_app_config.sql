-- AppConfig seed. SPEC §17: labor $90/hr, profit floor ~$100/hr,
-- burn $2,400 per business day. Business days are Mon–Fri minus US federal holidays.
-- Weekends are not listed in non_business_dates; is_business_day excludes them.
-- Holiday list covers 2026–2035. Extend it by updating the singleton before 2036.

create or replace function public.observe_weekend_holiday(d date)
returns date
language sql
immutable
as $$
  select case extract(isodow from d)::integer
    when 6 then d - 1
    when 7 then d + 1
    else d
  end
$$;

create or replace function public.nth_weekday_of_month(y integer, m integer, isodow integer, n integer)
returns date
language sql
immutable
as $$
  select make_date(y, m, 1)
    + ((isodow - extract(isodow from make_date(y, m, 1))::integer + 7) % 7)
    + (n - 1) * 7
$$;

create or replace function public.last_weekday_of_month(y integer, m integer, isodow integer)
returns date
language sql
immutable
as $$
  with last_day as (
    select (make_date(y, m, 1) + interval '1 month - 1 day')::date as d
  )
  select d - ((extract(isodow from d)::integer - isodow + 7) % 7)
  from last_day
$$;

-- US federal holidays, observed (Saturday → Friday, Sunday → Monday).
-- New Year's observed date can fall on December 31 of the previous year.
create or replace function public.us_federal_observed_holidays(from_year integer, to_year integer)
returns setof date
language sql
stable
as $$
  select distinct holiday
  from generate_series(from_year, to_year) as year_num
  cross join lateral (
    values
      (public.observe_weekend_holiday(make_date(year_num, 1, 1))),
      (public.nth_weekday_of_month(year_num, 1, 1, 3)),
      (public.nth_weekday_of_month(year_num, 2, 1, 3)),
      (public.last_weekday_of_month(year_num, 5, 1)),
      (public.observe_weekend_holiday(make_date(year_num, 6, 19))),
      (public.observe_weekend_holiday(make_date(year_num, 7, 4))),
      (public.nth_weekday_of_month(year_num, 9, 1, 1)),
      (public.nth_weekday_of_month(year_num, 10, 1, 2)),
      (public.observe_weekend_holiday(make_date(year_num, 11, 11))),
      (public.nth_weekday_of_month(year_num, 11, 4, 4)),
      (public.observe_weekend_holiday(make_date(year_num, 12, 25)))
  ) as holidays (holiday)
  where holiday >= make_date(from_year, 1, 1)
    and holiday < make_date(to_year + 1, 1, 1)
$$;

create or replace function public.is_business_day(d date)
returns boolean
language sql
stable
as $$
  select extract(isodow from d)::integer between 1 and 5
    and not exists (
      select 1
      from public.app_config config
      where config.id = 1
        and d = any (config.non_business_dates)
    )
$$;

-- Inclusive count. Used later by Financial Pulse (burn × business days elapsed).
create or replace function public.business_days_elapsed(start_date date, end_date date)
returns integer
language sql
stable
as $$
  select coalesce(count(*)::integer, 0)
  from generate_series(start_date, end_date, interval '1 day') as day_series (day)
  where public.is_business_day(day_series.day::date)
$$;

insert into public.app_config (
  id,
  labor_rate_cents,
  profit_per_hour_floor_cents,
  daily_burn_cents,
  burn_day_basis,
  non_business_dates,
  default_tax_rate_bps,
  repeat_unit_window_days,
  history_window_months,
  qbo_week_start_dow,
  qbo_week_days,
  timezone
)
values (
  1,
  9000,
  10000,
  240000,
  'business_days',
  array(select public.us_federal_observed_holidays(2026, 2035) order by 1),
  675,
  14,
  6,
  1,
  '{1,2,3,4,5}',
  'America/New_York'
);
