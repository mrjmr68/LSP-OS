import { EstimateAnswer } from "@/components/estimate-answer"
import { PublicPage } from "@/components/public-page"
import { COMPANY } from "@/lib/invoice-pdf"
import { moneyExact, ratePercent } from "@/lib/review"

export type EstimateShown = {
  number: string
  status: "sent" | "viewed" | "accepted" | "declined" | "void"
  property: string | null
  unit: string | null
  narrative: string
  equipment_size: string | null
  response_name: string | null
  subtotal_cents: number
  tax_rate_bps: number
  tax_cents: number
  total_cents: number
  lines: { description: string; amount_cents: number }[]
}

/** What the property sees on its estimate link. */
export function EstimateLinkView({ est, token }: { est: EstimateShown; token: string }) {
  const contact = [COMPANY.phone, COMPANY.email].filter(Boolean).join(" · ")
  return (
    <PublicPage title={`Estimate ${est.number}`}>
      <div>
        <p className="text-xl font-extrabold">
          {est.property} · Unit {est.unit}
        </p>
        {est.equipment_size ? (
          <p className="text-base text-muted-foreground">Equipment: {est.equipment_size}</p>
        ) : null}
      </div>
      <section className="flex flex-col gap-1.5">
        <h2 className="text-xs font-bold tracking-[0.08em] text-muted-foreground">WHAT WE FOUND</h2>
        <p className="text-base leading-7 whitespace-pre-line">{est.narrative}</p>
      </section>
      <section className="flex flex-col gap-2 rounded-xl border border-border bg-card px-4 py-3">
        {est.lines.map((l, i) => (
          <div key={i} className="flex justify-between gap-4 text-base leading-6">
            <span>{l.description}</span>
            <span className="shrink-0 font-bold tabular-nums">{moneyExact(l.amount_cents)}</span>
          </div>
        ))}
        <div className="mt-1 flex justify-between border-t border-border pt-2 text-[15px] text-muted-foreground">
          <span>Subtotal</span>
          <span className="tabular-nums">{moneyExact(est.subtotal_cents)}</span>
        </div>
        <div className="flex justify-between text-[15px] text-muted-foreground">
          <span>Sales tax ({ratePercent(est.tax_rate_bps)})</span>
          <span className="tabular-nums">{moneyExact(est.tax_cents)}</span>
        </div>
        <div className="flex justify-between text-xl font-extrabold">
          <span>Total</span>
          <span className="tabular-nums">{moneyExact(est.total_cents)}</span>
        </div>
      </section>
      {est.status === "accepted" ? (
        <p className="rounded-xl bg-busy px-4 py-3 text-base leading-7 font-semibold text-busy-foreground">
          Approved{est.response_name ? ` by ${est.response_name}` : ""}. Thank you. We&apos;ll
          schedule the work and let you know when we&apos;re on the way.
        </p>
      ) : est.status === "declined" ? (
        <p className="rounded-xl bg-card px-4 py-3 text-base leading-7 font-semibold">
          Declined. Thanks for letting us know. Call us if you change your mind.
        </p>
      ) : est.status === "void" ? (
        <p className="rounded-xl bg-card px-4 py-3 text-base leading-7 font-semibold">
          This estimate was withdrawn. Call us for a current one.
        </p>
      ) : (
        <EstimateAnswer token={token} total={moneyExact(est.total_cents)} />
      )}
      <p className="text-sm leading-6 text-muted-foreground">
        {COMPANY.name}
        {contact ? ` · ${contact}` : ""}
      </p>
    </PublicPage>
  )
}
