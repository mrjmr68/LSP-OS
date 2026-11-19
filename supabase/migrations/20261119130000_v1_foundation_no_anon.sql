-- Signed-out visitors get nothing from the v1 foundation objects.
-- Supabase's default privileges grant anon access to new public objects;
-- RLS already returns no rows, this removes the access itself.
revoke all on public.nc_county_tax_rates from anon;
revoke all on public.tech_positions from anon;
revoke execute on function public.report_my_position(numeric, numeric, integer) from anon;
revoke execute on function public.set_my_jobs_order(uuid[]) from anon;
