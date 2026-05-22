// server/mcp/tools/status-details.ts
//
// Upsert a single row in procedure_status_details. The Procedure Details page
// renders three lists of checkbox-style statuses (Shipment / Payment /
// Document); each checkbox is a row in this table with category +
// status + is_active. Workflows mark a couple of statuses at completion
// (e.g. Workflow 1 → shipment=tax_calc_insurance_sent + payment=taxletter_sent
// + document=import_doc_pending). Same idempotent upsert as the React UI's
// POST /api/procedure-status-details endpoint, just exposed over MCP so
// Cowork doesn't have to drive the browser for a single checkbox tick.

import { registerTool } from "../registry";
import { McpToolError } from "../errors";
import { storage } from "../../storage";
import { resolveAgentUserId } from "../audit-attribution";

const CATEGORIES = ["shipment", "payment", "document"] as const;

// Mirrors shared/schema.ts enums (shipmentStatusOptionsEnum +
// paymentStatusOptionsEnum + documentStatusOptionsEnum) so the tool
// validates the value before hitting the DB. Keep in sync if the enums
// change. Drift here is non-fatal — the upsert would still succeed at the
// DB level since the column is text, not an enum constraint — but
// validating early gives a clearer error message.
const KNOWN_STATUS_BY_CATEGORY: Record<string, Set<string>> = {
  shipment: new Set([
    "created",
    "tax_calc_insurance_sent", // shown in UI but not (yet) in schema enum
    "tareks_application",
    "tareks_approved",
    "import_started",
    "import_finished",
    "arrived",
    "delivered",
    "closed",
  ]),
  payment: new Set([
    "taxletter_sent",           // UI label "Taxletter Sent"
    "prepayment_invoice_sent",
    "waiting_advance_payment",  // UI label "Waiting Adv. Payment"
    "advance_payment_received",
    "final_balance_letter_sent",
    "balance_received",
    "closed",
  ]),
  document: new Set([
    "import_doc_pending",
    "import_doc_received",
    "pod_sent",
    "expense_documents_sent",
    "closed",
  ]),
};

registerTool({
  name: "write_set_procedure_status",
  tier: "write",
  description:
    "Set (upsert) a single procedure_status_details row — i.e. toggle one of the checkbox-style statuses shown on the Procedure Details page under Shipment Status / Payment Status / Document Status. " +
    "Used at workflow completion: Workflow 1 sets shipment=tax_calc_insurance_sent + payment=taxletter_sent + document=import_doc_pending (three calls); Workflow 2 sets document=import_doc_received (one call). " +
    "No browser interaction needed — this is a single atomic upsert.",
  inputSchema: {
    type: "object",
    properties: {
      procedure_reference: {
        type: "string",
        description: "procedures.reference (tireli format, e.g. 'CNCALO-80'). Used as the FK on procedure_status_details.procedureReference.",
      },
      category: {
        type: "string",
        enum: [...CATEGORIES],
        description: "Status category: 'shipment', 'payment', or 'document'.",
      },
      status: {
        type: "string",
        description: "Status key within the category (e.g. 'tax_calc_insurance_sent', 'taxletter_sent', 'import_doc_pending', 'import_doc_received').",
      },
      is_active: {
        type: "boolean",
        default: true,
        description: "Whether the checkbox is ticked. Default true (set the status). Pass false to untick.",
      },
    },
    required: ["procedure_reference", "category", "status"],
    additionalProperties: false,
  },
  handler: async (args: any) => {
    const cat = String(args.category);
    if (!CATEGORIES.includes(cat as any)) {
      throw new McpToolError(`category must be one of: ${CATEGORIES.join(", ")} (got '${cat}')`);
    }
    const known = KNOWN_STATUS_BY_CATEGORY[cat];
    if (!known.has(args.status)) {
      throw new McpToolError(
        `status '${args.status}' is not a recognised value for category '${cat}'. ` +
        `Known values: ${Array.from(known).join(", ")}`,
      );
    }

    const updatedBy = await resolveAgentUserId();
    const detail = await storage.upsertProcedureStatusDetail({
      procedureReference: String(args.procedure_reference),
      category: cat,
      status: String(args.status),
      isActive: args.is_active ?? true,
      updatedBy,
    } as any);

    return {
      data: { statusDetail: detail },
      meta: {
        affectedTable: "procedure_status_details",
        affectedIds: [detail.id],
        summary: `Set ${args.procedure_reference} ${cat}.${args.status} = ${args.is_active ?? true}`,
      },
    };
  },
});
