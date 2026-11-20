"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent } from "react"

import { goEnRoute } from "@/app/actions/board"
import {
  attachVisitFile,
  closeVisit,
  markOnSite,
  recordAttempt,
  addVisitBundle,
  removeVisitBundle,
  startJob,
  type ActionResult,
  type VisitStep,
} from "@/app/actions/visit"
import { Sheet } from "@/components/board/sheet"
import { MeterScan } from "@/components/visit/meter-scan"
import { PartOrderPanel } from "@/components/visit/part-order"
import { UnitEquipment } from "@/components/visit/unit-equipment"
import { useVisitFlush } from "@/components/visit/visit-sync"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { mapsDirectionsUrl, runGoEnRoute } from "@/lib/board-rules"
import { fixNow, locationState, onFix, startLocation } from "@/lib/location"
import { ageCheck, equipmentLabel, isSealedSystemRepair } from "@/lib/nameplate"
import type { VisitBundle, VisitModel, VisitSelection, VisitSupplier } from "@/lib/visit-data"
import {
  ATTEMPT_REASONS,
  READING_FIELDS,
  readingsCount,
  attemptGaps,
  clearVisitDraft,
  closeGaps,
  departureBlocked,
  emptyDraft,
  emptyReadings,
  enqueueVisitCommand,
  formatDollars,
  getVisitQueueServerSnapshot,
  isTransportFailure,
  newCommandId,
  readVisitDraft,
  readVisitPhotos,
  readVisitQueue,
  subscribeVisitQueue,
  syncLabel,
  withinGeofence,
  writeVisitDraft,
  writeVisitPhotos,
  type AttemptReason,
  type ClosePath,
  type Readings,
  type VisitCommand,
  type VisitDraft,
  type VisitStatus,
} from "@/lib/visit"

type Step =
  | "before"
  | "en_route"
  | "arrival"
  | "diagnose"
  | "bundle"
  | "parts"
  | "close"
  | "parts_desk"
  | "done"
  | "attempt_done"
  | "summary"
  | "readings"
  | "photos"
  | "note"
  | "unit"

export function VisitFlow({
  model,
  bundles,
  suppliers,
  error,
}: {
  model: VisitModel | null
  bundles: VisitBundle[]
  suppliers: VisitSupplier[]
  error: string | null
}) {
  const router = useRouter()
  useVisitFlush(() => router.refresh())
  if (!model) {
    return (
      <main className="mx-auto flex min-h-full w-full max-w-md flex-col gap-4 px-4 py-8">
        <p className="font-display text-2xl font-bold tracking-wide">LSP</p>
        <h1 className="font-display text-3xl font-semibold tracking-wide">Call</h1>
        <p className="text-sm leading-6">{error ?? "That call is not on the board."}</p>
        <Button render={<Link href="/board" />} size="field" variant="outline">
          Board
        </Button>
      </main>
    )
  }
  return <VisitSession model={model} bundles={bundles} suppliers={suppliers} />
}

