"use client"

import { useRouter } from "next/navigation"
import { useEffect, useRef, useState, useSyncExternalStore } from "react"

import {
  assignRequest,
  createQuickAdd,
  goEnRoute,
  setBoardStatus,
  setRequestPriority,
  softDeleteRequest,
} from "@/app/actions/board"
import { FeedbackSheet } from "@/components/board/feedback-sheet"
import { QuickAddSheet } from "@/components/board/quick-add"
import { Sheet } from "@/components/board/sheet"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  BOARD_CATEGORIES,
  groupBoardByStage,
  type BoardCard,
  type BoardStatus,
  type BoardViewer,
  initials,
  sourceLabel,
  statusLabel,
} from "@/lib/board"
import {
  getBoardStageViewServerSnapshot,
  readBoardStageView,
  subscribeBoardStageView,
  writeBoardStageView,
} from "@/lib/board-stage"
import { crewStandpoint, mapsDirectionsUrl, ownerStatusNeedsReason } from "@/lib/board-rules"
import type { FeedbackContextInput } from "@/lib/feedback"
import {
  getQuickAddQueueServerSnapshot,
  readQuickAddQueue,
  subscribeQuickAddQueue,
  writeQuickAddQueue,
  type BoardCatalog,
  type PendingQuickAdd,
} from "@/lib/quick-add"

type Filter = "all" | "mine"
type Standpoint = "board" | "where"
type Panel =
  | { kind: "enroute" | "detail" | "repeat" | "status" | "assign" | "delete"; card: BoardCard }
  | null

