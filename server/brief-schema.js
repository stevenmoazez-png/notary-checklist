import { z } from "zod";

/**
 * A pre-signing brief in checklist form.
 *
 * The output renders exactly like the standing WA Seller Signing Checklist:
 * numbered phases, each a list of tappable items, plus a script block, a
 * never-skip list, and a red stop-the-signing panel. Every item is an action
 * the notary can tick off at the table. Written FOR THE NOTARY; nothing in it
 * explains what a document means.
 */

const Item = z.object({
  action: z
    .string()
    .describe(
      "A short imperative verb phrase that starts the item: \"Point at\", \"Say\", \"Confirm\", \"Check\", \"Have ready\", \"Call escrow about\". Two to four words."
    ),
  label: z
    .string()
    .describe("The line, figure, field, or thing the action applies to — named as printed on the document. Rendered bold."),
  amount: z
    .string()
    .describe("The figure as printed, e.g. \"12,675.00\", or an empty string if none. \"illegible\" if it cannot be read."),
  detail: z
    .string()
    .describe(
      "Optional tail after the label — where it sits, what to do with your finger, one short clause. Empty string if not needed. For \"Point at\" and \"Say\" items this is locating language only."
    ),
});

const Phase = z.object({
  title: z
    .string()
    .describe(
      "Phase heading, as the document names the section, with its total or key figure — e.g. \"Commissions — $25,350 total\", \"Payoff — PennyMac, $215,804.45\", \"Header — who and when\"."
    ),
  when: z
    .string()
    .describe(
      "One short line under the heading, coaching for the notary: why this section matters or what signers do here. Direct, second person. E.g. \"Sellers scrutinize this line hardest — make sure they see both halves.\""
    ),
  items: z.array(Item).describe("Two to six checkable items, in the order the notary works them. Every figure in the section appears in some item."),
});

export const BriefSchema = z.object({
  readable: z.boolean().describe("False if the image quality makes the document unreliable to work from."),
  readabilityNote: z.string().describe("If not readable, what is wrong and what to re-photograph. Empty string if readable."),
  documentType: z.string().describe("The document's own title, e.g. \"Estimated Seller's Statement\". \"Unknown\" if unclear."),
  issuer: z.string().describe("The company that produced it, or an empty string."),
  confidence: z.enum(["high", "medium", "low"]).describe("How confident you are in the figures you extracted."),
  headline: z.string().describe("One sentence: what this document is and the single most important thing on it."),

  prep: z
    .array(Item)
    .describe(
      "Phase \"Before you leave\" — things to do at the desk before the appointment: pages to have in hand, calls to make to escrow, names to verify, the escrow officer's number. Four to seven items."
    ),

  walkthrough: z
    .array(Phase)
    .describe(
      "One phase per section of the document, top to bottom in printed order — header, the word ESTIMATED if present, then each labeled block down to the subtotals/balance/totals. Do not reorder by importance. Include small sections; give the totals block its own phase with the bottom line in its title."
    ),

  script: z
    .string()
    .describe(
      "The 60-second presentment the notary says out loud, with this document's real figures. Locating language only — points at lines, never explains what one means. Ends by referring the signer to their escrow officer."
    ),

  neverSkip: z
    .array(Item)
    .describe("Three to five items. If the notary does only these at the table, they did the job. The bottom line always; then anything large, unusual, or likely to surprise."),

  stop: z
    .array(
      z.object({
        trigger: z.string().describe("What happens at the table, phrased as a condition: \"The seller is surprised by the 38,420.11 special assessment\"."),
        detail: z.string().describe("The specific figures or fields from this document that make it likely, or the discrepancy quoted from the page."),
        severity: z
          .enum(["high", "medium", "low"])
          .describe("high = stop the signing; medium = raise with escrow before signing; low = mention when returning the package."),
      })
    )
    .describe(
      "Stop-the-signing panel for THIS document: discrepancies you observed (dates that disagree, stated-vs-charged gaps, math that does not tie, missing pages, conditional fees charged) and the reactions this specific document is likely to produce."
    ),

  mathCheck: z.object({
    checked: z.boolean().describe("Whether the document has totals that can be verified."),
    balances: z.boolean().nullable().describe("True if the columns tie, false if not, null if not checkable."),
    detail: z.string().describe("The arithmetic you performed, shown briefly."),
  }),
});

export const BRIEF_SYSTEM = `You are a senior notary signing agent building a signing-table checklist for a newer one. The newer notary photographs a document from a closing package; you turn it into the checklist they will work at the table, item by item, with the page next to them.

WHAT YOU PRODUCE
A checklist. A "Before you leave" phase of prep items. Then one phase per section of the document, top to bottom in printed order, each phase a short list of checkable actions with the real figures in them. Then the words they say out loud. Then the handful of items they must not skip. Then a stop-the-signing panel specific to this document.

THE BOUNDARY THAT GOVERNS EVERYTHING
A notary may locate and identify information on a document. A notary may NOT explain what it means, advise on it, or opine on whether it is correct — that is unauthorized practice of law.

So:
- Phase "when" lines are coaching FOR THE NOTARY. Reason freely there — why a line matters, what sellers do at that line. That is mentoring, not client advice.
- Items whose action is "Point at" or "Say", and the "script", are things done or said IN FRONT OF THE SIGNER. Their detail is locating language only — "in the credits column", "the two figures on the right", "the italic line beneath it". They NEVER explain what a charge is for, whether a figure is correct, or what the signer should do. The script ends by referring the signer to their escrow or closing officer.
- Never write a Point-at, Say, or script line containing "this means", "this is for", or "you are being charged for".

VOICE
Direct, second person, specific, a little opinionated — the way a good mentor talks. "Point at the formula, not at what proration means." "Make sure they see both halves." "Say it out loud once and let it hang." Concrete figures and line names from this document in every item. An item that could appear on any document's checklist is useless.

ACCURACY RULES
- Read figures exactly as printed. Never estimate, round, or infer a number that is not visible.
- If a figure is unreadable, write "illegible" rather than guessing. A wrong number in a checklist is worse than a missing one.
- Verify arithmetic yourself where the document has totals. Report whether the columns tie and show the addition.
- Report discrepancies you actually observe — dates that disagree, a stated premium that differs from the amount charged, subtotals that do not add, a footer implying missing pages, a conditional fee charged anyway. Do not invent them.
- Redactions and blacked-out fields are normal in training material. Note them; do not treat them as errors.

ITEM SHAPE
action + label + amount + detail renders as one line, e.g.
  Point at  **Sale Price of Property**  389,000.00  — in the credits column, your anchor
  Say       **the word ESTIMATED**                  — once, before any figure
  Confirm   **page 2 of 2 is in hand**              — footer reads Page 1 of 2
Keep labels short and as printed. Keep details to one clause. Every figure in a section must appear in some item of that phase.`;
