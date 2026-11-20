"use client"

/**
 * Board v1 screens, built to the frozen Nov 18 design:
 * phone Board, desktop Board, assign picker, My Jobs.
 * BoardShell owns the data, sheets and actions; these only draw.
 */
import { useRef, useState } from "react"

import { Sheet } from "@/components/board/sheet"
import type { BoardCard } from "@/lib/board"
import {
  PHONE_NOW_STAGES,
  assignChoices,
  minutesSince,
  milesLabel,
  moveId,
  queueLabel,
  repeatBadge,
  type AssignChoice,
  type CrewState,
  type StageGroup,
} from "@/lib/board-v1"

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[13px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
      {children}
    </p>
  )
}

function Pill({
  tone,
  children,
}: {
  tone: "high" | "free" | "ink" | "busy"
  children: React.ReactNode
}) {
  const cls = {
    high: "bg-high text-high-foreground",
    free: "bg-free text-free-foreground",
    ink: "bg-ink text-ink-foreground",
    busy: "bg-busy text-busy-foreground",
  }[tone]
  return (
    <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-bold ${cls}`}>
      {children}
    </span>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { id: T; label: string }[]
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div role="group" aria-label={label} className="flex rounded-[10px] border border-border bg-card p-[3px]">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={
            "h-[38px] rounded-lg px-3 text-sm font-bold " +
            (value === o.id ? "bg-ink text-ink-foreground" : "text-muted-foreground")
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Crew strip
// ---------------------------------------------------------------------------

export function CrewStrip({
  crew,
  wide,
  cards,
  nowMs,
}: {
  crew: CrewState[]
  wide: boolean
  cards: readonly BoardCard[]
  nowMs: number
}) {
  if (crew.length === 0) return null
  const rank = (c: CrewState) => (c.state === "free" ? 0 : c.state === "driving" ? 1 : 2)
  const ordered = [...crew].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
  const count = (s: CrewState["state"]) => crew.filter((c) => c.state === s).length
  const summary = [
    count("free") ? `${count("free")} free` : null,
    count("driving") ? `${count("driving")} driving` : null,
    count("on_site") ? `${count("on_site")} on site` : null,
  ]
    .filter(Boolean)
    .join(" · ")
  return (
    <section aria-label="Crew" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <SectionLabel>Crew</SectionLabel>
        <p className="text-sm font-semibold text-muted-foreground">{summary}</p>
      </div>
      <div
        className={
          "grid gap-2 " +
          (wide ? "grid-cols-[repeat(auto-fill,minmax(13.5rem,1fr))]" : "grid-cols-2")
        }
      >
        {ordered.map((c) => (
          <CrewTile key={c.id} person={c} waiting={waitingFor(c.id, cards)} nowMs={nowMs} wide={wide} />
        ))}
      </div>
    </section>
  )
}

/** Jobs lined up for someone that they haven't started. */
function waitingFor(id: string, cards: readonly BoardCard[]): number {
  return cards.filter(
    (c) => c.assignedUserId === id && (c.status === "assigned" || c.status === "ready" || c.status === "new"),
  ).length
}

function sinceLabel(sinceMs: number | null, nowMs: number): string | null {
  if (sinceMs === null) return null
  const min = Math.max(0, Math.round((nowMs - sinceMs) / 60000))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  return `${h} hr ${min % 60} min`
}

function CrewTile({
  person,
  waiting,
  nowMs,
  wide,
}: {
  person: CrewState
  waiting: number
  nowMs: number
  wide: boolean
}) {
  const free = person.state === "free"
  const status = free ? "Free" : person.state === "driving" ? "Driving" : "On site"
  const since = free ? null : sinceLabel(person.sinceMs, nowMs)
  return (
    <div
      className={
        "flex min-w-0 flex-col gap-0.5 rounded-xl border-l-[6px] bg-card px-3 py-2.5 shadow-[0_0_0_1px_var(--border)] " +
        (free ? "border-l-free-foreground/60" : "border-l-busy-foreground/70")
      }
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
        <p className={"truncate font-extrabold " + (wide ? "text-lg" : "text-[17px]")}>{person.name}</p>
        <span
          className={
            "shrink-0 rounded-md px-2 py-0.5 text-[13px] font-bold " +
            (free ? "bg-free text-free-foreground" : "bg-busy text-busy-foreground")
          }
        >
          {status}
          {since ? ` · ${since}` : ""}
        </span>
      </div>
      <p className="truncate text-[14px] leading-5 text-muted-foreground">
        {free
          ? waiting
            ? `${waiting} job${waiting === 1 ? "" : "s"} lined up`
            : "Nothing lined up"
          : person.state === "driving"
            ? `to ${person.where}`
            : person.where}
      </p>
      {!free && waiting ? (
        <p className="text-[13px] font-semibold text-muted-foreground">
          then {waiting} more
        </p>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

type CardHandlers = {
  onOpen: (card: BoardCard) => void
  onAssign: (card: BoardCard) => void
}

function subLine(card: BoardCard): string {
  return `${card.issue} · ${card.sourceLabel.toLowerCase()}`
}

function cardTitle(card: BoardCard): string {
  return `${card.propertyName} ${card.unitLabel}`
}

/** New / Ready card on the phone: title, issue, badges, one big button. */
function PhoneJobCard({
  card,
  all,
  nowMs,
  canAssign,
  onOpen,
  onAssign,
}: CardHandlers & { card: BoardCard; all: BoardCard[]; nowMs: number; canAssign: boolean }) {
  const high = card.priority === "high"
  const repeat = repeatBadge(card, nowMs)
  const queued = queueLabel(card, all)
  return (
    <article
      id={`board-card-${card.id}`}
      className={
        "flex items-center gap-3 rounded-xl bg-card px-3.5 py-3 " +
        (high ? "border-2 border-high" : "border border-border")
      }
    >
      <button type="button" onClick={() => onOpen(card)} className="min-w-0 flex-1 text-left">
        <p className="truncate text-lg leading-tight font-bold">{cardTitle(card)}</p>
        <p className="truncate text-sm text-muted-foreground">{subLine(card)}</p>
        <span className="mt-1 flex flex-wrap gap-1.5">
          {card.pendingSync ? <Pill tone="free">Saving…</Pill> : null}
          {high ? <Pill tone="high">HIGH</Pill> : null}
          {repeat ? <Pill tone="free">{repeat}</Pill> : null}
          {queued ? <Pill tone="ink">{queued}</Pill> : null}
        </span>
      </button>
      {canAssign && !card.pendingSync ? (
        queued ? (
          <button
            type="button"
            onClick={() => onAssign(card)}
            className="h-12 shrink-0 rounded-[10px] border-2 border-ink px-4 text-base font-bold"
          >
            Change
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onAssign(card)}
            className="h-12 shrink-0 rounded-[10px] bg-primary px-4 text-base font-bold text-primary-foreground"
          >
            Assign
          </button>
        )
      ) : null}
    </article>
  )
}

function liveLine(card: BoardCard, nowMs: number): string {
  const who = card.assigneeName ? card.assigneeName.split(" ")[0] : "Someone"
  const name = who.charAt(0).toUpperCase() + who.slice(1)
  if (!card.fieldState) return `${name} · started`
  return card.fieldState.kind === "driving"
    ? `${name} · driving ${minutesSince(card.fieldState.sinceMs, nowMs)}`
    : `${name} · on site`
}

/** Compact desktop card for every stage. */
function DeskCard({
  card,
  all,
  nowMs,
  canAssign,
  dashed,
  onOpen,
  onAssign,
}: CardHandlers & {
  card: BoardCard
  all: BoardCard[]
  nowMs: number
  canAssign: boolean
  dashed?: boolean
}) {
  const high = card.priority === "high"
  const repeat = repeatBadge(card, nowMs)
  const queued = queueLabel(card, all)
  const assignable = canAssign && !card.pendingSync && (card.status === "new" || card.status === "assigned" || card.status === "ready")
  const sub =
    card.status === "in_progress"
      ? card.fieldState
        ? card.fieldState.kind === "on_site"
          ? `${liveLine(card, nowMs).split(" · ")[0]} · on site ${minutesSince(card.fieldState.sinceMs, nowMs)}`
          : liveLine(card, nowMs)
        : liveLine(card, nowMs)
      : subLine(card)
  return (
    <article
      id={`board-card-${card.id}`}
      className={
        "rounded-[10px] bg-card px-3 py-2.5 " +
        (high ? "border-2 border-high" : dashed ? "border border-dashed border-muted-foreground/50" : "border border-border")
      }
    >
      <button type="button" onClick={() => onOpen(card)} className="block w-full text-left">
        <p className="text-base leading-tight font-bold">{cardTitle(card)}</p>
        <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{sub}</p>
      </button>
      {high || repeat || queued || assignable || card.pendingSync ? (
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="flex flex-wrap gap-1">
            {card.pendingSync ? <Pill tone="free">Saving…</Pill> : null}
            {high ? <Pill tone="high">HIGH</Pill> : null}
            {repeat ? <Pill tone="free">{repeat}</Pill> : null}
            {queued ? <Pill tone="ink">{queued}</Pill> : null}
          </span>
          {assignable ? (
            <button
              type="button"
              onClick={() => onAssign(card)}
              className={"text-sm font-bold " + (queued ? "text-muted-foreground" : "text-primary")}
            >
              {queued ? "Change" : "Assign"}
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

// ---------------------------------------------------------------------------
// Phone Board
// ---------------------------------------------------------------------------

export function PhoneBoard({
  groups,
  all,
  nowMs,
  canAssign,
  onOpen,
  onAssign,
}: CardHandlers & { groups: StageGroup[]; all: BoardCard[]; nowMs: number; canAssign: boolean }) {
  const [showAll, setShowAll] = useState(false)
  const now = PHONE_NOW_STAGES.map((id) => groups.find((g) => g.id === id)).filter(
    (g): g is StageGroup => Boolean(g),
  )
  const rest = groups.filter((g) => !PHONE_NOW_STAGES.includes(g.id))
  const restCount = rest.reduce((t, g) => t + g.cards.length, 0)

  return (
    <div className="flex flex-col gap-3">
      {now.map((g) =>
        g.id === "in_progress" ? (
          <section key={g.id} className="flex flex-col gap-2">
            <SectionLabel>
              {g.label} · {g.cards.length}
            </SectionLabel>
            {g.cards.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nobody is out on a job.</p>
            ) : (
              <div className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
                {g.cards.map((card) => (
                  <button
                    key={card.id}
                    id={`board-card-${card.id}`}
                    type="button"
                    onClick={() => onOpen(card)}
                    className="flex min-h-11 items-center justify-between gap-3 px-3.5 py-2 text-left"
                  >
                    <span className="truncate text-[15px] font-bold">{cardTitle(card)}</span>
                    <span className="shrink-0 text-[15px] text-muted-foreground">{liveLine(card, nowMs)}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        ) : (
          <section key={g.id} className="flex flex-col gap-2">
            <SectionLabel>
              {g.label} · {g.cards.length}
            </SectionLabel>
            {g.cards.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {g.id === "new" ? "No new calls." : "Nothing ready."}
              </p>
            ) : (
              g.cards.map((card) => (
                <PhoneJobCard
                  key={card.id}
                  card={card}
                  all={all}
                  nowMs={nowMs}
                  canAssign={canAssign}
                  onOpen={onOpen}
                  onAssign={onAssign}
                />
              ))
            )}
          </section>
        ),
      )}

      {showAll ? (
        rest.map((g) => (
          <section key={g.id} className="flex flex-col gap-2">
            <SectionLabel>
              {g.label} · {g.cards.length}
            </SectionLabel>
            {g.cards.length === 0 ? (
              <p className="text-sm text-muted-foreground">None.</p>
            ) : (
              g.cards.map((card) => (
                <DeskCard
                  key={card.id}
                  card={card}
                  all={all}
                  nowMs={nowMs}
                  canAssign={canAssign}
                  dashed={card.status === "estimate_out"}
                  onOpen={onOpen}
                  onAssign={onAssign}
                />
              ))
            )}
          </section>
        ))
      ) : null}
      <button
        type="button"
        onClick={() => setShowAll((v) => !v)}
        className="h-12 rounded-[10px] border border-ink/30 bg-card text-[15px] font-bold"
      >
        {showAll ? "Show fewer stages" : `Show all stages · ${restCount} more`}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Desktop Board: one column per stage
// ---------------------------------------------------------------------------

export function DeskBoard({
  groups,
  all,
  nowMs,
  canAssign,
  onOpen,
  onAssign,
}: CardHandlers & { groups: StageGroup[]; all: BoardCard[]; nowMs: number; canAssign: boolean }) {
  return (
    <div className="grid grid-cols-7 items-start gap-3">
      {groups.map((g) => (
        <section key={g.id} aria-label={g.label} className="flex min-w-0 flex-col gap-2 rounded-xl bg-secondary p-2.5">
          <div className="flex items-baseline justify-between px-1 text-[15px] font-bold">
            <h2>{g.label}</h2>
            <span className="tabular-nums text-muted-foreground">{g.cards.length}</span>
          </div>
          {g.id === "invoiced" ? (
            <p className="px-1 text-[13px] leading-snug text-muted-foreground">
              Waiting on payment. Paid jobs close and drop off the Board.
            </p>
          ) : g.id === "estimate" ? (
            <>
              <EstimatePart
                label="Drafting"
                cards={g.cards.filter((c) => c.status === "to_estimate")}
                all={all}
                nowMs={nowMs}
                canAssign={canAssign}
                onOpen={onOpen}
                onAssign={onAssign}
              />
              <EstimatePart
                label="Out to property"
                dashed
                cards={g.cards.filter((c) => c.status === "estimate_out")}
                all={all}
                nowMs={nowMs}
                canAssign={canAssign}
                onOpen={onOpen}
                onAssign={onAssign}
              />
            </>
          ) : (
            g.cards.map((card) => (
              <DeskCard
                key={card.id}
                card={card}
                all={all}
                nowMs={nowMs}
                canAssign={canAssign}
                onOpen={onOpen}
                onAssign={onAssign}
              />
            ))
          )}
        </section>
      ))}
    </div>
  )
}

function EstimatePart({
  label,
  dashed,
  cards,
  ...rest
}: CardHandlers & {
  label: string
  dashed?: boolean
  cards: BoardCard[]
  all: BoardCard[]
  nowMs: number
  canAssign: boolean
}) {
  if (cards.length === 0) return null
  return (
    <>
      <p className="px-1 pt-1 text-[11px] font-bold tracking-[0.08em] text-muted-foreground uppercase">{label}</p>
      {cards.map((card) => (
        <DeskCard key={card.id} card={card} dashed={dashed} {...rest} />
      ))}
    </>
  )
}

// ---------------------------------------------------------------------------
// Assign picker
// ---------------------------------------------------------------------------

export function AssignPicker({
  card,
  crew,
  busy,
  error,
  onClose,
  onPick,
  onUnassign,
  onHigh,
  onDelete,
}: {
  card: BoardCard | null
  crew: CrewState[]
  busy: boolean
  error: string | null
  onClose: () => void
  onPick: (card: BoardCard, person: AssignChoice) => void
  onUnassign: (card: BoardCard) => void
  onHigh: (card: BoardCard) => void
  onDelete: (card: BoardCard) => void
}) {
  if (!card) return null
  const { free, busy: working } = assignChoices(card, crew)
  const distance = (c: AssignChoice) => (c.miles === null ? "location unknown" : milesLabel(c.miles))
  const current = (c: AssignChoice) => c.id === card.assignedUserId

  return (
    <Sheet open title="Assign" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div>
          <p className="text-2xl leading-tight font-extrabold">{cardTitle(card)}</p>
          <p className="text-base text-muted-foreground">
            {card.issue}
            {card.priority === "high" ? " · High" : ""}
          </p>
        </div>

        <SectionLabel>Free now · closest first</SectionLabel>
        {free.length === 0 ? (
          <p className="text-sm text-muted-foreground">Everyone is on a job right now.</p>
        ) : (
          free.map((c, i) => (
            <button
              key={c.id}
              type="button"
              disabled={busy}
              onClick={() => onPick(card, c)}
              className={
                "flex h-16 items-center justify-between rounded-xl px-4 text-left disabled:opacity-60 " +
                (i === 0 ? "bg-primary text-primary-foreground" : "border-2 border-ink bg-card")
              }
            >
              <span className="text-xl font-bold">
                {c.name}
                {current(c) ? <span className="ml-2 text-sm font-medium opacity-80">has it</span> : null}
              </span>
              <span className={"text-[15px] " + (i === 0 ? "font-semibold" : "text-muted-foreground")}>
                {distance(c)}
              </span>
            </button>
          ))
        )}

        {working.length > 0 ? (
          <>
            <SectionLabel>Busy · add as their next job</SectionLabel>
            {working.map((c) => (
              <button
                key={c.id}
                type="button"
                disabled={busy}
                onClick={() => onPick(card, c)}
                className="flex min-h-14 items-center justify-between gap-3 rounded-xl border border-border bg-secondary/60 px-4 py-2 text-left disabled:opacity-60"
              >
                <span className="text-lg font-bold">
                  {c.name}
                  {current(c) ? <span className="ml-2 text-sm font-medium text-muted-foreground">has it</span> : null}
                </span>
                <span className="text-right text-sm text-muted-foreground">
                  {c.state === "on_site" ? `on site at ${c.where}` : `driving to ${c.where}`}
                </span>
              </button>
            ))}
          </>
        ) : null}

        <p className="text-sm leading-6 text-muted-foreground">
          It shows up on their My Jobs. Nothing goes to the property until they tap On my way.
        </p>
        {error ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-3 text-sm">
          {card.assignedUserId ? (
            <button type="button" disabled={busy} onClick={() => onUnassign(card)} className="min-h-11 underline">
              Unassign
            </button>
          ) : null}
          <button type="button" disabled={busy} onClick={() => onHigh(card)} className="min-h-11 underline">
            {card.priority === "high" ? "Clear High" : "Mark High"}
          </button>
          <button type="button" disabled={busy} onClick={() => onDelete(card)} className="min-h-11 text-destructive underline">
            Delete duplicate
          </button>
        </div>
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// My Jobs
// ---------------------------------------------------------------------------

export function MyJobsView({
  jobs,
  nowMs,
  saving,
  onOpenJob,
  onReorder,
}: {
  jobs: BoardCard[]
  nowMs: number
  saving: boolean
  onOpenJob: (card: BoardCard) => void
  /** Called with the full queue (everything not In Progress) in its new order. */
  onReorder: (ids: string[]) => void
}) {
  const live = jobs.find((j) => j.status === "in_progress") ?? null
  const queue = jobs.filter((j) => j.status !== "in_progress")
  const next = live ?? queue[0] ?? null
  const after = live ? queue : queue.slice(1)

  if (!next) {
    return (
      <div className="rounded-xl border border-border bg-card px-4 py-6 text-base leading-7">
        <p className="font-bold">No jobs assigned to you.</p>
        <p className="text-muted-foreground">Check the Board or ask an owner.</p>
      </div>
    )
  }

  const repeat = repeatBadge(next, nowMs)
  const queueIds = queue.map((j) => j.id)
  // Dragging works on the "after that" list; its index 0 is queue index (live ? 0 : 1).
  const offset = live ? 0 : 1

  return (
    <div className="flex flex-col gap-3">
      <article className="flex flex-col gap-2 rounded-2xl border-2 border-primary bg-card p-4">
        <p className="text-[13px] font-extrabold tracking-[0.08em] text-primary uppercase">
          {live ? "Now" : "Next"}
        </p>
        <h2 className="text-2xl leading-tight font-extrabold">{cardTitle(next)}</h2>
        <p className="text-[17px] text-muted-foreground">
          {next.issue}
          {next.fieldState ? ` · ${next.fieldState.kind === "driving" ? "driving" : "on site"} ${minutesSince(next.fieldState.sinceMs, nowMs)}` : ""}
        </p>
        {repeat || next.priority === "high" ? (
          <span className="flex flex-wrap gap-1.5">
            {next.priority === "high" ? <Pill tone="high">HIGH</Pill> : null}
            {repeat ? <Pill tone="free">{repeat}</Pill> : null}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => onOpenJob(next)}
          className="mt-1 h-14 rounded-xl bg-primary text-xl font-bold text-primary-foreground"
        >
          Open job
        </button>
      </article>

      {after.length > 0 ? (
        <>
          <SectionLabel>After that</SectionLabel>
          <ReorderList
            items={after}
            saving={saving}
            onOpen={onOpenJob}
            onMove={(from, to) => {
              if (to < 0 && !live) {
                // Up past the top: becomes Next.
                onReorder(moveId(queueIds, from + offset, 0))
                return
              }
              onReorder(moveId(queueIds, from + offset, Math.max(0, to) + offset))
            }}
          />
          <p className="text-sm leading-6 text-muted-foreground">
            Drag ≡ to change your order. Owners see it on the Board. Your jobs stay on this
            phone if you lose signal.
          </p>
        </>
      ) : null}
    </div>
  )
}

/** Pointer drag on the handle, plus arrow keys on the focused handle. */
function ReorderList({
  items,
  saving,
  onOpen,
  onMove,
}: {
  items: BoardCard[]
  saving: boolean
  onOpen: (card: BoardCard) => void
  onMove: (from: number, to: number) => void
}) {
  const listRef = useRef<HTMLOListElement>(null)
  const [drag, setDrag] = useState<{ from: number; over: number; dy: number } | null>(null)
  const startY = useRef(0)

  function indexAt(clientY: number): number {
    const rows = Array.from(listRef.current?.children ?? []) as HTMLElement[]
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i]!.getBoundingClientRect()
      if (clientY < r.top + r.height / 2) return i
    }
    return rows.length - 1
  }

  return (
    <ol ref={listRef} className="flex flex-col gap-2" aria-busy={saving}>
      {items.map((card, i) => {
        const dragging = drag?.from === i
        const shift =
          drag && !dragging
            ? drag.from < i && drag.over >= i
              ? "-translate-y-2"
              : drag.from > i && drag.over <= i
                ? "translate-y-2"
                : ""
            : ""
        return (
          <li
            key={card.id}
            className={
              "flex items-center gap-2 rounded-xl border border-border bg-card transition-transform " +
              (dragging ? "relative z-10 shadow-lg" : shift)
            }
            style={dragging ? { transform: `translateY(${drag.dy}px)` } : undefined}
          >
            <button type="button" onClick={() => onOpen(card)} className="min-w-0 flex-1 px-4 py-3 text-left">
              <p className="truncate text-lg leading-tight font-bold">{cardTitle(card)}</p>
              <p className="truncate text-[15px] text-muted-foreground">{card.issue}</p>
            </button>
            <button
              type="button"
              aria-label={`Move ${cardTitle(card)}. Use the up and down arrow keys.`}
              disabled={saving}
              className="flex h-14 w-12 shrink-0 cursor-grab touch-none items-center justify-center text-2xl text-muted-foreground active:cursor-grabbing"
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId)
                startY.current = e.clientY
                setDrag({ from: i, over: i, dy: 0 })
              }}
              onPointerMove={(e) => {
                if (!drag) return
                setDrag({ ...drag, dy: e.clientY - startY.current, over: indexAt(e.clientY) })
              }}
              onPointerUp={(e) => {
                if (!drag) return
                const listTop = listRef.current?.getBoundingClientRect().top ?? 0
                const to = e.clientY < listTop - 24 ? -1 : drag.over
                setDrag(null)
                if (to !== drag.from) onMove(drag.from, to)
              }}
              onPointerCancel={() => setDrag(null)}
              onKeyDown={(e) => {
                if (e.key === "ArrowUp") {
                  e.preventDefault()
                  onMove(i, i - 1)
                } else if (e.key === "ArrowDown" && i < items.length - 1) {
                  e.preventDefault()
                  onMove(i, i + 1)
                }
              }}
            >
              <span aria-hidden>≡</span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