export function BoardShell({
  viewer,
  cards,
  catalog,
  catalogError,
  profileMissing,
  loadError,
}: {
  viewer: BoardViewer
  cards: BoardCard[]
  catalog: BoardCatalog
  catalogError: string | null
  profileMissing: boolean
  loadError: string | null
}) {
  const router = useRouter()
  const [filter, setFilter] = useState<Filter>("all")
  const [standpoint, setStandpoint] = useState<Standpoint>("board")
  const stageView = useSyncExternalStore(
    subscribeBoardStageView,
    readBoardStageView,
    getBoardStageViewServerSnapshot,
  )
  const queue = useSyncExternalStore(
    subscribeQuickAddQueue,
    readQuickAddQueue,
    getQuickAddQueueServerSnapshot,
  )
  const offline = useSyncExternalStore(subscribeOffline, getOfflineSnapshot, getOnlineServerSnapshot)
  const [flushToken, setFlushToken] = useState(0)
  const [quickAddOpen, setQuickAddOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feedbackContext, setFeedbackContext] = useState<FeedbackContextInput>({
    path: "/board",
    filter: "all",
    requestId: null,
    displayNumber: null,
  })
  const [panel, setPanel] = useState<Panel>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [panelError, setPanelError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const revealCall = useRef<{ id: string; until: number } | null>(null)
  const [revealNonce, setRevealNonce] = useState(0)

  useEffect(() => {
    if (offline || viewer.mode !== "authenticated") {
      return
    }
    let cancelled = false
    async function flush() {
      const pending = readQuickAddQueue()
      if (pending.length === 0) {
        return
      }
      const remain: PendingQuickAdd[] = []
      for (const item of pending) {
        try {
          const result = await createQuickAdd(item)
          if (!result.ok) {
            remain.push(item)
          }
        } catch {
          remain.push(item)
        }
      }
      if (cancelled) {
        return
      }
      writeQuickAddQueue(remain)
      if (remain.length !== pending.length) {
        router.refresh()
      }
    }
    void flush()
    return () => {
      cancelled = true
    }
  }, [flushToken, offline, router, viewer.mode])

  const visibleCards = [...queue.map(pendingCard), ...cards].filter((card) =>
    filter === "all" ? true : card.assignedUserId === viewer.profileId,
  )
  const owner = viewer.role === "owner"
  const showWhere = owner && standpoint === "where"
  const stageGroups = groupBoardByStage(visibleCards, stageView)
  const openCount = stageGroups.reduce((total, group) => total + group.cards.length, 0)
  const whereRows = showWhere ? crewStandpoint(catalog.crew, cards) : []
  const whereBusy = whereRows.filter((row) => row.jobs.length > 0).length
  const summary = showWhere
    ? whereRows.length === 0
      ? "No active crew."
      : `${whereBusy} on a call · ${whereRows.length - whereBusy} free`
    : openCount === 0
      ? filter === "mine"
        ? "Nothing assigned to you — check with an owner."
        : "No open calls."
      : `${openCount} open ${openCount === 1 ? "call" : "calls"}`
  const canAdd =
    !profileMissing &&
    !loadError &&
    (viewer.mode === "preview" || Boolean(viewer.profileId))
  const visiblePanel = feedbackOpen ? null : panel

  function openFeedback() {
    const card = panel && !panel.card.pendingSync ? panel.card : null
    setFeedbackContext({
      path: window.location.pathname || "/board",
      filter,
      requestId: card?.id ?? null,
      displayNumber: card?.displayNumber ?? null,
    })
    setFeedbackOpen(true)
  }

  function rememberQueue(next: PendingQuickAdd[]) {
    writeQuickAddQueue(next)
  }

  function showSavedCall(id: string) {
    setStandpoint("board")
    revealCall.current = { id, until: Date.now() + 1500 }
    setRevealNonce((current) => current + 1)
  }

  useEffect(() => {
    const target = revealCall.current
    if (!target || standpoint === "where" || Date.now() > target.until) {
      return
    }
    const scroll = () => {
      document.getElementById(boardCardElementId(target.id))?.scrollIntoView({ block: "center" })
    }
    scroll()
    const followUp = window.setTimeout(scroll, 400)
    return () => window.clearTimeout(followUp)
  }, [revealNonce, standpoint, cards, queue])

  function openCard(card: BoardCard) {
    if (card.pendingSync) {
      return
    }
    const mine =
      filter === "mine" &&
      viewer.profileId !== null &&
      card.assignedUserId === viewer.profileId &&
      (card.status === "assigned" || card.status === "ready")
    setPanelError(null)
    setPanel({ kind: mine ? "enroute" : "detail", card })
  }

  async function confirmEnRoute(card: BoardCard) {
    const popup = window.open("about:blank", "_blank")
    setBusy(true)
    setPanelError(null)
    const origin = await currentPosition()
    const result = await goEnRoute({ requestId: card.id, origin })
    setBusy(false)
    if (!result.ok) {
      popup?.close()
      setPanelError(result.message)
      return
    }
    const url = mapsDirectionsUrl(result.data.address, origin)
    if (popup) {
      popup.location.href = url
    } else {
      window.open(url, "_blank", "noopener,noreferrer")
    }
    const locationNote = origin
      ? ""
      : " Location was off, so the text has no drive time."
    setNotice(`${result.data.notice}${locationNote}`)
    setPanel(null)
    router.refresh()
  }

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="font-display text-2xl leading-none font-bold tracking-wide text-foreground">
              LSP
            </p>
            <p className="text-xs text-muted-foreground">Legend Service Pros</p>
          </div>
          <p className="hidden text-sm font-medium text-muted-foreground sm:block">Board</p>
          <div className="ml-auto flex items-center gap-2">
            <SyncPill
              mode={viewer.mode}
              hasError={Boolean(loadError)}
              offline={offline}
              pending={queue.length}
            />
            <AccountMenu viewer={viewer} onReport={openFeedback} />
          </div>
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-4 px-4 py-4 pb-28">
        {viewer.mode === "preview" ? (
          <p className="rounded-lg border border-border bg-card px-4 py-3 text-sm leading-6">
            Supabase is not connected, so this is the empty Board. Sign-in starts after the
            project URL and anon key are in <span className="font-medium">.env.local</span>.
          </p>
        ) : null}
        {profileMissing ? (
          <p className="rounded-lg border border-border bg-card px-4 py-3 text-sm leading-6">
            This login is not on the crew list yet. Adding the user in Supabase should create a
            profile. An owner sets the role to owner or tech.
          </p>
        ) : null}
        {loadError ? (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm leading-6 text-destructive">
            {loadError}
          </p>
        ) : null}
        {catalogError ? (
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm leading-6 text-destructive">
            {catalogError}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="rounded-lg border border-border bg-card px-4 py-3 text-sm leading-6">
            {notice}
          </p>
        ) : null}

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <div role="group" aria-label="Board filter" className="grid grid-cols-2 gap-2 sm:flex">
              <Button
                type="button"
                size="field"
                variant={filter === "all" ? "default" : "outline"}
                aria-pressed={filter === "all"}
                onClick={() => setFilter("all")}
              >
                All jobs
              </Button>
              <Button
                type="button"
                size="field"
                variant={filter === "mine" ? "default" : "outline"}
                aria-pressed={filter === "mine"}
                onClick={() => setFilter("mine")}
              >
                My jobs
              </Button>
            </div>
            {owner ? (
              <div role="group" aria-label="Board view" className="grid grid-cols-2 gap-2 sm:flex">
                <Button
                  type="button"
                  size="field"
                  variant={standpoint === "board" ? "default" : "outline"}
                  aria-pressed={standpoint === "board"}
                  onClick={() => setStandpoint("board")}
                >
                  Board
                </Button>
                <Button
                  type="button"
                  size="field"
                  variant={standpoint === "where" ? "default" : "outline"}
                  aria-pressed={standpoint === "where"}
                  onClick={() => setStandpoint("where")}
                >
                  Who&apos;s where
                </Button>
              </div>
            ) : null}
            {showWhere ? null : (
              <div role="group" aria-label="Stages" className="grid grid-cols-2 gap-2 sm:flex">
                <Button
                  type="button"
                  size="field"
                  variant={stageView === "live" ? "default" : "outline"}
                  aria-pressed={stageView === "live"}
                  onClick={() => writeBoardStageView("live")}
                >
                  Live stages
                </Button>
                <Button
                  type="button"
                  size="field"
                  variant={stageView === "all" ? "default" : "outline"}
                  aria-pressed={stageView === "all"}
                  onClick={() => writeBoardStageView("all")}
                >
                  All stages
                </Button>
              </div>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{summary}</p>
        </div>

        {showWhere ? (
          <WhosWhere
            rows={whereRows}
            viewer={viewer}
            onOpen={openCard}
            onRepeat={(card) => setPanel({ kind: "repeat", card })}
            onStatus={(card) => {
              setPanelError(null)
              setPanel({ kind: "status", card })
            }}
            onMore={(card) => {
              setPanelError(null)
              setPanel({ kind: "assign", card })
            }}
          />
        ) : (
          <div className="flex flex-col gap-3">
            {stageGroups.map((group) => (
              <CategoryColumn
                key={group.status}
                category={group}
                cards={group.cards}
                viewer={viewer}
                onOpen={openCard}
                onRepeat={(card) => setPanel({ kind: "repeat", card })}
                onStatus={(card) => {
                  setPanelError(null)
                  setPanel({ kind: "status", card })
                }}
                onMore={(card) => {
                  setPanelError(null)
                  setPanel({ kind: "assign", card })
                }}
              />
            ))}
          </div>
        )}
      </main>

      {canAdd ? (
        <Button
          type="button"
          size="field"
          className="fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 min-h-14 shadow-lg"
          onClick={() => setQuickAddOpen(true)}
        >
          + Quick Add
        </Button>
      ) : null}

      <QuickAddSheet
        open={quickAddOpen}
        catalog={catalog}
        onClose={() => setQuickAddOpen(false)}
        onCreated={(message, requestId) => {
          setNotice(message)
          showSavedCall(requestId)
          router.refresh()
        }}
        onQueued={(item) => {
          rememberQueue([...readQuickAddQueue(), item])
          setNotice("Saved on this phone. It will sync when the signal is back.")
          showSavedCall(item.clientId)
          if (navigator.onLine) {
            setFlushToken((current) => current + 1)
          }
        }}
      />

      <FeedbackSheet
        open={feedbackOpen}
        context={feedbackContext}
        onClose={() => setFeedbackOpen(false)}
        onSaved={(message) => {
          setNotice(message)
          setFeedbackOpen(false)
          setPanel(null)
        }}
      />

      <EnRouteSheet
        card={visiblePanel?.kind === "enroute" ? visiblePanel.card : null}
        busy={busy}
        error={panelError}
        onClose={() => setPanel(null)}
        onConfirm={(card) => void confirmEnRoute(card)}
      />
      <DetailSheet
        card={visiblePanel?.kind === "detail" ? visiblePanel.card : null}
        viewer={viewer}
        busy={busy}
        error={panelError}
        onClose={() => setPanel(null)}
        onEnRoute={(card) => {
          setPanelError(null)
          setPanel({ kind: "enroute", card })
        }}
        onStatus={(card) => setPanel({ kind: "status", card })}
        onAssign={(card) => setPanel({ kind: "assign", card })}
        onDelete={(card) => setPanel({ kind: "delete", card })}
        onHigh={(card, priority) => {
          setBusy(true)
          setPanelError(null)
          void setRequestPriority({ requestId: card.id, priority }).then((result) => {
            setBusy(false)
            if (!result.ok) {
              setPanelError(result.message)
              return
            }
            setNotice(priority === "high" ? "Marked High. Nothing was sent." : "High cleared.")
            setPanel(null)
            router.refresh()
          })
        }}
      />
      <RepeatSheet
        card={visiblePanel?.kind === "repeat" ? visiblePanel.card : null}
        onClose={() => setPanel(null)}
      />
      <StatusSheet
        key={visiblePanel?.kind === "status" ? visiblePanel.card.id : "status-closed"}
        card={visiblePanel?.kind === "status" ? visiblePanel.card : null}
        busy={busy}
        error={panelError}
        onClose={() => setPanel(null)}
        onSave={(card, status, reason) => {
          setBusy(true)
          setPanelError(null)
          void setBoardStatus({ requestId: card.id, status, reason }).then((result) => {
            setBusy(false)
            if (!result.ok) {
              setPanelError(result.message)
              return
            }
            setNotice(`${card.displayNumber} is ${statusLabel(status)}.`)
            setPanel(null)
            router.refresh()
          })
        }}
      />
      <AssignSheet
        card={visiblePanel?.kind === "assign" ? visiblePanel.card : null}
        crew={catalog.crew}
        busy={busy}
        error={panelError}
        onClose={() => setPanel(null)}
        onSave={(card, techId) => {
          setBusy(true)
          setPanelError(null)
          void assignRequest({ requestId: card.id, techId }).then((result) => {
            setBusy(false)
            if (!result.ok) {
              setPanelError(result.message)
              return
            }
            if (techId) {
              setNotice(`${card.displayNumber} assigned.`)
            } else {
              const landed = result.data.status ? statusLabel(result.data.status) : null
              setNotice(
                landed
                  ? `${card.displayNumber} unassigned → ${landed}.`
                  : `${card.displayNumber} unassigned.`,
              )
            }
            setPanel(null)
            router.refresh()
          })
        }}
        onDelete={(card) => setPanel({ kind: "delete", card })}
        onHigh={(card) => {
          const priority = card.priority === "high" ? "normal" : "high"
          setBusy(true)
          void setRequestPriority({ requestId: card.id, priority }).then((result) => {
            setBusy(false)
            if (!result.ok) {
              setPanelError(result.message)
              return
            }
            setNotice(priority === "high" ? "Marked High. Nothing was sent." : "High cleared.")
            setPanel(null)
            router.refresh()
          })
        }}
      />
      <DeleteSheet
        card={visiblePanel?.kind === "delete" ? visiblePanel.card : null}
        busy={busy}
        error={panelError}
        onClose={() => setPanel(null)}
        onConfirm={(card) => {
          setBusy(true)
          setPanelError(null)
          void softDeleteRequest(card.id).then((result) => {
            setBusy(false)
            if (!result.ok) {
              setPanelError(result.message)
              return
            }
            setNotice(`${card.displayNumber} removed.`)
            setPanel(null)
            router.refresh()
          })
        }}
      />
    </div>
  )
}

function subscribeOffline(listener: () => void) {
  window.addEventListener("online", listener)
  window.addEventListener("offline", listener)
  return () => {
    window.removeEventListener("online", listener)
    window.removeEventListener("offline", listener)
  }
}

function getOfflineSnapshot() {
  return !navigator.onLine
}

function getOnlineServerSnapshot() {
  return false
}

function boardCardElementId(id: string) {
  return `board-card-${id}`
}

function pendingCard(item: PendingQuickAdd): BoardCard {
  return {
    id: item.clientId,
    displayNumber: "Pending",
    issue: item.issue,
    status: "new",
    priority: "normal",
    assignedUserId: null,
    assigneeName: null,
    propertyName: item.propertyName,
    unitId: item.unitId ?? "pending",
    unitLabel: item.unitLabel,
    address: "",
    contactName: item.contactName,
    contactPhone: null,
    sourceLabel: sourceLabel(item.source),
    ageLabel: "now",
    bumpedAtMs: null,
    createdAtMs: Date.parse(item.createdAt),
    repeatCalls: [],
    pendingSync: true,
  }
}

function currentPosition(): Promise<{ lat: number; lng: number } | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve(null)
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    )
  })
}

