import { parseBoardStageView, type BoardStageView } from "@/lib/board"

const STAGE_KEY = "lsp.board.stages.v1"

let stageCache: BoardStageView = "live"
let stageRaw: string | null = null
let stageLoaded = false
const stageListeners = new Set<() => void>()

export function readBoardStageView(): BoardStageView {
  if (typeof window === "undefined") {
    return "live"
  }
  try {
    const raw = window.localStorage.getItem(STAGE_KEY)
    if (stageLoaded && raw === stageRaw) {
      return stageCache
    }
    stageLoaded = true
    stageRaw = raw
    stageCache = parseBoardStageView(raw)
    return stageCache
  } catch {
    return "live"
  }
}

export function writeBoardStageView(view: BoardStageView) {
  if (typeof window === "undefined") {
    return
  }
  window.localStorage.setItem(STAGE_KEY, view)
  stageRaw = view
  stageCache = view
  stageLoaded = true
  stageListeners.forEach((listener) => listener())
}

export function subscribeBoardStageView(listener: () => void) {
  stageListeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key === STAGE_KEY) {
      stageLoaded = false
      listener()
    }
  }
  window.addEventListener("storage", onStorage)
  return () => {
    stageListeners.delete(listener)
    window.removeEventListener("storage", onStorage)
  }
}

export function getBoardStageViewServerSnapshot(): BoardStageView {
  return "live"
}
