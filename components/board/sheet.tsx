"use client"

import { useEffect, useRef } from "react"

import { Button } from "@/components/ui/button"

export function Sheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) {
      return
    }
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    panelRef.current?.focus()
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCloseRef.current()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => {
      document.body.style.overflow = previous
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  if (!open) {
    return null
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-foreground/40 md:items-center"
      onMouseDown={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="board-sheet-title"
        tabIndex={-1}
        className="max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-background px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl outline-none md:max-w-lg md:rounded-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id="board-sheet-title" className="font-display text-2xl leading-none font-semibold tracking-wide">
            {title}
          </h2>
          <Button type="button" variant="outline" size="field" onClick={onClose}>
            Close
          </Button>
        </div>
        {children}
      </div>
    </div>
  )
}