function CategoryColumn({
  category,
  cards,
  viewer,
  onOpen,
  onRepeat,
  onStatus,
  onMore,
}: {
  category: { status: BoardStatus; label: string; hint: string }
  cards: BoardCard[]
  viewer: BoardViewer
  onOpen: (card: BoardCard) => void
  onRepeat: (card: BoardCard) => void
  onStatus: (card: BoardCard) => void
  onMore: (card: BoardCard) => void
}) {
  if (cards.length === 0) {
    return (
      <section
        id={`board-stage-${category.status}`}
        aria-label={category.label}
        className="flex min-h-12 scroll-mt-24 items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/50 px-3 py-2"
      >
        <h2 className="text-sm font-medium text-muted-foreground">{category.label}</h2>
        <p className="text-sm tabular-nums text-muted-foreground">0</p>
      </section>
    )
  }

  return (
    <section
      id={`board-stage-${category.status}`}
      aria-label={category.label}
      className="scroll-mt-24 rounded-xl border border-border bg-card"
    >
      <header className="border-b border-border">
        <div className="flex min-h-12 items-center justify-between gap-3 px-3 py-2">
          <div>
            <h2 className="font-display text-xl leading-none font-semibold tracking-wide uppercase">
              {category.label}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">{category.hint}</p>
          </div>
          <p className="font-display text-3xl leading-none tabular-nums">{cards.length}</p>
        </div>
      </header>
      <div className="flex flex-col gap-2 p-2">
        {cards.map((card) => (
          <CallCard
            key={card.id}
            card={card}
            viewer={viewer}
            onOpen={onOpen}
            onRepeat={onRepeat}
            onStatus={onStatus}
            onMore={onMore}
          />
        ))}
      </div>
    </section>
  )
}

