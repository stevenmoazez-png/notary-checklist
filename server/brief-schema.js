import { z } from "zod";

/**
 * The shape of a pre-signing brief.
 *
 * This is written FOR THE NOTARY, not for the client. Every field is either a
 * location ("this figure is on this line") or a prep note. Nothing in here is
 * an explanation of what a document means — that boundary is the whole point.
 */

const Money = z.object({
  label: z.string().describe("What this line is called on the document, verbatim where possible."),
  amount: z
    .string()
    .describe("The figure as printed, including the dollar sign. Use \"illegible\" if it cannot be read."),
});

const PointItem = z.object({
  label: z.string().describe("The line to point at, named as it appears on the document."),
  amount: z
    .string()
    .describe("The figure on that line as printed, or an empty string if the line carries no figure."),
  why: z
    .string()
    .describe(
      "One sentence on why this matters to the signer — phrased as prep for the notary, never as an explanation to read aloud."
    ),
});

export const BriefSchema = z.object({
  readable: z
    .boolean()
    .describe("False if the image quality makes the document unreliable to work from."),
  readabilityNote: z
    .string()
    .describe("If not readable, what is wrong and what to re-photograph. Empty string if readable."),
  documentType: z
    .string()
    .describe("The document's own title, e.g. \"Estimated Seller's Statement\". \"Unknown\" if unclear."),
  issuer: z.string().describe("The company that produced it, or an empty string."),
  confidence: z
    .enum(["high", "medium", "low"])
    .describe("How confident you are in the figures you extracted."),
  headline: z
    .string()
    .describe("One sentence: what this document is and the single most important thing on it."),
  bottomLine: Money.nullable().describe(
    "The figure the signer cares about most — proceeds, cash to close, amount financed. Null if the document has none."
  ),
  tier1: z
    .array(PointItem)
    .describe("Never skip these. The bottom line, plus anything large, unusual, or likely to surprise."),
  tier2: z
    .array(PointItem)
    .describe("Point at briefly — the major routine deductions or terms that build the bottom line."),
  tier3: z
    .array(PointItem)
    .describe("Know these but do not volunteer them. Small, routine, or likely to invite a question you cannot answer."),
  anomalies: z
    .array(
      z.object({
        what: z.string().describe("Short name for the discrepancy."),
        detail: z.string().describe("The specific figures or fields that disagree, quoted from the document."),
        severity: z
          .enum(["high", "medium", "low"])
          .describe("high = stop the signing; medium = raise with escrow before signing; low = mention when returning the package."),
      })
    )
    .describe("Internal inconsistencies, math that does not tie, mismatched dates, missing pages, blank fields."),
  mathCheck: z.object({
    checked: z.boolean().describe("Whether the document has totals that can be verified."),
    balances: z.boolean().nullable().describe("True if the columns tie, false if not, null if not checkable."),
    detail: z.string().describe("The arithmetic you performed, shown briefly."),
  }),
  script: z
    .string()
    .describe(
      "The 60-second presentment, with this document's real figures filled in. Locating language only — never explains what a line means. Ends by referring the signer to their escrow officer."
    ),
  stopRisk: z
    .array(
      z.object({
        trigger: z.string().describe("What might happen at the table."),
        why: z.string().describe("Why this document in particular makes it likely."),
      })
    )
    .describe("What is most likely to go wrong at this specific signing."),
  notaryNotes: z
    .array(z.string())
    .describe("Prep reminders specific to this document — pages to check, certificates to expect, names to verify."),
});

export const BRIEF_SYSTEM = `You are a pre-signing analyst for a notary signing agent (NSA). You produce a private prep brief the notary reads BEFORE a signing appointment.

WHAT YOU ARE DOING
The notary photographs a document from a closing package. You read it and tell them what to point at, what will surprise the signer, and what is wrong with the document.

THE BOUNDARY THAT GOVERNS EVERYTHING
A notary may locate and identify information on a document. A notary may NOT explain what it means, advise on it, or opine on whether it is correct — that is unauthorized practice of law.

So:
- Your brief is FOR THE NOTARY. It may contain your reasoning and analysis freely.
- The "script" field is different: it is words the notary says OUT LOUD to the signer. It must contain ONLY locating language — "here is your sale price", "your deductions run down this column", "bottom line is here". It must NEVER explain what a charge is for, whether a figure is correct, or what the signer should do. It must end by referring the signer to their escrow or closing officer.
- Never write a script line that begins "this means", "this is for", or "you are being charged for".

ACCURACY RULES
- Read figures exactly as printed. Never estimate, round, or infer a number that is not visible.
- If a figure is unreadable, write "illegible" rather than guessing. A wrong number in a prep brief is worse than a missing one.
- Verify arithmetic yourself where the document has totals. Report whether the columns tie and show the arithmetic.
- Report discrepancies you actually observe — dates that disagree, a stated premium that differs from the amount charged, subtotals that do not add, missing pages implied by "Page X of Y". Do not invent them.
- Redactions and blacked-out fields are normal in training material. Note them, do not treat them as errors.

HOW TO TIER
- tier1: the bottom line, plus anything large, unusual, or likely to make a signer say "nobody told me about that." A special assessment, a lien payoff, an unexpected credit. When in doubt about whether something surprises, put it in tier1.
- tier2: the major routine items that build the bottom line — commissions, loan payoff, taxes. Real money, but expected.
- tier3: small or routine items. Things the notary should recognize but should not raise unprompted.

Be specific and concrete. Cite actual figures and actual line names from the document. A brief that could describe any document is useless.`;
