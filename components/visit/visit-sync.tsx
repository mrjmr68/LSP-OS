"use client"

import { useEffect, useRef } from "react"
import { useSyncExternalStore } from "react"

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
import {
  isTransportFailure,
  readVisitDraft,
  readVisitQueue,
  reduceQueue,
  writeVisitDraft,
  writeVisitQueue,
  type FlushResult,
  type VisitCommand,
} from "@/lib/visit"

let flushing = false

export async function flushVisitQueue(): Promise<void> {
  if (flushing || typeof window === "undefined") {
    return
  }
  flushing = true
  try {
    for (let guard = 0; guard < 40; guard += 1) {
      const items = readVisitQueue()
      const head = items[0]
      if (!head) {
        return
      }
      const result = await runCommand(head)
      const latest = readVisitQueue()
      if (latest[0]?.id !== head.id) {
        continue
      }
      const next = reduceQueue(latest, result)
      writeVisitQueue(next.items)
      if (next.stop) {
        return
      }
    }
  } finally {
    flushing = false
  }
}

async function runCommand(command: VisitCommand): Promise<FlushResult> {
  try {
    const action = await dispatch(command)
    if (!action.ok) {
      return isTransportFailure(action.message) ? "retry" : "drop"
    }
    if (action.data.conflict) {
      const draft = readVisitDraft(command.requestId)
      if (draft) {
        writeVisitDraft({ ...draft, conflict: true, phase: "queued" })
      }
      return "conflict"
    }
    return "ok"
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    return isTransportFailure(message) || message === "" ? "retry" : "drop"
  }
}

function dispatch(command: VisitCommand): Promise<ActionResult<VisitStep>> {
  switch (command.kind) {
    case "on_site":
      return markOnSite({
        requestId: command.requestId,
        source: command.source,
        lat: command.lat,
        lng: command.lng,
        seenAt: command.seenAt,
      })
    case "start_job":
      return startJob({ requestId: command.requestId, seenAt: command.seenAt })
    case "select_bundle":
      return selectVisitBundle({
        requestId: command.requestId,
        bundleId: command.bundleId,
        seenAt: command.seenAt,
      })
    case "save_parts":
      return savePartsOrder({
        requestId: command.requestId,
        description: command.description,
        supplierId: command.supplierId,
        supplierContact: command.supplierContact,
        orderNumber: command.orderNumber,
        expectedDelivery: command.expectedDelivery,
        seenAt: command.seenAt,
      })
    case "attempt":
      return recordAttempt({
        requestId: command.requestId,
        reason: command.reason,
        note: command.note,
        seenAt: command.seenAt,
      })
    case "close":
      return closeVisit({
        requestId: command.requestId,
        path: command.path,
        note: command.note,
        model: command.model,
        serial: command.serial,
        equipmentSize: command.equipmentSize,
        readings: command.readings,
        signoffName: command.signoffName,
        oneOffNarrative: command.oneOffNarrative,
        materials: command.materials,
        partDescription: command.partDescription,
        supplierId: command.supplierId,
        supplierContact: command.supplierContact,
        orderNumber: command.orderNumber,
        expectedDelivery: command.expectedDelivery,
        clientDraftId: command.clientDraftId,
        seenAt: command.seenAt,
      })
    case "part_in_hand":
      return markPartInHand({
        requestId: command.requestId,
        partsOrderId: command.partsOrderId,
        seenAt: command.seenAt,
      })
    case "attach":
      return attachVisitFile({
        requestId: command.requestId,
        kind: command.attachKind,
        storagePath: command.storagePath,
        caption: command.caption,
        seenAt: command.seenAt,
      })
  }
}

export function useVisitFlush(onSynced?: () => void) {
  const offline = useSyncExternalStore(subscribeOffline, getOfflineSnapshot, getOnlineServerSnapshot)
  const onSyncedRef = useRef(onSynced)
  useEffect(() => {
    onSyncedRef.current = onSynced
  }, [onSynced])
  useEffect(() => {
    if (offline) {
      return
    }
    let cancelled = false
    void flushVisitQueue().then(() => {
      if (!cancelled) {
        onSyncedRef.current?.()
      }
    })
    return () => {
      cancelled = true
    }
  }, [offline])
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