function WhosWhere({
  rows,
  viewer,
  onOpen,
  onRepeat,
  onStatus,
  onMore,
}: {
  rows: ReturnType<typeof crewStandpoint>
  viewer: BoardViewer
  onOpen: (card: BoardCard) => void
  onRepeat: (card: BoardCard) => void
  onStatus: (card: BoardCard) => void
  onMore: (card: BoardCard) => void
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-card px-4 py-3 text-sm leading-6">
        No active crew.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2" aria-label="Who's where">
      {rows.map((row) => (
        <section key={row.id} aria-label={row.fullName} className="rounded-xl border border-border bg-card px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-lg leading-none font-semibold tracking-wide">
              {row.fullName}
            </h2>
            <p className="text-xs text-muted-foreground">
              {row.role === "owner" ? "Owner" : "Tech"}
            </p>
          </div>
          {row.jobs.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">Free</p>
          ) : (
            <div className="mt-2 flex flex-col gap-2">
              {row.jobs.map((card) => (
                <CallCard
                  key={card.id}
                  card={card}
                  compact
                  viewer={viewer}
                  onOpen={onOpen}
                  onRepeat={onRepeat}
                  onStatus={onStatus}
                  onMore={onMore}
                />
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  )
}

function CallCard({
  card,
  compact = false,
  viewer,
  onOpen,
  onRepeat,
  onStatus,
  onMore,
}: {
  card: BoardCard
  compact?: boolean
  viewer: BoardViewer
  onOpen: (card: BoardCard) => void
  onRepeat: (card: BoardCard) => void
  onStatus: (card: BoardCard) => void
  onMore: (card: BoardCard) => void
}) {
  const high = card.priority === "high"
  const repeat = card.repeatCalls.length > 0
  const owner = viewer.role === "owner"
  const pad = compact ? "px-3 py-2" : "px-3 py-3"
  return (
    <article
      id={boardCardElementId(card.id)}
      className={
        high
          ? `rounded-lg border border-high/50 bg-high/15 ${pad}`
          : repeat
            ? `rounded-lg border border-amber-700/40 bg-amber-50 ${pad}`
            : `rounded-lg border border-border bg-background ${pad}`
      }
      onContextMenu={(event) => {
        if (!owner || card.pendingSync) {
          return
        }
        event.preventDefault()
        onMore(card)
      }}
    >
      <button type="button" className="w-full text-left" onClick={() => onOpen(card)}>
        <div className="flex items-start justify-between gap-2">
          <p className={compact ? "font-display text-base leading-none tracking-wide" : "font-display text-lg leading-none tracking-wide"}>
            {card.displayNumber}
          </p>
          <span className="inline-flex items-center gap-2">
            {card.pendingSync ? (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <span aria-hidden className="size-2.5 rounded-full bg-amber-500" />
                <span className="sr-only">Pending sync</span>
                Pending
              </span>
            ) : null}
            {high ? <Badge className="bg-high text-high-foreground">High</Badge> : null}
            <span className="text-xs text-muted-foreground tabular-nums">{card.ageLabel}</span>
          </span>
        </div>
        <p className={compact ? "mt-1 text-sm font-medium" : "mt-2 text-sm font-medium"}>
          {card.propertyName} · {card.unitLabel}
        </p>
        <p className="mt-1 text-sm leading-5">{card.issue}</p>
      </button>
      <div className={compact ? "mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground" : "mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"}>
        <span>{card.sourceLabel}</span>
        <span className="inline-flex min-h-6 items-center gap-1">
          <span
            aria-hidden
            className="inline-flex size-6 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground"
          >
            {card.assigneeName ? initials(card.assigneeName) : "—"}
          </span>
          {card.assigneeName ?? "Unassigned"}
        </span>
      </div>
      {repeat || owner ? (
        <div className={compact ? "mt-2 flex flex-wrap gap-2" : "mt-3 flex flex-wrap gap-2"}>
          {repeat ? (
            <Button type="button" size="field" variant="outline" onClick={() => onRepeat(card)}>
              Repeat
            </Button>
          ) : null}
          {owner && !card.pendingSync ? (
            <>
              <Button type="button" size="field" variant="outline" onClick={() => onStatus(card)}>
                {statusLabel(card.status)}
              </Button>
              <Button type="button" size="field" variant="outline" onClick={() => onMore(card)}>
                Assign
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

function EnRouteSheet({
  card,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  card: BoardCard | null
  busy: boolean
  error: string | null
  onClose: () => void
  onConfirm: (card: BoardCard) => void
}) {
  return (
    <Sheet open={card !== null} title="Go en route?" onClose={onClose}>
      {card ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm leading-6">
            {card.propertyName} · {card.unitLabel}. {card.issue}. This moves the call to In
            Progress, texts an ETA when the contact can take one, and opens Maps.
          </p>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button type="button" size="field" disabled={busy} onClick={() => onConfirm(card)}>
            {busy ? "Starting…" : "Go en route"}
          </Button>
        </div>
      ) : null}
    </Sheet>
  )
}

function DetailSheet({
  card,
  viewer,
  busy,
  error,
  onClose,
  onEnRoute,
  onStatus,
  onAssign,
  onDelete,
  onHigh,
}: {
  card: BoardCard | null
  viewer: BoardViewer
  busy: boolean
  error: string | null
  onClose: () => void
  onEnRoute: (card: BoardCard) => void
  onStatus: (card: BoardCard) => void
  onAssign: (card: BoardCard) => void
  onDelete: (card: BoardCard) => void
  onHigh: (card: BoardCard, priority: "normal" | "high") => void
}) {
  const mine =
    card !== null &&
    viewer.profileId !== null &&
    card.assignedUserId === viewer.profileId &&
    (card.status === "assigned" || card.status === "ready")
  return (
    <Sheet open={card !== null} title={card?.displayNumber ?? "Call"} onClose={onClose}>
      {card ? (
        <div className="flex flex-col gap-3 text-sm leading-6">
          <p className="font-medium">
            {card.propertyName} · {card.unitLabel}
          </p>
          <p>{card.issue}</p>
          <p>
            {card.contactName}
            {card.contactPhone ? ` · ${card.contactPhone}` : ""}
          </p>
          <p>
            {statusLabel(card.status)}
            {card.priority === "high" ? " · High" : ""}
          </p>
          {card.repeatCalls.length > 0 ? (
            <p>Repeat unit. {card.repeatCalls.length} other {card.repeatCalls.length === 1 ? "call" : "calls"} in the last two weeks.</p>
          ) : null}
          <div className="flex flex-col gap-2">
            {card.contactPhone ? (
              <Button render={<a href={`tel:${card.contactPhone}`} />} size="field">
                Call {card.contactName}
              </Button>
            ) : null}
            {card.address ? (
              <Button
                render={<a href={mapsDirectionsUrl(card.address)} target="_blank" rel="noreferrer" />}
                variant="outline"
                size="field"
              >
                Open in Maps
              </Button>
            ) : null}
            {mine ? (
              <Button type="button" size="field" onClick={() => onEnRoute(card)}>
                Go en route
              </Button>
            ) : null}
            {viewer.role === "owner" ? (
              <>
                <Button type="button" size="field" variant="outline" onClick={() => onStatus(card)}>
                  Change status
                </Button>
                <Button type="button" size="field" variant="outline" onClick={() => onAssign(card)}>
                  Assign
                </Button>
                <Button
                  type="button"
                  size="field"
                  variant="outline"
                  disabled={busy}
                  onClick={() => onHigh(card, card.priority === "high" ? "normal" : "high")}
                >
                  {card.priority === "high" ? "Clear High" : "Mark High"}
                </Button>
                <Button type="button" size="field" variant="destructive" onClick={() => onDelete(card)}>
                  Delete duplicate
                </Button>
              </>
            ) : null}
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </Sheet>
  )
}

function RepeatSheet({ card, onClose }: { card: BoardCard | null; onClose: () => void }) {
  return (
    <Sheet open={card !== null} title="Recent calls" onClose={onClose}>
      {card ? (
        <ul className="flex flex-col gap-3">
          {card.repeatCalls.map((call) => (
            <li key={call.id} className="rounded-lg border border-border px-3 py-3 text-sm leading-6">
              <p className="font-medium">
                {call.whenLabel} · {call.displayNumber}
              </p>
              <p>{call.issue}</p>
              <p>{statusLabel(call.status)}</p>
              <p>
                {call.bundleCodes.length > 0
                  ? call.bundleCodes.join(", ")
                  : "No bundle on that call yet."}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </Sheet>
  )
}

function StatusSheet({
  card,
  busy,
  error,
  onClose,
  onSave,
}: {
  card: BoardCard | null
  busy: boolean
  error: string | null
  onClose: () => void
  onSave: (card: BoardCard, status: BoardStatus, reason: string) => void
}) {
  const [status, setStatus] = useState<BoardStatus | null>(null)
  const [reason, setReason] = useState("")
  const needsReason =
    card !== null && status !== null && ownerStatusNeedsReason(card.status, status)
  return (
    <Sheet open={card !== null} title="Status" onClose={onClose}>
      {card ? (
        <div className="flex flex-col gap-2">
          {BOARD_CATEGORIES.map((category) => (
            <Button
              key={category.status}
              type="button"
              size="field"
              variant={status === category.status ? "default" : "outline"}
              disabled={category.status === card.status}
              aria-pressed={status === category.status}
              onClick={() => setStatus(category.status)}
            >
              {category.label}
              {category.status === card.status ? " · now" : ""}
            </Button>
          ))}
          {needsReason ? (
            <label className="mt-2 flex flex-col gap-2 text-sm">
              This skips a step. Add a reason.
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className="min-h-24 rounded-lg border border-input bg-transparent px-3 py-2 text-base"
              />
            </label>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button
            type="button"
            size="field"
            disabled={busy || status === null || (needsReason && reason.trim() === "")}
            onClick={() => {
              if (status) {
                onSave(card, status, reason)
              }
            }}
          >
            {busy ? "Saving…" : "Save status"}
          </Button>
        </div>
      ) : null}
    </Sheet>
  )
}

function AssignSheet({
  card,
  crew,
  busy,
  error,
  onClose,
  onSave,
  onDelete,
  onHigh,
}: {
  card: BoardCard | null
  crew: BoardCatalog["crew"]
  busy: boolean
  error: string | null
  onClose: () => void
  onSave: (card: BoardCard, techId: string | null) => void
  onDelete: (card: BoardCard) => void
  onHigh: (card: BoardCard) => void
}) {
  return (
    <Sheet open={card !== null} title="Assign" onClose={onClose}>
      {card ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm leading-6">
            {card.displayNumber} is {card.assigneeName ?? "unassigned"}.
          </p>
          {crew.map((person) => (
            <Button
              key={person.id}
              type="button"
              size="field"
              variant={card.assignedUserId === person.id ? "default" : "outline"}
              disabled={busy}
              onClick={() => onSave(card, person.id)}
            >
              {person.fullName}
            </Button>
          ))}
          {card.assignedUserId ? (
            <Button type="button" size="field" variant="outline" disabled={busy} onClick={() => onSave(card, null)}>
              Unassign
            </Button>
          ) : null}
          <Button type="button" size="field" variant="outline" disabled={busy} onClick={() => onHigh(card)}>
            {card.priority === "high" ? "Clear High" : "Mark High"}
          </Button>
          <Button type="button" size="field" variant="destructive" onClick={() => onDelete(card)}>
            Delete duplicate
          </Button>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </Sheet>
  )
}

function DeleteSheet({
  card,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  card: BoardCard | null
  busy: boolean
  error: string | null
  onClose: () => void
  onConfirm: (card: BoardCard) => void
}) {
  return (
    <Sheet open={card !== null} title="Delete duplicate?" onClose={onClose}>
      {card ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm leading-6">
            {card.displayNumber} leaves the board. This does not close the real call.
          </p>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button type="button" size="field" variant="destructive" disabled={busy} onClick={() => onConfirm(card)}>
            {busy ? "Deleting…" : "Delete"}
          </Button>
        </div>
      ) : null}
    </Sheet>
  )
}

function SyncPill({
  mode,
  hasError,
  offline,
  pending,
}: {
  mode: BoardViewer["mode"]
  hasError: boolean
  offline: boolean
  pending: number
}) {
  const label = hasError
    ? "Not loaded"
    : mode === "preview"
      ? "Preview"
      : offline
        ? "Offline"
        : pending > 0
          ? `${pending} pending`
          : "Synced"
  const dot = hasError
    ? "bg-destructive"
    : mode === "preview" || offline
      ? "bg-muted-foreground"
      : pending > 0
        ? "bg-amber-500"
        : "bg-synced"
  return (
    <span className="inline-flex min-h-12 items-center gap-2 rounded-full border border-border px-3 text-sm">
      <span aria-hidden className={`size-2.5 rounded-full ${dot}`} />
      {label}
    </span>
  )
}

function AccountMenu({
  viewer,
  onReport,
}: {
  viewer: BoardViewer
  onReport: () => void
}) {
  const roleLabel =
    viewer.role === "owner" ? "Owner" : viewer.role === "tech" ? "Tech" : "No role"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="field" className="min-w-12 px-3" />}
      >
        {initials(viewer.fullName)}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-sm text-foreground">
            {viewer.fullName}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuItem disabled className="min-h-12">
          {roleLabel}
        </DropdownMenuItem>
        {viewer.mode === "authenticated" ? (
          <>
            <DropdownMenuSeparator />
            {viewer.profileId ? (
              <DropdownMenuItem className="min-h-12" onClick={onReport}>
                Report / suggest
              </DropdownMenuItem>
            ) : null}
            <form action="/auth/signout" method="post">
              <DropdownMenuItem
                nativeButton
                render={<button type="submit" className="w-full text-left" />}
                className="min-h-12"
              >
                Sign out
              </DropdownMenuItem>
            </form>
          </>
        ) : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<a href="/login" />} className="min-h-12">
              Setup sign-in
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
