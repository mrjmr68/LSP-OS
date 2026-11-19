"use client"

import { useRouter } from "next/navigation"
import { useEffect, useRef, useState, useSyncExternalStore } from "react"

import {
  assignRequest,
  createQuickAdd,
  reorderMyJobs,
  setBoardStatus,
  setRequestPriority,
  softDeleteRequest,
} from "@/app/actions/board"
import {
  AssignPicker,
  CrewStrip,
  DeskBoard,
  MyJobsView,
  PhoneBoard,
  Segmented,
} from "@/components/board/board-v1"
import { usePositionReporter } from "@/components/board/use-position"
import { FeedbackSheet } from "@/components/board/feedback-sheet"
import { useVisitFlush } from "@/components/visit/visit-sync"
import { QuickAddSheet } from "@/components/board/quick-add"
import { Sheet } from "@/components/board/sheet"
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
  type BoardCard,
  type BoardStatus,
  type BoardViewer,
  initials,
  sourceLabel,
  statusLabel,
} from "@/lib/board"
import { crewStates, groupByDisplayStage, myJobs } from "@/lib/board-v1"
import {
  mapsDirectionsUrl,
  ownerStatusNeedsReason,
} from "@/lib/board-rules"
import type { FeedbackContextInput } from "@/lib/feedback"
import {
  getQuickAddQueueServerSnapshot,
  readQuickAddQueue,
  subscribeQuickAddQueue,
  writeQuickAddQueue,
  type BoardCatalog,
  type PendingQuickAdd,
} from "@/lib/quick-add"
import {
  getVisitQueueServerSnapshot,
  readVisitQueue,
  subscribeVisitQueue,
} from "@/lib/visit"

type View = "board" | "mine"
type Panel =
  | { kind: "detail" | "repeat" | "status" | "assign" | "delete"; card: BoardCard }
  | null

