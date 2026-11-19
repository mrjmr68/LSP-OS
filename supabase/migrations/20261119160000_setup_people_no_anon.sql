-- Supabase grants anon EXECUTE on new public functions by default.
-- create_customer already refuses non-owners; remove the grant anyway.
revoke execute on function public.create_customer(text, integer, text, text, text, text) from anon;
revoke execute on function public.keep_an_active_owner() from anon, authenticated;