function VisitSession({
  model,
  bundles,
  suppliers,
}: {
  model: VisitModel
  bundles: VisitBundle[]
  suppliers: VisitSupplier[]
}) {
  const router = useRouter()
  const draft = useSyncExternalStore(subscribeVisitQueue, () => readVisitDraft(model.requestId), () => null)
  const queue = useSyncExternalStore(subscribeVisitQueue, readVisitQueue, getVisitQueueServerSnapshot)
  const offline = useSyncExternalStore(subscribeOffline, getOfflineSnapshot, () => false)
  const initial = useMemo(() => fieldsFrom(model, draft), [model, draft])
  const [step, setStep] = useState<Step>(() => openingStep(model, draft))
  const [path, setPath] = useState<ClosePath | null>(initial.path)
  const [modelText, setModelText] = useState(initial.model)
  const [serial, setSerial] = useState(initial.serial)
  const [equipmentSize, setEquipmentSize] = useState(initial.equipmentSize)
  const [note, setNote] = useState(initial.note)
  const [readings, setReadings] = useState<Readings>(initial.readings)
  const [signoffName, setSignoffName] = useState(initial.signoffName)
  const [signature, setSignature] = useState<string | null>(initial.signature)
  const [narrative, setNarrative] = useState(initial.narrative)
  const [materials, setMaterials] = useState(initial.materials)
  const [partDescription, setPartDescription] = useState(initial.partDescription)
  const [supplierId, setSupplierId] = useState<string | null>(initial.supplierId)
  const [supplierContact, setSupplierContact] = useState(initial.supplierContact)
  const [orderNumber, setOrderNumber] = useState(initial.orderNumber)
  const [expectedDelivery, setExpectedDelivery] = useState(initial.expectedDelivery)
  const [ownerWillFinish, setOwnerWillFinish] = useState(initial.ownerWillFinish)
  const [bundleId, setBundleId] = useState<string | null>(initial.bundleId)
  const [photos, setPhotos] = useState<string[]>(() => readVisitPhotos(model.requestId))
  const [nameplate, setNameplate] = useState<string | null>(
    () => readVisitPhotos(`${model.requestId}:nameplate`)[0] ?? null,
  )
  const [query, setQuery] = useState("")
  // null = follow the suggestion; true/false = the tech switched it.
  const [estimateChoice, setEstimateChoice] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [conflict, setConflict] = useState(initial.conflict || model.visit?.offlineConflict === true)
  const [attemptOpen, setAttemptOpen] = useState(false)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [attemptReason, setAttemptReason] = useState<AttemptReason | null>(null)
  const [attemptNote, setAttemptNote] = useState("")
  const seenAt = useRef(model.updatedAt)
  const clientDraftId = useRef(initial.clientDraftId)
  const arrived = useRef(false)
  const hydrated = useRef(false)
  const working = useRef(model.visit?.status === "working")
  // Repairs saved on this phone but not yet back from the server, and ones taken off.
  const [localAdds, setLocalAdds] = useState<VisitSelection[]>([])
  const [removed, setRemoved] = useState<string[]>([])
  const picks: VisitSelection[] = [
    ...model.selections.filter((p) => !removed.includes(p.id)),
    ...localAdds.filter((a) => !model.selections.some((p) => p.bundleId === a.bundleId)),
  ]

  useEffect(() => {
    const saved = readVisitDraft(model.requestId)
    hydrated.current = true
    if (!saved) {
      return
    }
    const timer = window.setTimeout(() => {
      const fields = fieldsFrom(model, saved)
      clientDraftId.current = fields.clientDraftId
      setPath(fields.path)
      setModelText(fields.model)
      setSerial(fields.serial)
      setEquipmentSize(fields.equipmentSize)
      setNote(fields.note)
      setReadings(fields.readings)
      setSignoffName(fields.signoffName)
      setSignature(fields.signature)
      setNarrative(fields.narrative)
      setMaterials(fields.materials)
      setPartDescription(fields.partDescription)
      setSupplierId(fields.supplierId)
      setSupplierContact(fields.supplierContact)
      setOrderNumber(fields.orderNumber)
      setExpectedDelivery(fields.expectedDelivery)
      setOwnerWillFinish(fields.ownerWillFinish)
      setBundleId(fields.bundleId)
      setConflict(fields.conflict || model.visit?.offlineConflict === true)
      setStep(openingStep(model, saved))
      setPhotos(readVisitPhotos(model.requestId))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [model])

  const mine = model.assignedUserId === model.viewerId
  const canParts = mine || model.viewerRole === "owner"
  const queuedHere = queue.filter((item) => item.requestId === model.requestId).length
  const sync = syncLabel({ offline, queued: queuedHere, conflict })
  // The picked repairs decide what close asks for. A part-needing repair
  // means Parts; a change-out or a total over the property's limit suggests
  // an estimate (the tech can switch it); otherwise a simple repair.
  // On a return visit the part is already in hand: the repair closes as an install.
  const isReturn = model.visit?.isReturn === true
  const partInHand = model.parts.some((p) => p.status === "in_hand")
  // The work trip after an approved estimate: no re-diagnosis, no new estimate.
  const doingApproved = isReturn && model.approvedEstimate !== null
  const installing = isReturn && (partInHand || doingApproved)
  const partRepairs = installing ? [] : picks.filter((p) => p.oneShot)
  const partText = partDescription.trim() || partRepairs.map((p) => p.title).join("; ")
  const pickTotal = picks.reduce((sum, p) => sum + p.priceCents, 0)
  // Age check (Matt, Nov 19): a sealed-system part repair on equipment 10+
  // years old, or on R-22, goes out as an estimate (repair vs. replace).
  const ageReason = installing
    ? null
    : picks.some((p) => p.oneShot && isSealedSystemRepair(p.title))
      ? ageCheck(model.equipment)
      : null
  const suggestEstimate =
    !installing &&
    (picks.some((p) => /change\s*-?\s*out/i.test(p.title)) ||
      ageReason !== null ||
      (model.estimateOverCents !== null && picks.length > 0 && pickTotal > model.estimateOverCents))
  const asEstimate = estimateChoice ?? suggestEstimate
  const closePath: ClosePath | null = doingApproved && picks.length === 0
    ? "easy"
    : asEstimate && picks.length > 0
    ? "estimate"
    : partRepairs.length > 0
      ? "parts"
      : path === "one_off"
        ? "one_off"
        : picks.length > 0
          ? "easy"
          : path
  const pickedBundles = picks
    .map((p) => bundles.find((b) => b.id === p.bundleId))
    .filter((b): b is VisitBundle => Boolean(b))
  const gaps = closeGaps({
    path: closePath,
    note,
    model: modelText,
    serial,
    // An approved estimate of written lines only has no repair to pick.
    bundleId: picks[0]?.bundleId ?? (doingApproved ? "approved-estimate" : bundleId),
    requiresModelSerial: pickedBundles.some((b) => b.requiresModelSerial),
    // Installing a part that's in hand is a normal repair close.
    oneShot: !installing && picks.some((p) => p.oneShot),
    signoff: model.signoff,
    signoffName,
    hasSignature: Boolean(signature) || model.visit?.hasSignature === true,
    photoCount: model.photoCount + photos.length,
    partDescription: partText,
  })

  useEffect(() => {
    if (!hydrated.current) {
      return
    }
    const next: VisitDraft = {
      ...emptyDraft(model.requestId, clientDraftId.current),
      phase: queuedHere > 0 ? "queued" : "local_draft",
      step: step === "diagnose" || step === "bundle" || step === "parts" || step === "close" ? step : null,
      optimisticStatus: optimisticFor(step),
      path,
      model: modelText,
      serial,
      equipmentSize,
      note,
      readings,
      signoffName,
      signatureDataUrl: signature,
      oneOffNarrative: narrative,
      materials,
      partDescription,
      supplierId,
      supplierContact,
      orderNumber,
      expectedDelivery,
      ownerWillFinish,
      bundleId,
      photoCount: photos.length,
      conflict,
    }
    writeVisitDraft(next)
  }, [
    bundleId,
    conflict,
    equipmentSize,
    expectedDelivery,
    materials,
    model.requestId,
    modelText,
    narrative,
    note,
    orderNumber,
    ownerWillFinish,
    partDescription,
    path,
    photos.length,
    queuedHere,
    readings,
    serial,
    signature,
    signoffName,
    step,
    supplierContact,
    supplierId,
  ])

  const commit = useCallback(async (
    command: VisitCommand,
    run: () => Promise<ActionResult<VisitStep>>,
  ): Promise<VisitStep | "queued" | null> => {
    if (offline) {
      enqueueVisitCommand(command)
      setNotice("Saved on this phone. It will sync when you have signal.")
      return "queued"
    }
    try {
      const result = await run()
      if (!result.ok) {
        if (isTransportFailure(result.message)) {
          enqueueVisitCommand(command)
          setNotice("Saved on this phone. It will sync when you have signal.")
          return "queued"
        }
        setFormError(result.message)
        return null
      }
      if (result.data.conflict) {
        setConflict(true)
        setFormError(result.data.notice)
        return result.data
      }
      if (result.data.requestUpdatedAt) {
        seenAt.current = result.data.requestUpdatedAt
      }
      return result.data
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : ""
      if (isTransportFailure(message) || message === "") {
        enqueueVisitCommand(command)
        setNotice("Saved on this phone. It will sync when you have signal.")
        return "queued"
      }
      setFormError("Could not save. Try again.")
      return null
    }
  }, [offline])

  const arrive = useCallback(async (source: "tap" | "gps", lat: number | null, lng: number | null) => {
    setBusy(true)
    setFormError(null)
    const command: VisitCommand = {
      id: newCommandId(),
      requestId: model.requestId,
      seenAt: seenAt.current,
      kind: "on_site",
      source,
      lat,
      lng,
    }
    const result = await commit(command, () =>
      markOnSite({
        requestId: model.requestId,
        source,
        lat,
        lng,
        seenAt: seenAt.current,
      }),
    )
    setBusy(false)
    if (result === null) {
      arrived.current = false
      return
    }
    if (result !== "queued" && result.conflict) {
      return
    }
    setStep("arrival")
    if (result !== "queued") {
      router.refresh()
    }
  }, [commit, model.requestId, router])

  useEffect(() => {
    if (step !== "en_route" || model.lat === null || model.lng === null || !mine) {
      return
    }
    // Auto-arrive only uses location the phone already allows; it never prompts.
    let off: (() => void) | null = null
    let stopped = false
    void locationState().then((state) => {
      if (stopped || state !== "granted") return
      startLocation()
      off = onFix((fix) => {
        if (arrived.current) return
        if (!withinGeofence(fix.lat, fix.lng, model.lat as number, model.lng as number, model.geofenceRadiusM)) {
          return
        }
        arrived.current = true
        void arrive("gps", fix.lat, fix.lng)
      })
    })
    return () => {
      stopped = true
      off?.()
    }
  }, [arrive, mine, model.geofenceRadiusM, model.lat, model.lng, step])

  /** Start the job clock if it isn't running. Quiet: stays on the current screen. */
  async function ensureWorking(): Promise<boolean> {
    if (working.current) {
      return true
    }
    const command: VisitCommand = {
      id: newCommandId(),
      requestId: model.requestId,
      seenAt: seenAt.current,
      kind: "start_job",
    }
    const result = await commit(command, () =>
      startJob({ requestId: model.requestId, seenAt: seenAt.current }),
    )
    if (result === null || (result !== "queued" && result.conflict)) {
      return false
    }
    working.current = true
    return true
  }

  async function saveAttempt() {
    const missing = attemptGaps(attemptReason, attemptNote)
    if (missing.length > 0 || !attemptReason) {
      setFormError(missing[0] ?? "Pick why you could not get in.")
      return
    }
    setBusy(true)
    setFormError(null)
    const command: VisitCommand = {
      id: newCommandId(),
      requestId: model.requestId,
      seenAt: seenAt.current,
      kind: "attempt",
      reason: attemptReason,
      note: attemptNote,
    }
    const result = await commit(command, () =>
      recordAttempt({
        requestId: model.requestId,
        reason: attemptReason,
        note: attemptNote,
        seenAt: seenAt.current,
      }),
    )
    setBusy(false)
    if (result === null || (result !== "queued" && result.conflict)) {
      return
    }
    setAttemptOpen(false)
    setStep("attempt_done")
    setNotice(result === "queued" ? "Saved on this phone. The call stays open." : "Couldn't get in. The call stays open.")
  }



  async function addRepair(bundle: VisitBundle) {
    if (picks.some((p) => p.bundleId === bundle.id)) {
      return
    }
    setBusy(true)
    setFormError(null)
    if (!(await ensureWorking())) {
      setBusy(false)
      return
    }
    const command: VisitCommand = {
      id: newCommandId(),
      requestId: model.requestId,
      seenAt: seenAt.current,
      kind: "add_bundle",
      bundleId: bundle.id,
    }
    const result = await commit(command, () =>
      addVisitBundle({
        requestId: model.requestId,
        bundleId: bundle.id,
        seenAt: seenAt.current,
      }),
    )
    setBusy(false)
    if (result === null || (result !== "queued" && result.conflict)) {
      return
    }
    setLocalAdds((list) => [
      ...list,
      {
        id: `local-${bundle.id}`,
        bundleId: bundle.id,
        code: bundle.code,
        title: bundle.title,
        priceCents: bundle.priceCents,
        oneShot: bundle.oneShot,
      },
    ])
    setBundleId(bundle.id)
    setQuery("")
    setPath((current) => (current === "one_off" ? null : current))
    setStep("bundle")
    if (result !== "queued") {
      router.refresh()
    }
  }

  function onRemoveClick(event: React.MouseEvent<HTMLButtonElement>) {
    const pick = picks.find((p) => p.id === event.currentTarget.dataset.pick)
    if (pick) void removeRepair(pick)
  }

  async function removeRepair(pick: VisitSelection) {
    if (pick.id.startsWith("local-")) {
      setLocalAdds((list) => list.filter((p) => p.id !== pick.id))
      return
    }
    setBusy(true)
    setFormError(null)
    const command: VisitCommand = {
      id: newCommandId(),
      requestId: model.requestId,
      seenAt: seenAt.current,
      kind: "remove_bundle",
      selectionId: pick.id,
    }
    const result = await commit(command, () =>
      removeVisitBundle({
        requestId: model.requestId,
        selectionId: pick.id,
        seenAt: seenAt.current,
      }),
    )
    setBusy(false)
    if (result === null || (result !== "queued" && result.conflict)) {
      return
    }
    setRemoved((ids) => [...ids, pick.id])
    if (result !== "queued") {
      router.refresh()
    }
  }

  async function finishVisit() {
    const path = closePath
    if (!path || gaps.length > 0) {
      setFormError(gaps[0] ?? "Pick a path.")
      return
    }
    setBusy(true)
    setFormError(null)
    if (signature) {
      const attached = await commit(
        {
          id: newCommandId(),
          requestId: model.requestId,
          seenAt: seenAt.current,
          kind: "attach",
          attachKind: "signature",
          storagePath: signature,
          caption: signoffName,
        },
        () =>
          attachVisitFile({
            requestId: model.requestId,
            kind: "signature",
            storagePath: signature,
            caption: signoffName,
            seenAt: seenAt.current,
          }),
      )
      if (attached === null || (attached !== "queued" && attached.conflict)) {
        setBusy(false)
        return
      }
    }
    for (const plate of readVisitPhotos(`${model.requestId}:nameplate`)) {
      const attached = await commit(
        {
          id: newCommandId(),
          requestId: model.requestId,
          seenAt: seenAt.current,
          kind: "attach",
          attachKind: "nameplate",
          storagePath: plate,
          caption: null,
        },
        () =>
          attachVisitFile({
            requestId: model.requestId,
            kind: "nameplate",
            storagePath: plate,
            caption: null,
            seenAt: seenAt.current,
          }),
      )
      if (attached === null || (attached !== "queued" && attached.conflict)) {
        setBusy(false)
        return
      }
    }
    for (const photo of photos) {
      const attached = await commit(
        {
          id: newCommandId(),
          requestId: model.requestId,
          seenAt: seenAt.current,
          kind: "attach",
          attachKind: "photo",
          storagePath: photo,
          caption: null,
        },
        () =>
          attachVisitFile({
            requestId: model.requestId,
            kind: "photo",
            storagePath: photo,
            caption: null,
            seenAt: seenAt.current,
          }),
      )
      if (attached === null || (attached !== "queued" && attached.conflict)) {
        setBusy(false)
        return
      }
    }
    const supplier = ownerWillFinish ? null : supplierId
    const contact = ownerWillFinish ? "" : supplierContact
    const order = ownerWillFinish ? "" : orderNumber
    const eta = ownerWillFinish ? null : expectedDelivery || null
    const command: VisitCommand = {
      id: newCommandId(),
      requestId: model.requestId,
      seenAt: seenAt.current,
      kind: "close",
      path,
      note,
      model: modelText,
      serial,
      equipmentSize,
      readings,
      signoffName,
      oneOffNarrative: narrative,
      materials,
      partDescription: partText,
      supplierId: supplier,
      supplierContact: contact,
      orderNumber: order,
      expectedDelivery: eta,
      clientDraftId: clientDraftId.current,
    }
    const result = await commit(command, () =>
      closeVisit({
        requestId: model.requestId,
        path,
        note,
        model: modelText,
        serial,
        equipmentSize,
        readings,
        signoffName,
        oneOffNarrative: narrative,
        materials,
        partDescription: partText,
        supplierId: supplier,
        supplierContact: contact,
        orderNumber: order,
        expectedDelivery: eta,
        clientDraftId: clientDraftId.current,
        seenAt: seenAt.current,
      }),
    )
    setBusy(false)
    if (result === null || (result !== "queued" && result.conflict)) {
      return
    }
    if (result === "queued") {
      setNotice("Saved on this phone. It will sync when you have signal.")
      return
    }
    clearVisitDraft(model.requestId)
    setStep(result.boardStatus === "parts" ? "parts_desk" : "done")
    setNotice(closeNotice(result.boardStatus))
    router.refresh()
  }

  function goBoard() {
    if (departureBlocked(path, modelText, serial) && (step === "diagnose" || step === "bundle" || step === "parts" || step === "close")) {
      setLeaveOpen(true)
      return
    }
    router.push("/board?view=mine")
  }

  async function onTheWay() {
    setBusy(true)
    setFormError(null)
    const outcome = await runGoEnRoute({
      fallbackAddress: model.address,
      locate: currentPosition,
      save: async (origin) => {
        const result = await goEnRoute({ requestId: model.requestId, origin })
        if (!result.ok) {
          return { ok: false, message: result.message }
        }
        return { ok: true, address: result.data.address, notice: result.data.notice }
      },
      openMaps: openMapsTab,
    })
    setBusy(false)
    if (!outcome.ok) {
      setFormError(outcome.message)
      return
    }
    setNotice(outcome.notice)
    setStep("en_route")
    router.refresh()
  }

  const needle = query.trim().toLowerCase()
  const results = needle
    ? bundles.filter((bundle) =>
        `${bundle.code} ${bundle.title} ${bundle.narrative} ${bundle.searchTerms ?? ""}`
          .toLowerCase()
          .includes(needle),
      )
    : []
  const total = picks.reduce((sum, p) => sum + p.priceCents, 0)
  const isHub = step === "arrival" || step === "bundle" || step === "diagnose"
  // On site: the tool tabs in the header and the Wrap up bar at the bottom.
  const onSiteTab: OnSiteTab | null = !mine
    ? null
    : isHub
      ? "repairs"
      : step === "readings" || step === "photos" || step === "note" || step === "unit"
        ? step
        : null
  const showTabs = onSiteTab !== null || (mine && step === "close")
  const addingAnother = picks.length > 0

  // One primary action per screen, pinned to the bottom.
  let primary: React.ReactNode = null
  if (onSiteTab !== null) {
    primary = (
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm text-muted-foreground">
            {picks.length === 0 ? "No repair yet" : `${picks.length} repair${picks.length === 1 ? "" : "s"}`}
          </span>
          <span className="text-[22px] leading-tight font-extrabold tabular-nums">
            {picks.length === 0 ? "—" : formatDollars(pickTotal).replace(".00", "")}
          </span>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => setStep("close")}
          className="h-[58px] flex-[1.4] rounded-[14px] bg-primary text-[19px] font-extrabold text-primary-foreground disabled:opacity-60"
        >
          Wrap up →
        </button>
      </div>
    )
  } else if (step === "before" && mine && (model.boardStatus === "assigned" || model.boardStatus === "ready")) {
    primary = (
      <>
        <BigButton disabled={busy} onClick={() => void onTheWay()}>
          {busy ? "Starting…" : "On my way"}
        </BigButton>
        <p className="text-center text-[13px] text-muted-foreground">
          Opens directions and starts your drive time
        </p>
        {model.contactPhone ? (
          <a href={`tel:${model.contactPhone}`} className="flex h-12 items-center justify-center rounded-xl border-2 border-ink bg-card text-[17px] font-bold">
            Call the office
          </a>
        ) : null}
      </>
    )
  } else if (step === "en_route") {
    primary = (
      <>
        <BigButton disabled={busy} onClick={() => void arrive("tap", null, null)}>
          {busy ? "Saving…" : "I'm here"}
        </BigButton>
        <p className="text-center text-[13px] text-muted-foreground">
          The app also marks you here when you pull in
        </p>
      </>
    )
  } else if (step === "close") {
    primary = (
      <>
        <BigButton disabled={busy || gaps.length > 0} onClick={() => void finishVisit()}>
          {busy ? "Closing…" : "Close visit"}
        </BigButton>
        <p className="text-center text-[13px] text-muted-foreground">
          {closePath === "estimate"
            ? "Sends the estimate draft to owner review"
            : closePath === "parts"
              ? "Moves the job to Parts"
              : "Sends the draft to owner review"}
          {model.nextJob ? ` · Next: ${model.nextJob.title}` : ""}
        </p>
      </>
    )
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-md flex-col">
      <JobHeader
        model={model}
        sync={sync}
        stage={stageLabel(step, mine)}
        onBack={goBoard}
        tabs={
          showTabs ? (
            <OnSiteTabs
              active={onSiteTab}
              counts={{
                repairs: picks.length,
                unit: model.equipment.some((e) => e.model || e.serial) ? 1 : 0,
                readings: readingsCount(readings),
                photos: photos.length,
                note: note.trim() ? 1 : 0,
              }}
              onPick={(tab) => setStep(tab === "repairs" ? (picks.length > 0 ? "bundle" : "diagnose") : tab)}
            />
          ) : null
        }
      />

      <main className={"flex flex-1 flex-col gap-3 px-5 pt-4 " + (primary ? "pb-52" : "pb-10")}>
        {conflict ? (
          <p role="alert" className="rounded-xl bg-free px-4 py-3 text-sm leading-6 text-free-foreground">
            The Board changed this call while this phone was offline. The Board stands. Tell an owner what you saved here.
          </p>
        ) : null}
        {formError ? (
          <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm font-medium leading-6 text-destructive">
            {formError}
          </p>
        ) : null}
        {notice && step !== "done" ? <p role="status" className="text-sm leading-6">{notice}</p> : null}

        {/* ---------------- Heading there ---------------- */}
        {step === "before" || step === "summary" ? (
          <>
            <p className="text-[19px] leading-snug font-semibold">{model.issue}</p>
            {model.repeat ? (
              <p className="rounded-xl bg-free px-4 py-3 text-[15px] font-bold text-free-foreground">
                {ordinal(model.repeat.count + 1)} call on this unit in {model.repeat.windowDays} days
              </p>
            ) : null}
            {model.priority === "high" ? (
              <p className="rounded-xl border-2 border-high px-4 py-2 text-[15px] font-bold text-high">High priority</p>
            ) : null}
            <GettingIn model={model} />
            <UnitBefore items={model.unitHistory} />
            {step === "summary" ? <JobSummary model={model} /> : null}
          </>
        ) : null}

        {/* ---------------- Driving ---------------- */}
        {step === "en_route" ? (
          <>
            <p className="text-[19px] leading-snug font-semibold">{model.issue}</p>
            <GettingIn model={model} />
            <button type="button" onClick={() => openMapsTab(mapsDirectionsUrl(model.address, null))} className="min-h-11 self-start text-[15px] font-semibold text-primary underline">
              Open directions again
            </button>
            <button type="button" onClick={() => { setAttemptReason(null); setAttemptOpen(true) }} className="min-h-11 self-start text-[15px] text-muted-foreground underline">
              Couldn&apos;t get in
            </button>
          </>
        ) : null}

        {/* ---------------- What did you find? ---------------- */}
        {isHub && mine ? (
          <>
            {installing ? (
              <p className="rounded-xl bg-busy px-4 py-3 text-[15px] leading-6 font-semibold text-busy-foreground">
                {doingApproved
                  ? `Approved estimate${model.approvedEstimate?.number ? ` ${model.approvedEstimate.number}` : ""}: do the approved work, take readings, then Wrap up. The price is what the property approved.`
                  : "Return trip: install the part from the first visit, take readings, then Wrap up."}
              </p>
            ) : null}
            {picks.length > 0 ? (
              <section className="flex flex-col gap-1.5 rounded-xl border border-border bg-card px-4 py-3">
                <Eyebrow>{doingApproved ? "Approved work" : installing ? "Installing" : "On this visit"}</Eyebrow>
                {picks.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-3">
                    <span className="text-[17px] font-bold">{p.title}</span>
                    <span className="flex items-center gap-1">
                      <span className="text-[17px] font-bold tabular-nums">{formatDollars(p.priceCents).replace(".00", "")}</span>
                      <button type="button" disabled={busy} data-pick={p.id} onClick={onRemoveClick} aria-label={`Remove ${p.title}`} className="flex size-9 items-center justify-center rounded-lg text-xl text-muted-foreground hover:bg-muted">
                        ×
                      </button>
                    </span>
                  </div>
                ))}
              </section>
            ) : null}
            <label htmlFor="repair-search" className="text-[13px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
              {addingAnother ? "Add another repair" : "Search repairs"}
            </label>
            <Input
              id="repair-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="capacitor, drain, no issue…"
              className="h-14 rounded-xl border-2 border-ink text-lg"
            />
            {needle ? (
              results.length === 0 ? (
                <p className="text-[15px] text-muted-foreground">Nothing matches. Try another word, or use New repair.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {results.map((bundle) => {
                    const already = picks.some((p) => p.bundleId === bundle.id)
                    return (
                      <li key={bundle.id}>
                        <button
                          type="button"
                          disabled={busy || already}
                          onClick={() => void addRepair(bundle)}
                          className="flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left disabled:opacity-60"
                        >
                          <span>
                            <span className="block text-[17px] font-bold">{bundle.title}</span>
                            {bundle.oneShot ? (
                              <span className="block text-[13px] text-muted-foreground">Needs a part and a return trip</span>
                            ) : already ? (
                              <span className="block text-[13px] text-muted-foreground">On this visit</span>
                            ) : null}
                          </span>
                          <span className="text-[17px] font-bold tabular-nums">{formatDollars(bundle.priceCents).replace(".00", "")}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )
            ) : null}
            <div className="mt-1 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setPath("one_off")
                  void ensureWorking().then((ok) => ok && setStep("close"))
                }}
                className="h-14 rounded-xl border-2 border-ink bg-card text-[17px] font-bold disabled:opacity-60"
              >
                New repair
              </button>
              {addingAnother ? null : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setAttemptReason("no_access")
                    setAttemptOpen(true)
                  }}
                  className="h-14 rounded-xl border-2 border-ink bg-card text-[17px] font-bold disabled:opacity-60"
                >
                  No access
                </button>
              )}
            </div>
          </>
        ) : null}

        {/* ---------------- Unit tab: the unit's equipment ---------------- */}
        {step === "unit" ? (
          <UnitEquipment
            unitId={model.unitId}
            equipment={model.equipment}
            onNameplatePhoto={(url) => {
              void addPhoto(model.requestId, url, "nameplate", photos, setPhotos, setFormError)
              setNameplate(url)
            }}
          />
        ) : null}

        {/* ---------------- Readings (its own screen) ---------------- */}
        {step === "readings" ? (
          <section className="flex flex-col gap-3">
            <MeterScan onValues={(values) => setReadings((current) => ({ ...current, ...values }))} />
            <p className="text-[15px] text-muted-foreground">Saved as you type. Any can be left blank.</p>
            <div className="grid grid-cols-2 gap-3">
              {READING_FIELDS.map((field) => (
                <label key={field.key} className="flex flex-col gap-1">
                  <span className="text-[15px] font-semibold">{field.label}</span>
                  <span className="flex items-center gap-2">
                    <Input
                      inputMode="decimal"
                      value={readings[field.key]}
                      onChange={(event) => setReadings({ ...readings, [field.key]: event.target.value })}
                      className="h-14 rounded-xl border-2 border-ink/70 text-xl tabular-nums"
                    />
                    <span className="w-8 shrink-0 text-[15px] text-muted-foreground">{field.unit}</span>
                  </span>
                </label>
              ))}
            </div>
          </section>
        ) : null}

        {/* ---------------- Photos tab ---------------- */}
        {step === "photos" ? (
          <section className="flex flex-col gap-3">
            <p className="text-[15px] text-muted-foreground">Photos stay on this phone until it syncs.</p>
            {photos.length > 0 ? (
              <div className="grid grid-cols-3 gap-2">
                {photos.map((url, index) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={index} src={url} alt={`Photo ${index + 1}`} className="aspect-square w-full rounded-lg object-cover" />
                ))}
              </div>
            ) : null}
            <PhotoButton
              label={photos.length > 0 ? `${photos.length} photo${photos.length === 1 ? "" : "s"} · add another` : "Take a photo"}
              onFile={(file) =>
                void shrinkPhoto(file).then((url) => {
                  if (url) void addPhoto(model.requestId, url, "photo", photos, setPhotos, setFormError)
                })
              }
            />
            <PhotoButton
              label={nameplate ? "Nameplate photo ✓ · retake" : "Nameplate photo"}
              onFile={(file) =>
                void shrinkPhoto(file).then((url) => {
                  if (url) {
                    void addPhoto(model.requestId, url, "nameplate", photos, setPhotos, setFormError)
                    setNameplate(url)
                  }
                })
              }
            />
          </section>
        ) : null}

        {/* ---------------- Note tab ---------------- */}
        {step === "note" ? (
          <section className="flex flex-col gap-3">
            <p className="text-[15px] text-muted-foreground">
              For the owners, not the property. Type, or tap the mic on your keyboard to talk.
            </p>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className={fieldClass + " min-h-48"}
              aria-label="Note"
            />
          </section>
        ) : null}

        {/* ---------------- Parts: order it, then in hand with the real cost ---------------- */}
        {step === "parts_desk" && canParts ? (
          model.parts.length === 0 ? (
            <p className="rounded-xl border border-border bg-card px-4 py-3 text-[15px] text-muted-foreground">
              No part order on this job.
            </p>
          ) : (
            model.parts.map((part) => (
              <PartOrderPanel
                key={part.id}
                requestId={model.requestId}
                part={part}
                suppliers={suppliers}
                modelText={modelText || model.equipment.find((e) => e.model)?.model || ""}
                serial={serial || model.equipment.find((e) => e.serial)?.serial || ""}
                canAskOwner={model.viewerRole !== "owner"}
              />
            ))
          )
        ) : null}

        {/* ---------------- Ready to close? ---------------- */}
        {step === "close" ? (
          <>
            <h1 className="text-[28px] leading-tight font-extrabold">Ready to close?</h1>
            <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
              <Eyebrow>{closePath === "estimate" ? "On the estimate" : "Repairs on this visit"}</Eyebrow>
              {picks.length === 0 ? (
                <p className="text-[15px] text-muted-foreground">
                  {closePath === "one_off" ? "One-off. Say what you did below; an owner sets the price." : "No repair picked yet."}
                </p>
              ) : (
                picks.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-3">
                    <span className="text-[17px] font-bold">{p.title}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-[17px] font-bold tabular-nums">{formatDollars(p.priceCents).replace(".00", "")}</span>
                      <button type="button" disabled={busy} data-pick={p.id} onClick={onRemoveClick} aria-label={`Remove ${p.title}`} className="flex size-9 items-center justify-center rounded-lg text-xl text-muted-foreground hover:bg-muted">
                        ×
                      </button>
                    </span>
                  </div>
                ))
              )}
              <button type="button" disabled={busy} onClick={() => { setQuery(""); setStep("bundle") }} className="mt-1 h-12 rounded-xl border-2 border-dashed border-ink/60 text-[17px] font-bold">
                Add another repair
              </button>
            </section>
            {picks.length > 1 ? (
              <p className="rounded-xl bg-free px-4 py-3 text-[15px] leading-6 font-medium text-free-foreground">
                {picks.length} repairs on one visit ({formatDollars(total).replace(".00", "")} listed). An owner sets the final price at review, since travel is only charged once.
              </p>
            ) : null}
            {partRepairs.length > 0 || pickedBundles.some((b) => b.requiresModelSerial) || asEstimate ? (
              <section className="flex flex-col gap-3 rounded-xl border-2 border-high/60 bg-card p-4">
                <Eyebrow>
                  {asEstimate ? "For the estimate" : partRepairs.length > 0 ? "Needs a part" : "This repair needs"}
                </Eyebrow>
                {partRepairs.length > 0 && !asEstimate ? (
                  <p className="text-[15px] font-semibold">{partText}</p>
                ) : null}
                {model.equipment.filter((e) => e.model || e.serial).length > 0 ? (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[13px] font-semibold text-muted-foreground">From this unit</span>
                    {model.equipment
                      .filter((e) => e.model || e.serial)
                      .map((e) => (
                        <button
                          key={e.id}
                          type="button"
                          onClick={() => {
                            setModelText(e.model ?? "")
                            setSerial(e.serial ?? "")
                          }}
                          className="flex min-h-11 items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 text-left text-[14px]"
                        >
                          <span className="font-bold">{e.kind === "condenser" || e.kind === "heat_pump" ? "Outdoor" : "Indoor"}</span>
                          <span className="truncate tabular-nums">{equipmentLabel(e)}</span>
                        </button>
                      ))}
                  </div>
                ) : null}
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Model">
                    <Input value={modelText} onChange={(event) => setModelText(event.target.value)} className="h-12 rounded-xl text-base" autoCapitalize="characters" />
                  </Field>
                  <Field label="Serial">
                    <Input value={serial} onChange={(event) => setSerial(event.target.value)} className="h-12 rounded-xl text-base" autoCapitalize="characters" />
                  </Field>
                </div>
                {asEstimate ? (
                  <Field label="Equipment size">
                    <Input value={equipmentSize} onChange={(event) => setEquipmentSize(event.target.value)} placeholder="e.g. 2.5 ton" className="h-12 rounded-xl text-base" />
                  </Field>
                ) : null}
                <label className="flex h-12 cursor-pointer items-center justify-center rounded-xl border-2 border-ink bg-card text-[17px] font-bold">
                  {nameplate ? "Nameplate photo ✓ · retake" : "Nameplate photo"}
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      if (file) {
                        void shrinkPhoto(file).then((url) => {
                          if (url) {
                            void addPhoto(model.requestId, url, "nameplate", photos, setPhotos, setFormError)
                            setNameplate(url)
                          }
                        })
                      }
                    }}
                  />
                </label>
                {partRepairs.length > 0 && !asEstimate ? (
                  <p className="text-[13px] text-muted-foreground">Closing puts the job in Parts. The part order can be finished from the Parts screen.</p>
                ) : null}
              </section>
            ) : null}
            {picks.length > 0 && !installing ? (
              <label className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-2">
                <span>
                  <span className="block text-[16px] font-bold">Send as an estimate</span>
                  <span className="block text-[13px] text-muted-foreground">
                    {ageReason
                      ? `${ageReason} Suggested: repair or replace. `
                      : suggestEstimate
                        ? "Suggested for this job. "
                        : ""}
                    The owner reviews it before it goes to the property.
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={asEstimate}
                  onChange={(event) => setEstimateChoice(event.target.checked)}
                  className="size-6 shrink-0 accent-primary"
                />
              </label>
            ) : null}
            {closePath === "one_off" ? (
              <>
                <Eyebrow>What you did</Eyebrow>
                <textarea value={narrative} onChange={(event) => setNarrative(event.target.value)} className={fieldClass} aria-label="What you did" />
                <Eyebrow>Materials</Eyebrow>
                <Input value={materials} onChange={(event) => setMaterials(event.target.value)} className="h-12 rounded-xl text-base" aria-label="Materials" />
              </>
            ) : null}
            <Eyebrow>
              {closePath === "estimate"
                ? "Why an estimate · required"
                : closePath === "one_off"
                  ? "Note · required"
                  : "Note · optional"}
            </Eyebrow>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={closePath === "estimate" ? "What's wrong and what it needs" : "Type, or tap the mic on your keyboard to talk"}
              className={fieldClass}
              aria-label="Note"
            />
            <label className="flex h-12 cursor-pointer items-center justify-center rounded-xl border-2 border-ink bg-card text-[17px] font-bold">
              {photos.length > 0 ? `${photos.length} photo${photos.length === 1 ? "" : "s"} · add another` : "Add photo · optional"}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) {
                    void shrinkPhoto(file).then((url) => {
                      if (url) void addPhoto(model.requestId, url, "photo", photos, setPhotos, setFormError)
                    })
                  }
                }}
              />
            </label>
            {model.signoff === "walkthrough_signature" ? (
              <>
                <p className="text-sm leading-6">{model.signoffNotes || "This property wants a name and a signature."}</p>
                <Label htmlFor="signoff-name">Name</Label>
                <Input id="signoff-name" value={signoffName} onChange={(event) => setSignoffName(event.target.value)} className="h-12 rounded-xl text-base" />
                <SignaturePad onChange={setSignature} />
              </>
            ) : null}
            {model.signoff === "photos" ? (
              <p className="text-sm leading-6">This property needs a photo before you close.</p>
            ) : null}
            {gaps.length > 0 ? (
              <ul className="flex flex-col gap-1 rounded-xl bg-muted px-4 py-3 text-[15px] leading-6">
                {gaps.map((gap) => (
                  <li key={gap}>{gap}</li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}

        {/* ---------------- Done ---------------- */}
        {step === "done" || step === "attempt_done" ? (
          <section className="flex flex-col gap-3 pt-6">
            <h1 className="text-[30px] leading-tight font-extrabold">
              {step === "done" ? "Visit closed" : "Couldn't get in"}
            </h1>
            <p className="text-[17px] leading-7 text-muted-foreground">
              {step === "done"
                ? notice ?? "The draft is with the owners for review."
                : "Saved for owner review. The call stays open for a return trip."}
            </p>
            {model.nextJob ? (
              <a href={`/board/visit/${model.nextJob.id}`} className="flex h-16 flex-col items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <span className="text-[13px] font-bold tracking-[0.08em] uppercase opacity-90">Next</span>
                <span className="text-xl font-bold">{model.nextJob.title}</span>
              </a>
            ) : (
              <a href="/board?view=mine" className="flex h-14 items-center justify-center rounded-xl bg-primary text-xl font-bold text-primary-foreground">
                Back to My jobs
              </a>
            )}
          </section>
        ) : null}
      </main>

      {primary ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card">
          <div className="mx-auto flex w-full max-w-md flex-col gap-2 px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {primary}
          </div>
        </div>
      ) : null}


      <Sheet open={attemptOpen} title="Couldn't get in" onClose={() => setAttemptOpen(false)}>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-2">
            {ATTEMPT_REASONS.map((reason) => (
              <Button
                key={reason.id}
                type="button"
                size="field"
                variant={attemptReason === reason.id ? "default" : "outline"}
                onClick={() => setAttemptReason(reason.id)}
              >
                {reason.label}
              </Button>
            ))}
          </div>
          <Label htmlFor="attempt-note">What happened</Label>
          <textarea
            id="attempt-note"
            value={attemptNote}
            onChange={(event) => setAttemptNote(event.target.value)}
            className="min-h-24 w-full rounded-lg border border-input bg-transparent px-3 py-3 text-base"
          />
          <Button type="button" size="field" disabled={busy} onClick={() => void saveAttempt()}>
            Save attempt
          </Button>
        </div>
      </Sheet>
      <Sheet open={leaveOpen} title="Model and serial" onClose={() => setLeaveOpen(false)}>
        <div className="flex flex-col gap-3">
          <p className="text-sm leading-6">
            Type the model and the serial before you leave. A photo of the nameplate is not enough.
          </p>
          <Button type="button" size="field" onClick={() => { setLeaveOpen(false); setStep("diagnose") }}>
            Type them in
          </Button>
        </div>
      </Sheet>
    </div>
  )
}

const fieldClass =
  "min-h-24 w-full rounded-xl border-2 border-ink/80 bg-card px-3 py-3 text-base outline-none focus-visible:border-primary"

type OnSiteTab = "repairs" | "unit" | "readings" | "photos" | "note"

function stageLabel(step: Step, mine: boolean): string {
  if (step === "before") return mine ? "Next stop" : "Job"
  if (step === "summary") return "Job"
  if (step === "en_route") return "Driving"
  if (step === "close") return "Wrapping up"
  if (step === "done") return "Closed"
  if (step === "attempt_done") return "Couldn't get in"
  if (step === "parts_desk") return "Parts"
  return "On site"
}

/** The same header on every job screen: where you are and what stage. */
function JobHeader({
  model,
  sync,
  stage,
  onBack,
  tabs,
}: {
  model: VisitModel
  sync: { label: string; tone: string }
  stage: string
  onBack: () => void
  tabs: React.ReactNode
}) {
  return (
    <header className="sticky top-0 z-20 flex flex-col gap-2 bg-ink px-5 pt-3 pb-3 text-ink-foreground">
      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={onBack} className="flex min-h-11 items-center text-[15px] font-semibold text-ink-foreground/80">
          ← My jobs
        </button>
        <span className="flex items-center gap-2">
          <span className="text-[13px] font-bold tracking-[0.06em] text-ink-foreground/70 uppercase">{stage}</span>
          <span
            role="status"
            className={
              "rounded-full px-2.5 py-1 text-[13px] font-bold " +
              (sync.tone === "synced" ? "bg-busy text-busy-foreground" : "bg-free text-free-foreground")
            }
          >
            {sync.label}
          </span>
        </span>
      </div>
      <div>
        {/* Always two lines: the property, then the unit (never cut) and the issue. */}
        <p className="truncate text-[22px] leading-tight font-extrabold">{model.propertyName}</p>
        <p className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 text-[22px] leading-tight font-extrabold">Unit {model.unitLabel}</span>
          <span className="truncate text-[15px] text-ink-foreground/75">{model.issue}</span>
        </p>
      </div>
      {tabs}
    </header>
  )
}

function OnSiteTabs({
  active,
  counts,
  onPick,
}: {
  active: OnSiteTab | null
  counts: Record<OnSiteTab, number>
  onPick: (tab: OnSiteTab) => void
}) {
  const tabs: { id: OnSiteTab; label: string; count: string | null; filled: boolean }[] = [
    { id: "repairs", label: "Repairs", count: counts.repairs ? String(counts.repairs) : null, filled: counts.repairs > 0 },
    { id: "unit", label: "Unit", count: null, filled: counts.unit > 0 },
    { id: "readings", label: "Readings", count: null, filled: counts.readings > 0 },
    { id: "photos", label: "Photos", count: null, filled: counts.photos > 0 },
    { id: "note", label: "Note", count: null, filled: counts.note > 0 },
  ]
  return (
    <nav aria-label="Visit tools" className="mt-1 flex gap-1 rounded-xl bg-white/10 p-1">
      {tabs.map((tab) => {
        const on = tab.id === active
        return (
          <button
            key={tab.id}
            type="button"
            aria-current={on ? "page" : undefined}
            onClick={() => onPick(tab.id)}
            className={
              "relative flex h-10 min-w-0 flex-1 items-center justify-center gap-1 rounded-[9px] px-0.5 text-[13px] font-extrabold " +
              (on ? "bg-card text-foreground" : "text-ink-foreground/85")
            }
          >
            <span className="truncate">{tab.label}</span>
            {tab.count ? <span className="font-semibold opacity-70">{tab.count}</span> : null}
            {tab.filled && !tab.count ? (
              <span aria-label="has something" className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-synced" />
            ) : null}
          </button>
        )
      })}
    </nav>
  )
}

function PhotoButton({ label, onFile }: { label: string; onFile: (file: File) => void }) {
  return (
    <label className="flex h-14 cursor-pointer items-center justify-center rounded-xl border-2 border-ink bg-card text-[17px] font-bold">
      {label}
      <input
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) onFile(file)
          event.target.value = ""
        }}
      />
    </label>
  )
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] font-bold tracking-[0.08em] text-muted-foreground uppercase">{children}</p>
}