export function BoardShell({
  viewer,
  cards,
  catalog,
  catalogError,
  profileMissing,
  loadError,
  initialView,
}: {
  viewer: BoardViewer
  cards: BoardCard[]
  catalog: BoardCatalog
  catalogError: string | null
  profileMissing: boolean
  loadError: string | null
  initialView?: View
}) {
  const router = useRouter()
  const owner = viewer.role === "owner"
  // Techs land on My Jobs; owners on the Board. Field screens send people back to My Jobs.
  const [view, setView] = useState<View>(initialView ?? (owner ? "board" : "mine"))
  const queue = useSyncExternalStore(
    subscribeQuickAddQueue,
    readQuickAddQueue,
    getQuickAddQueueServerSnapshot,
  )
  const visitQueue = useSyncExternalStore(
    subscribeVisitQueue,
    readVisitQueue,
    getVisitQueueServerSnapshot,
  )
  useVisitFlush(() => router.refresh())
  const offline = useSyncExternalStore(subscribeOffline, getOfflineSnapshot, getOnlineServerSnapshot)
  usePositionReporter(viewer.mode === "authenticated" && Boolean(viewer.profileId) && !offline)
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
  const [detailNote, setDetailNote] = useState<string | null>(null)
  const [directionsUrl, setDirectionsUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [reordering, setReordering] = useState(false)
  // A reorder shows at once; it's dropped as soon as fresh cards arrive from the server.
  const [optimistic, setOptimistic] = useState<{ base: BoardCard[]; ids: string[] } | null>(null)
  const optimisticOrder = optimistic && optimistic.base === cards ? optimistic.ids : null
  const revealCall = useRef<{ id: string; until: number } | null>(null)
  const [revealNonce, setRevealNonce] = useState(0)
  const [nowMs, setNowMs] = useState(() => Date.now())

  // Minutes on site / driving tick along.
  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 60_000)
    return () => window.clearInterval(t)
  }, [])

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

  const allCards = [...queue.map(pendingCard), ...cards]
  const groups = groupByDisplayStage(allCards)
  const crew = owner ? crewStates(catalog.crew, cards) : []
  const mine = (() => {
    const list = myJobs(cards, viewer.profileId)
    if (!optimisticOrder) return list
    const rank = new Map(optimisticOrder.map((id, index) => [id, index]))
    return [...list].sort((a, b) => {
      if (a.status === "in_progress" || b.status === "in_progress") {
        return Number(b.status === "in_progress") - Number(a.status === "in_progress")
      }
      return (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999)
    })
  })()
  const canAdd =
    !profileMissing &&
    !loadError &&
    (viewer.mode === "preview" || Boolean(viewer.profileId))
  const visiblePanel = feedbackOpen ? null : panel

  function openFeedback() {
    const card = panel && !panel.card.pendingSync ? panel.card : null
    setFeedbackContext({
      path: window.location.pathname || "/board",
      filter: view === "mine" ? "mine" : "all",
      requestId: card?.id ?? null,
      displayNumber: card?.displayNumber ?? null,
    })
    setFeedbackOpen(true)
  }

  function rememberQueue(next: PendingQuickAdd[]) {
    writeQuickAddQueue(next)
  }

  function showSavedCall(id: string) {
    revealCall.current = { id, until: Date.now() + 1500 }
    setRevealNonce((current) => current + 1)
  }

  useEffect(() => {
    const target = revealCall.current
    if (!target || Date.now() > target.until) {
      return
    }
    const scroll = () => {
      document.getElementById(boardCardElementId(target.id))?.scrollIntoView({ block: "center" })
    }
    scroll()
    const followUp = window.setTimeout(scroll, 400)
    return () => window.clearTimeout(followUp)
  }, [revealNonce, cards, queue])

  function openCard(card: BoardCard) {
    if (card.pendingSync) {
      return
    }
    const isMine =
      viewer.profileId !== null && card.assignedUserId === viewer.profileId
    if (isMine && card.status === "in_progress") {
      router.push(`/board/visit/${card.id}`)
      return
    }
    if (card.status === "parts" && (isMine || owner)) {
      router.push(`/board/visit/${card.id}`)
      return
    }
    if (isMine && (card.status === "assigned" || card.status === "ready")) {
      router.push(`/board/visit/${card.id}`)
      return
    }
    setPanelError(null)
    setDetailNote(null)
    setDirectionsUrl(null)
    setPanel({ kind: "detail", card })
  }

  function openAssign(card: BoardCard) {
    setPanelError(null)
    setPanel({ kind: "assign", card })
  }

  function saveOrder(ids: string[]) {
    setOptimistic({ base: cards, ids })
    setReordering(true)
    void reorderMyJobs(ids).then((result) => {
      setReordering(false)
      if (!result.ok) {
        setOptimistic(null)
        setNotice(result.message)
        return
      }
      router.refresh()
    })
  }

  function finishAssign(
    card: BoardCard,
    result: Awaited<ReturnType<typeof assignRequest>>,
    message: string,
  ) {
    setBusy(false)
    if (!result.ok) {
      setPanelError(result.message)
      return
    }
    setNotice(message)
    setPanel(null)
    router.refresh()
  }

  function setHigh(card: BoardCard, priority: "high" | "normal") {
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
  }

  const notices = (
    <>
      {viewer.mode === "preview" ? (
        <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm leading-6">
          Supabase is not connected, so this is the empty Board. Sign-in starts after the
          project URL and anon key are in <span className="font-medium">.env.local</span>.
        </p>
      ) : null}
      {profileMissing ? (
        <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm leading-6">
          This login is not on the crew list yet. An owner adds you in Setup → Team.
        </p>
      ) : null}
      {loadError ? (
        <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm leading-6 text-destructive">
          {loadError}
        </p>
      ) : null}
      {catalogError ? (
        <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm leading-6 text-destructive">
          {catalogError}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="flex items-start justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm leading-6">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="shrink-0 text-muted-foreground underline">
            OK
          </button>
        </p>
      ) : null}
    </>
  )

  const sync = (
    <SyncPill
      mode={viewer.mode}
      hasError={Boolean(loadError)}
      offline={offline}
      pending={queue.length + visitQueue.length}
    />
  )

  return (
    <div className="flex min-h-full flex-col">
      {/* Desktop: dark bar across the top */}
      <header className="sticky top-0 z-20 hidden items-center gap-2 bg-ink px-7 py-3.5 text-ink-foreground lg:flex">
        <p className="mr-4 text-xl font-extrabold">LSP</p>
        <nav aria-label="Main" className="flex items-center gap-1">
          <TopTab active={view === "board"} onClick={() => setView("board")}>
            Board
          </TopTab>
          <TopTab active={view === "mine"} onClick={() => setView("mine")}>
            My jobs
          </TopTab>
          {owner ? (
            <a href="/setup" className="rounded-[10px] px-4 py-2.5 text-[17px] font-bold text-ink-foreground/85 hover:text-ink-foreground">
              Setup
            </a>
          ) : null}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          {sync}
          {canAdd ? (
            <button
              type="button"
              onClick={() => setQuickAddOpen(true)}
              className="h-11 rounded-[10px] bg-primary px-4 text-[17px] font-bold text-primary-foreground"
            >
              Quick add
            </button>
          ) : null}
          <AccountMenu viewer={viewer} onReport={openFeedback} />
        </div>
      </header>

      {/* Phone: big title, the view switch, the account menu */}
      <header className="flex items-center justify-between gap-2 px-5 pt-5 pb-2 lg:hidden">
        <h1 className="text-[30px] leading-none font-extrabold">{view === "mine" ? "My jobs" : "Board"}</h1>
        <div className="flex items-center gap-2">
          {owner ? (
            <Segmented
              label="Show"
              value={view}
              onChange={setView}
              options={[
                { id: "board", label: "All jobs" },
                { id: "mine", label: "My jobs" },
              ]}
            />
          ) : (
            sync
          )}
          <AccountMenu viewer={viewer} onReport={openFeedback} />
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-3 px-5 pt-1 pb-28 lg:px-7 lg:pt-4 lg:pb-8">
        {notices}
        {view === "mine" ? (
          <div className="mx-auto flex w-full max-w-md flex-col gap-3">
            {owner ? <div className="lg:hidden">{sync}</div> : null}
            <MyJobsView
              jobs={mine}
              nowMs={nowMs}
              saving={reordering}
              onOpenJob={(card) => openCard(card)}
              onReorder={saveOrder}
            />
          </div>
        ) : (
          <>
            {owner ? (
              <>
                <div className="lg:hidden">
                  <CrewStrip crew={crew} wide={false} />
                </div>
                <div className="hidden lg:block">
                  <CrewStrip crew={crew} wide />
                </div>
              </>
            ) : null}
            <div className="lg:hidden">
              <PhoneBoard
                groups={groups}
                all={allCards}
                nowMs={nowMs}
                canAssign={owner}
                onOpen={(card) => openCard(card)}
                onAssign={openAssign}
              />
            </div>
            <div className="hidden lg:block">
              <DeskBoard
                groups={groups}
                all={allCards}
                nowMs={nowMs}
                canAssign={owner}
                onOpen={(card) => openCard(card)}
                onAssign={openAssign}
              />
            </div>
          </>
        )}
      </main>

      {/* Phone: bottom bar */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 flex gap-2 border-t border-border bg-card px-3 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden"
      >
        {owner ? null : (
          <BottomTab onClick={() => setView(view === "mine" ? "board" : "mine")}>
            {view === "mine" ? "Board" : "My jobs"}
          </BottomTab>
        )}
        {canAdd ? <BottomTab onClick={() => setQuickAddOpen(true)}>Quick add</BottomTab> : null}
        {owner ? <BottomTab href="/setup">Setup</BottomTab> : null}
      </nav>

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

      <DetailSheet
        card={visiblePanel?.kind === "detail" ? visiblePanel.card : null}
        viewer={viewer}
        busy={busy}
        error={panelError}
        note={visiblePanel?.kind === "detail" ? detailNote : null}
        directionsUrl={visiblePanel?.kind === "detail" ? directionsUrl : null}
        onClose={() => {
          setPanel(null)
          setDetailNote(null)
          setDirectionsUrl(null)
        }}
        onEnRoute={(card) => router.push(`/board/visit/${card.id}`)}
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
      <AssignPicker
        card={visiblePanel?.kind === "assign" ? visiblePanel.card : null}
        crew={crew}
        busy={busy}
        error={panelError}
        onClose={() => setPanel(null)}
        onPick={(card, person) => {
          setBusy(true)
          setPanelError(null)
          void assignRequest({
            requestId: card.id,
            techId: person.id,
            asNext: person.state !== "free",
          }).then((result) =>
            finishAssign(
              card,
              result,
              person.state === "free"
                ? `${person.name} has ${card.propertyName} ${card.unitLabel}.`
                : `${card.propertyName} ${card.unitLabel} is ${person.name}'s next job.`,
            ),
          )
        }}
        onUnassign={(card) => {
          setBusy(true)
          setPanelError(null)
          void assignRequest({ requestId: card.id, techId: null }).then((result) => {
            const landed = result.ok && result.data.status ? statusLabel(result.data.status) : null
            finishAssign(
              card,
              result,
              landed ? `${card.displayNumber} unassigned → ${landed}.` : `${card.displayNumber} unassigned.`,
            )
          })
        }}
        onHigh={(card) => setHigh(card, card.priority === "high" ? "normal" : "high")}
        onDelete={(card) => setPanel({ kind: "delete", card })}
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


function TopTab({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={
        "rounded-[10px] px-4 py-2.5 text-[17px] font-bold " +
        (active ? "bg-card text-foreground" : "text-ink-foreground/85 hover:text-ink-foreground")
      }
    >
      {children}
    </button>
  )
}

function BottomTab({
  active = false,
  href,
  onClick,
  children,
}: {
  active?: boolean
  href?: string
  onClick?: () => void
  children: React.ReactNode
}) {
  const cls =
    "flex h-14 flex-1 items-center justify-center rounded-xl text-[17px] font-bold " +
    (active ? "bg-ink text-ink-foreground" : "border-2 border-ink bg-card")
  if (href) {
    return (
      <a href={href} className={cls}>
        {children}
      </a>
    )
  }
  return (
    <button type="button" aria-current={active ? "page" : undefined} onClick={onClick} className={cls}>
      {children}
    </button>
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
    myJobsPosition: null,
    propertyLat: null,
    propertyLng: null,
    fieldState: null,
  }
}



function DetailSheet({
  card,
  viewer,
  busy,
  error,
  note,
  directionsUrl,
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
  note: string | null
  directionsUrl: string | null
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
          {note ? (
            <p role="status" className="text-sm leading-6">
              {note}
            </p>
          ) : null}
          <div className="flex flex-col gap-2">
            {directionsUrl ? (
              <Button
                render={
                  <a href={directionsUrl} target="_blank" rel="noreferrer" />
                }
                size="field"
              >
                Open in Maps
              </Button>
            ) : null}
            {card.contactPhone ? (
              <Button render={<a href={`tel:${card.contactPhone}`} />} size="field">
                Call {card.contactName}
              </Button>
            ) : null}
            {!directionsUrl && card.address ? (
              <Button
                render={
                  <a
                    href={mapsDirectionsUrl(card.address)}
                    target="_blank"
                    rel="noreferrer"
                  />
                }
                variant="outline"
                size="field"
              >
                Open in Maps
              </Button>
            ) : null}
            {mine ? (
              <Button type="button" size="field" onClick={() => onEnRoute(card)}>
                On the way
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
          ? `${pending} waiting to sync`
          : "All synced"
  const tone = hasError
    ? "bg-destructive/10 text-destructive"
    : mode === "preview" || offline || pending > 0
      ? "bg-free text-free-foreground"
      : "bg-busy text-busy-foreground"
  return (
    <span role="status" className={`inline-flex items-center rounded-full px-2.5 py-1 text-[13px] font-bold ${tone}`}>
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
        render={<Button variant="outline" size="field" className="min-w-12 px-3 text-foreground" />}
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
