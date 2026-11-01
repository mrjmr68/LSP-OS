-- LSP OS enums. Authority: docs/STATE_MACHINES.md and docs/DATA_MODEL.md (Nov 1, 2026).
-- There is no jobs table. The Board card is service_requests.board_status.

create type public.user_role as enum ('owner', 'tech');

create type public.addon_approval_mode as enum (
  'do_under_limit',
  'call_first',
  'estimate_required'
);

create type public.signoff_requirement as enum (
  'none',
  'note_only',
  'walkthrough_signature',
  'photos'
);

create type public.resident_report_mode as enum (
  'confirm_with_property',
  'just_go',
  'must_use_maintenance'
);

create type public.system_kind as enum (
  'ahu',
  'heat_pump',
  'condenser',
  'furnace',
  'thermostat',
  'other'
);

create type public.request_source as enum (
  'portal',
  'phone',
  'text',
  'email',
  'dispatcher',
  'tech_direct',
  'onsite'
);

-- Board categories, in display order.
create type public.board_status as enum (
  'new',
  'assigned',
  'ready',
  'in_progress',
  'to_estimate',
  'estimate_out',
  'parts',
  'complete',
  'invoiced',
  'closed'
);

create type public.request_priority as enum ('normal', 'high');

create type public.visit_type as enum (
  'service',
  'return',
  'estimate',
  'changeout'
);

create type public.visit_status as enum (
  'planned',
  'en_route',
  'on_site',
  'working',
  'closed',
  'attempt',
  'cancelled'
);

create type public.outcome_path as enum (
  'easy',
  'parts',
  'estimate',
  'attempt',
  'one_off',
  'changeout'
);

create type public.attempt_reason as enum (
  'no_access',
  'tenant_refused',
  'lockbox',
  'no_escort',
  'other'
);

create type public.sync_state as enum ('synced', 'pending');

create type public.time_segment_kind as enum ('travel', 'access', 'work');

create type public.time_source as enum ('tap', 'gps', 'close', 'owner_edit');

create type public.pricing_kind as enum ('fixed', 'variable');

create type public.bundle_status as enum ('active', 'retired');

create type public.bundle_line_kind as enum (
  'equipment',
  'part',
  'material',
  'consumable',
  'refrigerant'
);

-- No "shipped". In-hand means physically received.
create type public.parts_order_status as enum (
  'needed',
  'ordered',
  'in_hand',
  'cancelled'
);

create type public.invoice_kind as enum ('bundle', 'one_off');

create type public.invoice_status as enum (
  'draft',
  'in_review',
  'flagged',
  'approved_sent',
  'paid',
  'void'
);

-- "trip" is reserved by the data model. No trip-charge bundle exists.
create type public.invoice_line_source as enum (
  'bundle',
  'adjustment',
  'one_off',
  'trip'
);

create type public.estimate_status as enum (
  'draft',
  'in_review',
  'sent',
  'viewed',
  'accepted',
  'declined',
  'void'
);

create type public.attachment_owner_type as enum (
  'visit',
  'request',
  'system',
  'invoice',
  'estimate',
  'reference'
);

create type public.attachment_kind as enum (
  'photo',
  'nameplate',
  'signature',
  'pdf',
  'reference_doc'
);

create type public.upload_state as enum ('local', 'uploaded');

create type public.reference_brand as enum (
  'goodman',
  'ruud',
  'thermostat',
  'other'
);

create type public.reference_category as enum (
  'wiring',
  'charging',
  'thermostat_program'
);

create type public.burn_day_basis as enum ('business_days');

create type public.status_trigger as enum (
  'manual',
  'my_jobs_tap',
  'invoice_drafted',
  'invoice_sent',
  'parts_order_entered',
  'part_in_hand',
  'mark_paid',
  'system'
);

create type public.message_channel as enum ('sms', 'email');

create type public.message_template as enum (
  'eta',
  'invoice',
  'estimate',
  'flag_back'
);

create type public.outbound_status as enum ('queued', 'sent', 'failed');

create type public.qbo_push_status as enum ('pending', 'pushed', 'failed');