function BigButton({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="h-[72px] w-full rounded-2xl bg-primary text-2xl font-bold text-primary-foreground disabled:opacity-50"
    >
      {children}
    </button>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[15px] font-semibold">{label}</span>
      {children}
    </label>
  )
}

function GettingIn({ model }: { model: VisitModel }) {
  const hasCodes = Boolean(model.lockbox || model.accessText)
  return (
    <section className="flex flex-col gap-2">
      <Eyebrow>Getting in</Eyebrow>
      <div className="rounded-xl border border-border bg-card px-4 py-3">
        <p className="text-[12px] font-bold tracking-[0.08em] text-muted-foreground uppercase">Codes and entry</p>
        {hasCodes ? (
          <dl className="mt-1 flex flex-col gap-1.5">
            {model.lockbox ? (
              <div>
                <dt className="text-[13px] text-muted-foreground">Lockbox</dt>
                <dd className="text-xl leading-snug font-extrabold tracking-wide">{model.lockbox}</dd>
              </div>
            ) : null}
            {model.accessText ? (
              <div>
                <dt className="text-[13px] text-muted-foreground">Entry notes</dt>
                <dd className="text-[17px] leading-snug font-semibold">{model.accessText}</dd>
              </div>
            ) : null}
          </dl>
        ) : (
          <p className="mt-1 text-[15px] text-muted-foreground">No codes or entry notes on file.</p>
        )}
      </div>
      <div className="rounded-xl border border-border bg-card px-4 py-3">
        <p className="text-[12px] font-bold tracking-[0.08em] text-muted-foreground uppercase">Who to reach</p>
        {model.contacts.length === 0 ? (
          <p className="mt-1 text-[15px] text-muted-foreground">No contact on file.</p>
        ) : (
          <ul className="mt-1 flex flex-col divide-y divide-border">
            {model.contacts.map((c) => (
              <li key={c.id} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[17px] font-bold">{c.name}</p>
                  <p className="truncate text-[13px] text-muted-foreground">
                    {[c.calledItIn ? "Called this in" : null, c.title].filter(Boolean).join(" · ") || "Property contact"}
                  </p>
                </div>
                {c.phone ? (
                  <>
                    <a
                      href={`sms:${c.phone}`}
                      className="flex h-11 items-center rounded-[10px] border-2 border-ink px-3 text-[15px] font-bold"
                    >
                      Text
                    </a>
                    <a
                      href={`tel:${c.phone}`}
                      className="flex h-11 items-center rounded-[10px] bg-primary px-4 text-[15px] font-bold text-primary-foreground"
                    >
                      Call
                    </a>
                  </>
                ) : (
                  <span className="shrink-0 text-[13px] text-muted-foreground">No phone</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function UnitBefore({ items }: { items: { title: string; whenLabel: string }[] }) {
  return (
    <section className="rounded-xl border border-border bg-card px-4 py-3">
      <Eyebrow>This unit before</Eyebrow>
      {items.length === 0 ? (
        <p className="mt-1 text-[15px] text-muted-foreground">No calls on this unit in the last year.</p>
      ) : (
        <ul className="mt-1 flex flex-col gap-1">
          {items.map((item, index) => (
            <li key={`${item.title}-${index}`} className="flex justify-between gap-3 text-[16px]">
              <span className="font-semibold">{item.title}</span>
              <span className="shrink-0 text-muted-foreground">{item.whenLabel}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ordinal(n: number): string {
  if (n === 2) return "Second"
  if (n === 3) return "Third"
  if (n === 4) return "Fourth"
  return `${n}th`
}

function JobSummary({ model }: { model: VisitModel }) {
  return (
    <section className="flex flex-col gap-3">
      <AccessBlock model={model} />
      {model.contactPhone ? (
        <Button render={<a href={`tel:${model.contactPhone}`} />} size="field">
          Call {model.contactName}
        </Button>
      ) : (
        <p className="text-sm leading-6">No phone on this contact.</p>
      )}
    </section>
  )
}

function AccessBlock({ model }: { model: VisitModel }) {
  return (
    <section className="rounded-xl border border-border bg-card px-4 py-4">
      <p className="text-xs tracking-wide text-muted-foreground uppercase">Access</p>
      <p className="mt-2 text-xl leading-7 font-medium">{model.accessText || "No access note on this property."}</p>
      <p className="mt-3 text-lg leading-7">Lockbox: {model.lockbox || "None listed"}</p>
      <div className="mt-4 flex flex-col gap-2">
        {model.contactPhone ? (
          <Button render={<a href={`tel:${model.contactPhone}`} />} size="field" variant="outline">
            Call {model.contactName}
          </Button>
        ) : null}
        {model.address ? (
          <Button
            render={<a href={mapsDirectionsUrl(model.address)} target="_blank" rel="noreferrer" />}
            size="field"
            variant="outline"
          >
            Open in Maps
          </Button>
        ) : null}
      </div>
    </section>
  )
}

function SignaturePad({ onChange }: { onChange: (value: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)

  function point(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    if (!canvas) {
      return null
    }
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">Signature</p>
      <canvas
        ref={canvasRef}
        width={600}
        height={180}
        className="h-32 w-full touch-none rounded-lg border border-border bg-white"
        onPointerDown={(event) => {
          const start = point(event)
          const ctx = canvasRef.current?.getContext("2d")
          if (!start || !ctx) {
            return
          }
          drawing.current = true
          ctx.lineWidth = 3
          ctx.lineCap = "round"
          ctx.strokeStyle = "#111518"
          ctx.beginPath()
          ctx.moveTo(start.x, start.y)
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          if (!drawing.current) {
            return
          }
          const next = point(event)
          const ctx = canvasRef.current?.getContext("2d")
          if (!next || !ctx) {
            return
          }
          ctx.lineTo(next.x, next.y)
          ctx.stroke()
        }}
        onPointerUp={() => {
          drawing.current = false
          const canvas = canvasRef.current
          onChange(canvas ? canvas.toDataURL("image/png") : null)
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="field"
        onClick={() => {
          const canvas = canvasRef.current
          const ctx = canvas?.getContext("2d")
          if (canvas && ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height)
          }
          onChange(null)
        }}
      >
        Clear signature
      </Button>
    </div>
  )
}

function fieldsFrom(model: VisitModel, draft: VisitDraft | null) {
  const serverPath = model.visit?.path ?? null
  return {
    clientDraftId: draft?.clientDraftId || newCommandId(),
    path: draft?.path ?? serverPath,
    model: draft?.model || model.visit?.model || "",
    serial: draft?.serial || model.visit?.serial || "",
    equipmentSize: draft?.equipmentSize || model.visit?.equipmentSize || "",
    note: draft?.note || model.visit?.note || "",
    readings: draft?.readings?.returnAir !== undefined ? draft.readings : model.visit?.readings ?? emptyReadings(),
    signoffName: draft?.signoffName || model.visit?.signoffName || "",
    signature: draft?.signatureDataUrl ?? null,
    narrative: draft?.oneOffNarrative || "",
    materials: draft?.materials || "",
    partDescription: draft?.partDescription || model.parts[0]?.description || "",
    supplierId: draft?.supplierId ?? model.parts[0]?.supplierId ?? null,
    supplierContact: draft?.supplierContact || model.parts[0]?.contactText || "",
    orderNumber: draft?.orderNumber || model.parts[0]?.orderNumber || "",
    expectedDelivery: draft?.expectedDelivery || model.parts[0]?.expectedDelivery || "",
    ownerWillFinish: draft?.ownerWillFinish === true,
    bundleId: draft?.bundleId ?? model.selection?.bundleId ?? null,
    conflict: draft?.conflict === true,
  }
}

function openingStep(model: VisitModel, draft: VisitDraft | null): Step {
  const mine = model.assignedUserId === model.viewerId
  const status = draft?.optimisticStatus ?? model.visit?.status ?? null
  if (!mine && model.boardStatus === "parts") {
    return "parts_desk"
  }
  if (!mine) {
    return "summary"
  }
  if (status === "en_route") {
    return "en_route"
  }
  if (status === "on_site") {
    return "arrival"
  }
  if (status === "working") {
    // Coming back to a job with repairs on it: straight to close.
    const saved = draft?.step === "parts" ? "close" : draft?.step
    return saved ?? (model.selections.length > 0 ? "close" : "diagnose")
  }
  if (status === "attempt") {
    return "attempt_done"
  }
  if (model.boardStatus === "parts") {
    return "parts_desk"
  }
  if (status === "closed") {
    return "done"
  }
  if (model.boardStatus === "assigned" || model.boardStatus === "ready") {
    return "before"
  }
  return "summary"
}

function optimisticFor(step: Step): VisitStatus | null {
  if (step === "en_route") {
    return "en_route"
  }
  if (step === "arrival") {
    return "on_site"
  }
  if (step === "diagnose" || step === "bundle" || step === "parts" || step === "close") {
    return "working"
  }
  if (step === "attempt_done") {
    return "attempt"
  }
  if (step === "done" || step === "parts_desk") {
    return "closed"
  }
  return null
}

function closeNotice(status: string | null): string {
  if (status === "complete") {
    return "Closed. The call is Complete. An owner reviews the invoice before it is sent."
  }
  if (status === "parts") {
    return "Closed. The call is in Parts."
  }
  if (status === "to_estimate") {
    return "Closed. The call is To Estimate."
  }
  return "Visit closed."
}

async function addPhoto(
  requestId: string,
  url: string,
  kind: "photo" | "nameplate",
  current: string[],
  setPhotos: (photos: string[]) => void,
  setFormError: (message: string | null) => void,
) {
  if (kind === "nameplate") {
    const stored = writeVisitPhotos(`${requestId}:nameplate`, [url])
    if (!stored) {
      setFormError("This phone could not store that nameplate photo. Type the model and serial.")
    }
    return
  }
  const next = [...current, url]
  setPhotos(next)
  if (!writeVisitPhotos(requestId, next)) {
    setFormError("This phone could not store that photo. The notes are still saved.")
  }
}

async function shrinkPhoto(file: File): Promise<string> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext("2d")
    if (!ctx) {
      return ""
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL("image/jpeg", 0.6)
  } catch {
    return ""
  }
}

/** From a tap ("On my way" / "I'm here"); shares the app's one location watch. */
async function currentPosition(): Promise<{ lat: number; lng: number } | null> {
  const fix = await fixNow(8000)
  return fix ? { lat: fix.lat, lng: fix.lng } : null
}

function openMapsTab(url: string): boolean {
  if (!url.startsWith("https://www.google.com/maps/")) {
    return false
  }
  const popup = window.open(url, "_blank")
  if (!popup) {
    return false
  }
  popup.opener = null
  return true
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
