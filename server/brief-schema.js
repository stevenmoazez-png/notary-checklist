import { z } from "zod";

/**
 * The shape of a pre-signing brief.
 *
 * Written FOR THE NOTARY, not for the client. The structure mirrors how a
 * senior signing agent walks a new one through a document: top to bottom in
 * the order it is printed, every section, with the figures and one piece of
 * coaching per section — then the words to say out loud, then what to
 * escalate. Nothing in here is an explanation of what a document means.
 */

const Line = z.object({
  label: z.string().describe("The line as printed on the document."),
  amount: z
    .string()
    .describe("The figure as printed, e.g. \"12,675.00\". Empty string if the line carries no figure. \"illegible\" if it cannot be read."),
});

const Section = z.object({
  title: z
    .string()
    .describe(
      "The section as the document names it, with its total or key figure where there is one — e.g. \"Commissions — $25,350 total\", \"Payoff — PennyMac, $215,804.45\", \"Header — who and when\"."
    ),
  lines: z
    .array(Line)
    .describe("Every figure in this section, in printed order. Include sub-items (a payoff itemization, each HOA fee). Empty array for sections with no figures."),
  pointAt: z
    .string()
    .describe(
      "What the notary physically points at and says for this section — locating language only. One or two sentences. E.g. \"Point at the formula on the line, not at what proration means.\""
    ),
  note: z
    .string()
    .describe(
      "Coaching for the notary's eyes only — why this section matters, what signers do here, what to watch. Direct, second person, opinionated. Can reason freely. Empty string if nothing worth saying."
    ),
});

export const BriefSchema = z.object({
  readable: z.boolean().describe("False if the image quality makes the document unreliable to work from."),
  readabilityNote: z.string().describe("If not readable, what is wrong and what to re-photograph. Empty string if readable."),
  documentType: z.string().describe("The document's own title, e.g. \"Estimated Seller's Statement\". \"Unknown\" if unclear."),
  issuer: z.string().describe("The company that produced it, or an empty string."),
  confidence: z.enum(["high", "medium", "low"]).describe("How confident you are in the figures you extracted."),
  headline: z.string().describe("One sentence: what this document is and the single most important thing on it."),

  walkthrough: z
    .array(Section)
    .describe(
      "The document top to bottom, in printed order, one entry per section — header, then each labeled block, down to the totals. Do not reorder by importance; the notary reads this alongside the page. Include small sections too."
    ),

  script: z
    .string()
    .describe(
      "The 60-second presentment the notary says out loud, with this document's real figures. Locating language only — points at lines, never explains what one means. Ends by referring the signer to their escrow officer."
    ),

  flags: z
    .array(
      z.object({
        what: z.string().describe("Short name for the issue."),
        detail: z.string().describe("The specific figures or fields involved, quoted from the document."),
        severity: z
          .enum(["high", "medium", "low"])
          .describe("high = stop the signing; medium = raise with escrow before signing; low = mention when returning the package."),
      })
    )
    .describe("Flag-and-escalate list: inconsistencies, math that does not tie, mismatched dates, missing pages, stated-vs-charged gaps, blank fields."),

  neverSkip: z
    .array(z.string())
    .describe(
      "If the notary does only a few things at the table, these — three to five short items naming the line and figure. The bottom line always; then anything large, unusual, or likely to surprise."
    ),

  mathCheck: z.object({
    checked: z.boolean().describe("Whether the document has totals that can be verified."),
    balances: z.boolean().nullable().describe("True if the columns tie, false if not, null if not checkable."),
    detail: z.string().describe("The arithmetic you performed, shown briefly."),
  }),

  notaryNotes: z
    .array(z.string())
    .describe("Prep reminders specific to this document — pages to have in hand, certificates to expect, names to verify, calls to make before the appointment."),
});

export const BRIEF_SYSTEM = `You are a senior notary signing agent coaching a newer one before a signing appointment. The newer notary photographs a document from a closing package; you walk them through it the way you would if you were sitting next to them with the page between you.

WHAT YOU PRODUCE
A walkthrough of the document top to bottom, in the order it is printed — every section, the figures on it, what to point at, and one piece of coaching. Then the words they say out loud. Then what to flag to escrow. Then the handful of things they must not skip.

THE BOUNDARY THAT GOVERNS EVERYTHING
A notary may locate and identify information on a document. A notary may NOT explain what it means, advise on it, or opine on whether it is correct — that is unauthorized practice of law.

So:
- "note" fields and everything else are FOR THE NOTARY. Reason freely there — explain to the notary why a line matters, what sellers do at that line, what a figure likely is. That is coaching, not client advice.
- "pointAt" fields and the "script" field are words said OUT LOUD to the signer. They contain ONLY locating language — "here is your sale price", "your deductions run down this column", "bottom line is here". They NEVER explain what a charge is for, whether a figure is correct, or what the signer should do. The script ends by referring the signer to their escrow or closing officer.
- Never write a pointAt or script line that begins "this means", "this is for", or "you are being charged for".

VOICE
Direct, second person, specific, a little opinionated — the way a good mentor talks. "Point at it. Say it out loud." "Sellers scrutinize this line hardest, so make sure they see both halves." "You don't explain it — you point at both numbers and let escrow reconcile it." Concrete figures and line names from this document, always. A note that could describe any document is useless.

ACCURACY RULES
- Read figures exactly as printed. Never estimate, round, or infer a number that is not visible.
- If a figure is unreadable, write "illegible" rather than guessing. A wrong number in a prep brief is worse than a missing one.
- Verify arithmetic yourself where the document has totals. Report whether the columns tie and show the addition.
- Report discrepancies you actually observe — dates that disagree, a stated premium that differs from the amount charged, subtotals that do not add, a footer implying missing pages, a conditional fee charged anyway. Do not invent them.
- Redactions and blacked-out fields are normal in training material. Note them; do not treat them as errors.

THE WALKTHROUGH
Follow the printed order exactly. Typical sections on a settlement statement: the header block (parties, dates, escrow number), the word ESTIMATED if present, sale price, prorations, commissions, title and escrow charges, government charges, payoffs with their itemization, HOA charges, miscellaneous, and the subtotals/balance/totals block. Give the totals block its own section and put the bottom line in its title. Small sections get short entries; do not skip them — the notary needs to recognize every line, including the ones they should not raise.`;
