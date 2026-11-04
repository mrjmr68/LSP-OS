"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent } from "react"

import { goEnRoute } from "@/app/actions/board"
import {
  attachVisitFile,
  closeVisit,
  markOnSite,
  markPartInHand,
  recordAttempt,
  savePartsOrder,
  selectVisitBundle,
  startJob,
  type ActionResult,
  type VisitStep,
} from "@/app/actions/visit"
import { Sheet } from "@/components/board/sheet"
import { useVisitFlush } from "@/components/visit/visit-sync"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { mapsDirectionsUrl, runGoEnRoute } from "@/lib/board-rules"
import type { VisitBundle, VisitModel, VisitPart, VisitSupplier } from "@/lib/visit-data"
import {
  ATTEMPT_REASONS,
  CLOSE_PATHS,
  attemptGaps,
  clearVisitDraft,
  closeGaps,
  departureBlocked,
  emptyDraft,
  emptyReadings,
  enqueueVisitCommand,
  formatDollars,
  isTransportFailure,
  newCommandId,
  pathAfterBundle,
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
  const queue = useSyncExternalStore(subscribeVisitQueue, readVisitQueue, () => [])
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
  const [query, setQuery] = useState("")
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
  const selected = bundles.find((bundle) => bundle.id === bundleId) ?? null
  const gaps = closeGaps({
    path,
    note,
    model: modelText,
    serial,
    bundleId,
    requiresModelSerial: selected?.requiresModelSerial === true,
    oneShot: selected?.oneShot === true,
    signoff: model.signoff,
    signoffName,
    hasSignature: Boolean(signature) || model.visit?.hasSignature === true,
    photoCount: model.photoCount + photos.length,
    partDescription,
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
    if (!navigator.geolocation) {
      return
    }
    const watch = navigator.geolocation.watchPosition((position) => {
      if (arrived.current) {
        return
      }
      const inside = withinGeofence(
        position.coords.latitude,
        position.coords.longitude,
        model.lat as number,
        model.lng as number,
        model.geofenceRadiusM,
      )
      if (!inside) {
        return
      }
      arrived.current = true
      void arrive("gps", position.coords.latitude, position.coords.longitude)
    })
    return () => navigator.geolocation.clearWatch(watch)
  }, [arrive, mine, model.geofenceRadiusM, model.lat, model.lng, step])

  async function beginJob() {
    setBusy(true)
    setFormError(null)
    const command: VisitCommand = {
      id: newCommandId(),
      requestId: model.requestId,
      seenAt: seenAt.current,
      kind: "start_job",
    }
    const result = await commit(command, () =>
      startJob({ requestId: model.requestId, seenAt: seenAt.current }),
    )
    setBusy(false)
    if (result === null || (result !== "queued" && result.conflict)) {
      return
    }
    setStep("diagnose")
    if (result !== "queued") {
      router.refresh()
    }
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

  function choosePath(next: ClosePath) {
    setPath(next)
    setFormError(null)
    if (next === "easy") {
      setStep("bundle")
      return
    }
    setStep("diagnose")
  }

  async function pickBundle(bundle: VisitBundle) {
    setBusy(true)
    setFormError(null)
    const command: VisitCommand = {
      id: newCommandId(),
      requestId: model.requestId,
      seenAt: seenAt.current,
      kind: "select_bundle",
      bundleId: bundle.id,
    }
    const result = await commit(command, () =>
      selectVisitBundle({
        requestId: model.requestId,
        bundleId: bundle.id,
        seenAt: seenAt.current,
      }),
    )
    setBusy(false)
    if (result === null || (result !== "queued" && result.conflict)) {
      return
    }
    const nextPath = pathAfterBundle(path, bundle.oneShot)
    setBundleId(bundle.id)
    setPath(nextPath)
    if (bundle.oneShot) {
      setNotice("That repair needs a part. Model and serial are required before you leave.")
      setStep("parts")
      return
    }
    setStep(nextPath === "parts" ? "parts" : "close")
  }

  async function finishVisit() {
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
      partDescription,
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
        partDescription,
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

  async function handPart(part: VisitPart) {
    setBusy(true)
    setFormError(null)
    const command: VisitCommand = {
      id: newCommandId(),
      requestId: model.requestId,
      seenAt: seenAt.current,
      kind: "part_in_hand",
      partsOrderId: part.id,
    }
    const result = await commit(command, () =>
      markPartInHand({
        requestId: model.requestId,
        partsOrderId: part.id,
        seenAt: seenAt.current,
      }),
    )
    setBusy(false)
    if (result === null || (result !== "queued" && result.conflict)) {
      return
    }
    setNotice(result === "queued" ? "Saved on this phone." : "Part in hand. The call is Ready.")
    if (result !== "queued") {
      router.refresh()
    }
  }

  async function saveOrder() {
    if (partDescription.trim() === "") {
      setFormError("Say what part you need.")
      return
    }
    setBusy(true)
    setFormError(null)
    const supplier = ownerWillFinish ? null : supplierId
    const contact = ownerWillFinish ? "" : supplierContact
    const order = ownerWillFinish ? "" : orderNumber
    const eta = ownerWillFinish ? null : expectedDelivery || null
    const command: VisitCommand = {
      id: newCommandId(),
      requestId: model.requestId,
      seenAt: seenAt.current,
      kind: "save_parts",
      description: partDescription,
      supplierId: supplier,
      supplierContact: contact,
      orderNumber: order,
      expectedDelivery: eta,
    }
    const result = await commit(command, () =>
      savePartsOrder({
        requestId: model.requestId,
        description: partDescription,
        supplierId: supplier,
        supplierContact: contact,
        orderNumber: order,
        expectedDelivery: eta,
        seenAt: seenAt.current,
      }),
    )
    setBusy(false)
    if (result === null || (result !== "queued" && result.conflict)) {
      return
    }
    setNotice(
      ownerWillFinish
        ? "Part saved. An owner can add the supplier and order number."
        : "Part order saved.",
    )
    if (result !== "queued") {
      router.refresh()
    }
  }

  function goBoard() {
    if (departureBlocked(path, modelText, serial) && (step === "diagnose" || step === "bundle" || step === "parts" || step === "close")) {
      setLeaveOpen(true)
      return
    }
    router.push("/board")
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

  const quick = bundles
    .filter((bundle) => bundle.quickSelectRank !== null)
    .slice(0, 8)
  const needle = query.trim().toLowerCase()
  const results = needle
    ? bundles.filter((bundle) =>
        `${bundle.code} ${bundle.title} ${bundle.narrative}`.toLowerCase().includes(needle),
      )
    : quick

  return (
    <div className="mx-auto flex min-h-full w-full max-w-md flex-col">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <Button type="button" variant="outline" size="field" onClick={goBoard}>
            Board
          </Button>
          <div className="min-w-0">
            <p className="font-display text-xl leading-none font-bold tracking-wide">{model.displayNumber}</p>
            <p className="truncate text-sm text-muted-foreground">
              {model.propertyName} · {model.unitLabel}
            </p>
          </div>
          <span className="ml-auto inline-flex min-h-12 items-center gap-2 text-sm">
            <span
              aria-hidden
              className={`size-2.5 rounded-full ${
                sync.tone === "synced"
                  ? "bg-synced"
                  : sync.tone === "offline"
                    ? "bg-muted-foreground"
                    : "bg-amber-500"
              }`}
            />
            {sync.label}
          </span>
        </div>
      </header>
      <main className="flex flex-1 flex-col gap-4 px-4 py-4 pb-16">
        <p className="text-base leading-6">{model.issue}</p>
        {conflict ? (
          <p role="alert" className="rounded-lg border border-amber-700/40 bg-amber-50 px-3 py-3 text-sm leading-6">
            The board changed this call while this phone was offline. The board stands. Tell an owner what you saved here.
          </p>
        ) : null}
        {notice ? <p className="text-sm leading-6">{notice}</p> : null}
        {formError ? (
          <p role="alert" className="text-sm leading-6 text-destructive">
            {formError}
          </p>
        ) : null}

        {step === "summary" || step === "before" ? (
          <JobSummary model={model} />
        ) : null}
        {step === "before" && mine && (model.boardStatus === "assigned" || model.boardStatus === "ready") ? (
          <Button type="button" size="field" disabled={busy} onClick={() => void onTheWay()}>
            {busy ? "Starting…" : "On the way"}
          </Button>
        ) : null}
        {step === "en_route" || step === "arrival" ? (
          <AccessBlock model={model} />
        ) : null}
        {step === "en_route" ? (
          <>
            <p className="text-sm leading-6 text-muted-foreground">
              Travel is running. When you are at the property, the fence can mark you here. If it does not, tap the button.
            </p>
            <Button type="button" size="field" disabled={busy} onClick={() => void arrive("tap", null, null)}>
              {busy ? "Saving…" : "I'm here"}
            </Button>
          </>
        ) : null}
        {step === "arrival" ? (
          <Button type="button" size="field" disabled={busy} onClick={() => void beginJob()}>
            {busy ? "Starting…" : "Tools on equipment — Start job"}
          </Button>
        ) : null}
        {step === "en_route" || step === "arrival" ? (
          <Button type="button" variant="outline" size="field" onClick={() => setAttemptOpen(true)}>
            Couldn&apos;t get in
          </Button>
        ) : null}

        {step === "diagnose" ? (
          <section className="flex flex-col gap-3">
            <h1 className="font-display text-2xl font-semibold tracking-wide">What kind of job?</h1>
            <div className="grid grid-cols-2 gap-2">
              {CLOSE_PATHS.map((item) => (
                <Button
                  key={item.id}
                  type="button"
                  size="field"
                  variant={path === item.id ? "default" : "outline"}
                  onClick={() => choosePath(item.id)}
                >
                  {item.label}
                </Button>
              ))}
            </div>
            {path && path !== "easy" ? (
              <GuidedFields
                path={path}
                modelText={modelText}
                serial={serial}
                equipmentSize={equipmentSize}
                readings={readings}
                onModel={setModelText}
                onSerial={setSerial}
                onSize={setEquipmentSize}
                onReadings={setReadings}
                onPhoto={(url, kind) => void addPhoto(model.requestId, url, kind, photos, setPhotos, setFormError)}
              />
            ) : null}
            {path && path !== "easy" ? (
              <Button
                type="button"
                size="field"
                onClick={() => setStep(path === "one_off" ? "close" : "bundle")}
              >
                {path === "one_off" ? "Continue to close" : "Pick the repair"}
              </Button>
            ) : null}
          </section>
        ) : null}

        {step === "bundle" ? (
          <section className="flex flex-col gap-3">
            <h1 className="font-display text-2xl font-semibold tracking-wide">Pick the repair</h1>
            <Label htmlFor="bundle-search">Search code or words</Label>
            <Input
              id="bundle-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="min-h-12 text-base"
              placeholder="CAP, capacitor"
            />
            {results.length === 0 ? (
              <p className="text-sm leading-6">No match — use One-off.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {results.map((bundle) => (
                  <li key={bundle.id}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void pickBundle(bundle)}
                      className="flex min-h-16 w-full flex-col items-start rounded-lg border border-border bg-card px-3 py-3 text-left"
                    >
                      <span className="font-medium">
                        {bundle.code} · {bundle.title}
                      </span>
                      <span className="text-sm">{formatDollars(bundle.priceCents)}</span>
                      {bundle.pricingKind === "variable" ? (
                        <span className="text-sm text-muted-foreground">
                          Price adjusts for the actual part
                          {bundle.referencePart ? ` · ${bundle.referencePart}` : ""}.
                        </span>
                      ) : null}
                      {bundle.oneShot ? (
                        <span className="text-sm text-muted-foreground">This one needs a part and a return trip.</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <Button
              type="button"
              variant="outline"
              size="field"
              onClick={() => {
                setPath("one_off")
                setStep("close")
              }}
            >
              No bundle fits — One-off
            </Button>
          </section>
        ) : null}

        {step === "parts" || (step === "parts_desk" && canParts) ? (
          <PartsForm
            modelText={modelText}
            serial={serial}
            description={partDescription}
            suppliers={suppliers}
            supplierId={supplierId}
            supplierContact={supplierContact}
            orderNumber={orderNumber}
            expectedDelivery={expectedDelivery}
            ownerWillFinish={ownerWillFinish}
            onDescription={setPartDescription}
            onSupplier={setSupplierId}
            onContact={setSupplierContact}
            onOrder={setOrderNumber}
            onEta={setExpectedDelivery}
            onOwnerFinish={setOwnerWillFinish}
          />
        ) : null}
        {step === "parts" ? (
          <Button type="button" size="field" onClick={() => setStep("close")}>
            Continue to close
          </Button>
        ) : null}
        {step === "parts_desk" && canParts ? (
          <>
            <Button type="button" size="field" variant="outline" disabled={busy} onClick={() => void saveOrder()}>
              Save part order
            </Button>
            {model.parts.map((part) => (
              <div key={part.id} className="rounded-lg border border-border px-3 py-3 text-sm leading-6">
                <p className="font-medium">{part.description}</p>
                <p>{part.orderNumber ? `Order ${part.orderNumber}` : "No order number yet"}</p>
                <p>{part.status === "in_hand" ? "In hand" : part.status === "ordered" ? "Ordered" : "Needed"}</p>
                {part.status !== "in_hand" ? (
                  <Button type="button" className="mt-3" size="field" disabled={busy} onClick={() => void handPart(part)}>
                    Part in hand
                  </Button>
                ) : null}
              </div>
            ))}
          </>
        ) : null}

        {step === "close" ? (
          <section className="flex flex-col gap-3">
            <h1 className="font-display text-2xl font-semibold tracking-wide">Close the visit</h1>
            <p className="text-sm leading-6">
              {selected ? `${selected.code} · ${selected.title} · ${formatDollars(selected.priceCents)}` : path === "one_off" ? "One-off. An owner sets the price." : "No repair picked yet."}
            </p>
            <Label htmlFor="tech-note">Note</Label>
            <textarea
              id="tech-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="min-h-24 w-full rounded-lg border border-input bg-transparent px-3 py-3 text-base"
            />
            {path === "one_off" || path === "estimate" ? (
              <>
                <Label htmlFor="narrative">What you did</Label>
                <textarea
                  id="narrative"
                  value={narrative}
                  onChange={(event) => setNarrative(event.target.value)}
                  className="min-h-24 w-full rounded-lg border border-input bg-transparent px-3 py-3 text-base"
                />
                <Label htmlFor="materials">Materials</Label>
                <Input id="materials" value={materials} onChange={(event) => setMaterials(event.target.value)} className="min-h-12 text-base" />
              </>
            ) : null}
            {model.signoff === "walkthrough_signature" ? (
              <>
                <p className="text-sm leading-6">{model.signoffNotes || "This property wants a name and a signature."}</p>
                <Label htmlFor="signoff-name">Name</Label>
                <Input id="signoff-name" value={signoffName} onChange={(event) => setSignoffName(event.target.value)} className="min-h-12 text-base" />
                <SignaturePad onChange={setSignature} />
              </>
            ) : null}
            {model.signoff === "photos" ? (
              <p className="text-sm leading-6">This property needs a photo before you close. A nameplate photo does not count.</p>
            ) : null}
            {gaps.length > 0 ? (
              <ul className="flex flex-col gap-1 text-sm leading-6">
                {gaps.map((gap) => (
                  <li key={gap}>{gap}</li>
                ))}
              </ul>
            ) : null}
            <Button type="button" size="field" disabled={busy || gaps.length > 0} onClick={() => void finishVisit()}>
              {busy ? "Closing…" : "Close"}
            </Button>
          </section>
        ) : null}

        {step === "done" ? (
          <p className="text-base leading-6">
            {notice ?? "Visit closed. The board has the new column."}
          </p>
        ) : null}
        {step === "attempt_done" ? (
          <p className="text-base leading-6">Couldn&apos;t get in. The call stays open for a return trip.</p>
        ) : null}
        {model.history.length > 0 && step !== "close" ? (
          <p className="text-sm leading-6 text-muted-foreground">
            Recent repairs here: {model.history.join(", ")}
          </p>
        ) : null}
      </main>

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

function GuidedFields({
  path,
  modelText,
  serial,
  equipmentSize,
  readings,
  onModel,
  onSerial,
  onSize,
  onReadings,
  onPhoto,
}: {
  path: ClosePath
  modelText: string
  serial: string
  equipmentSize: string
  readings: Readings
  onModel: (value: string) => void
  onSerial: (value: string) => void
  onSize: (value: string) => void
  onReadings: (value: Readings) => void
  onPhoto: (url: string, kind: "photo" | "nameplate") => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <Label htmlFor="model">Model</Label>
      <Input id="model" value={modelText} onChange={(event) => onModel(event.target.value)} className="min-h-12 text-base" autoComplete="off" />
      <Label htmlFor="serial">Serial</Label>
      <Input id="serial" value={serial} onChange={(event) => onSerial(event.target.value)} className="min-h-12 text-base" autoComplete="off" />
      <label className="flex min-h-12 items-center justify-center rounded-lg border border-border px-3 text-sm">
        Nameplate photo
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
                  onPhoto(url, "nameplate")
                }
              })
            }
          }}
        />
      </label>
      {path === "estimate" ? (
        <>
          <Label htmlFor="size">Equipment size</Label>
          <Input id="size" value={equipmentSize} onChange={(event) => onSize(event.target.value)} className="min-h-12 text-base" placeholder="2.5 ton" />
        </>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        {(
          [
            ["superheat", "Superheat"],
            ["subcool", "Subcool"],
            ["deltaT", "Delta T"],
            ["suction", "Suction"],
            ["liquid", "Liquid"],
          ] as const
        ).map(([key, label]) => (
          <div key={key}>
            <Label htmlFor={key}>{label}</Label>
            <Input
              id={key}
              value={readings[key]}
              onChange={(event) => onReadings({ ...readings, [key]: event.target.value })}
              className="mt-1 min-h-12 text-base"
            />
          </div>
        ))}
      </div>
      <label className="flex min-h-12 items-center justify-center rounded-lg border border-border px-3 text-sm">
        Add a photo
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
                  onPhoto(url, "photo")
                }
              })
            }
          }}
        />
      </label>
    </div>
  )
}

function PartsForm({
  modelText,
  serial,
  description,
  suppliers,
  supplierId,
  supplierContact,
  orderNumber,
  expectedDelivery,
  ownerWillFinish,
  onDescription,
  onSupplier,
  onContact,
  onOrder,
  onEta,
  onOwnerFinish,
}: {
  modelText: string
  serial: string
  description: string
  suppliers: VisitSupplier[]
  supplierId: string | null
  supplierContact: string
  orderNumber: string
  expectedDelivery: string
  ownerWillFinish: boolean
  onDescription: (value: string) => void
  onSupplier: (value: string | null) => void
  onContact: (value: string) => void
  onOrder: (value: string) => void
  onEta: (value: string) => void
  onOwnerFinish: (value: boolean) => void
}) {
  const supplier = suppliers.find((item) => item.id === supplierId) ?? null
  return (
    <section className="flex flex-col gap-3">
      <h1 className="font-display text-2xl font-semibold tracking-wide">Order the part</h1>
      <p className="text-sm leading-6">
        Model {modelText || "—"} · Serial {serial || "—"}. Type both before you leave. A photo is not enough.
      </p>
      <Label htmlFor="part">Part</Label>
      <Input id="part" value={description} onChange={(event) => onDescription(event.target.value)} className="min-h-12 text-base" />
      <label className="flex min-h-12 items-center gap-3 text-base">
        <input
          type="checkbox"
          checked={ownerWillFinish}
          onChange={(event) => onOwnerFinish(event.target.checked)}
          className="size-5"
        />
        Owner will finish
      </label>
      {ownerWillFinish ? (
        <p className="text-sm leading-6">Supplier, order number, and delivery can stay blank. The call still goes to Parts.</p>
      ) : (
        <>
          <Label htmlFor="supplier">Supplier</Label>
          <select
            id="supplier"
            value={supplierId ?? ""}
            onChange={(event) => onSupplier(event.target.value || null)}
            className="min-h-12 rounded-lg border border-input bg-transparent px-3 text-base"
          >
            <option value="">None yet</option>
            {suppliers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          {supplier?.phone ? (
            <Button render={<a href={`tel:${supplier.phone}`} />} size="field" variant="outline">
              Call {supplier.name}
            </Button>
          ) : null}
          {supplier?.email ? (
            <Button render={<a href={`mailto:${supplier.email}`} />} size="field" variant="outline">
              Email {supplier.name}
            </Button>
          ) : null}
          <Label htmlFor="supplier-note">Supplier note</Label>
          <Input id="supplier-note" value={supplierContact} onChange={(event) => onContact(event.target.value)} className="min-h-12 text-base" />
          <Label htmlFor="order-number">Order number</Label>
          <Input id="order-number" value={orderNumber} onChange={(event) => onOrder(event.target.value)} className="min-h-12 text-base" />
          <Label htmlFor="eta">Expected delivery</Label>
          <Input id="eta" type="date" value={expectedDelivery} onChange={(event) => onEta(event.target.value)} className="min-h-12 text-base" />
        </>
      )}
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
          ctx.strokeStyle = "#1c3330"
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
    readings: draft?.readings?.superheat !== undefined ? draft.readings : model.visit?.readings ?? emptyReadings(),
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
    return draft?.step ?? "diagnose"
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

function currentPosition(): Promise<{ lat: number; lng: number } | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve(null)
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    )
  })
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
