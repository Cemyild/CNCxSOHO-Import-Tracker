// server/mcp/tools/payments.ts
import { registerTool } from "../registry";
import { runQueryPayments } from "../../ai-ask-tools";
import { db } from "../../db";
import {
  payments as paymentsTable,
  incomingPayments as incomingPaymentsTable,
  paymentDistributions,
  procedures as proceduresTable,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { McpToolError } from "../errors";
import { resolveAgentUserId } from "../audit-attribution";

registerTool({
  name: "read_payments",
  tier: "read",
  description: "Query outgoing payments and their distributions. Note: payments table has no currency column — currency lives on the parent procedure.",
  inputSchema: {
    type: "object",
    properties: {
      procedure_id: { type: "integer" },
      reference_contains: { type: "string" },
      type: { type: "string", description: "advance | balance" },
      status: { type: "string" },
      date_from: { type: "string", description: "YYYY-MM-DD" },
      date_to: { type: "string", description: "YYYY-MM-DD" },
      list_limit: { type: "integer", minimum: 0, maximum: 500, default: 50 },
      group_by: { type: "string" },
    },
    additionalProperties: false,
  },
  handler: async (args) => ({ data: await runQueryPayments(args) }),
});

// ---------------------------------------------------------------------------
// Write tools (Phase 4.2)
// ---------------------------------------------------------------------------
//
// Schema notes (verified against shared/schema.ts):
//
//   payments columns (NOT NULL):
//     procedureReference (text, FK procedures.reference),
//     paymentType (enum: advance | balance),
//     amount (decimal),
//     paymentDate (text, YYYY-MM-DD).
//     createdBy is FK→users but nullable; we still attribute it for the audit trail.
//
//   paymentDistributions columns (NOT NULL):
//     incomingPaymentId (FK incoming_payments.id),
//     procedureReference (text),
//     distributedAmount (decimal),
//     distributionDate (timestamp, defaultNow),
//     paymentType (enum: advance | balance).
//     The plan's allocation shape `{target_type, target_id, amount}` does not
//     map: distributions in this schema attach a portion of an incoming payment
//     to a procedure (not to per-row tax/expense/invoice items). We therefore
//     adapt the input schema so each allocation provides `procedure_reference`,
//     `distributed_amount` and `payment_type`.

registerTool({
  name: "write_create_payment",
  tier: "write",
  description:
    "Create an outgoing payment (advance or balance) against a procedure. The procedure_reference must exist in procedures.reference.",
  inputSchema: {
    type: "object",
    properties: {
      procedure_reference: { type: "string", description: "FK → procedures.reference" },
      payment_type: { type: "string", enum: ["advance", "balance"] },
      amount: { type: "string", description: "Decimal as string, e.g. \"1500.00\"" },
      payment_date: { type: "string", description: "YYYY-MM-DD" },
      notes: { type: "string" },
    },
    required: ["procedure_reference", "payment_type", "amount", "payment_date"],
    additionalProperties: false,
  },
  handler: async (args: any) => {
    return await db.transaction(async (tx) => {
      // Verify the procedure exists (storage.createPayment does the same; we
      // replicate so the MCP error message is descriptive).
      const [proc] = await tx
        .select({ id: proceduresTable.id, reference: proceduresTable.reference })
        .from(proceduresTable)
        .where(eq(proceduresTable.reference, args.procedure_reference));
      if (!proc) throw new McpToolError(`Procedure with reference "${args.procedure_reference}" does not exist`);

      const createdBy = await resolveAgentUserId(tx as any);
      const [created] = await tx
        .insert(paymentsTable)
        .values({
          procedureReference: args.procedure_reference,
          paymentType: args.payment_type,
          amount: args.amount,
          paymentDate: args.payment_date,
          notes: args.notes ?? null,
          createdBy,
        })
        .returning();
      if (!created) throw new McpToolError("Insert returned no row");
      return {
        data: { payment: created },
        meta: {
          affectedTable: "payments",
          affectedIds: [created.id],
          summary: `Created ${args.payment_type} payment ${created.id} on procedure ${args.procedure_reference}`,
        },
      };
    });
  },
});

registerTool({
  name: "write_distribute_payment",
  tier: "write",
  description:
    "Distribute an existing incoming payment to one or more procedures. Validates that the sum of allocations does not exceed the incoming payment's remaining balance. " +
    "Each allocation must specify procedure_reference, distributed_amount (decimal string), and payment_type ('advance' | 'balance').",
  inputSchema: {
    type: "object",
    properties: {
      incoming_payment_id: { type: "integer", description: "incoming_payments.id" },
      allocations: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          properties: {
            procedure_reference: { type: "string" },
            distributed_amount: { type: "string", description: "Decimal as string" },
            payment_type: { type: "string", enum: ["advance", "balance"] },
            distribution_date: { type: "string", description: "Optional YYYY-MM-DD; defaults to now" },
          },
          required: ["procedure_reference", "distributed_amount", "payment_type"],
          additionalProperties: false,
        },
      },
    },
    required: ["incoming_payment_id", "allocations"],
    additionalProperties: false,
  },
  handler: async (args: any) => {
    return await db.transaction(async (tx) => {
      const [incoming] = await tx
        .select()
        .from(incomingPaymentsTable)
        .where(eq(incomingPaymentsTable.id, args.incoming_payment_id));
      if (!incoming) throw new McpToolError(`Incoming payment ${args.incoming_payment_id} not found`);

      const allocSum = args.allocations.reduce(
        (s: number, a: any) => s + parseFloat(a.distributed_amount),
        0,
      );
      const remaining = parseFloat((incoming as any).remainingBalance ?? (incoming as any).totalAmount ?? "0");
      if (allocSum - remaining > 0.01) {
        throw new McpToolError(
          `Allocation total ${allocSum} exceeds incoming payment remaining balance ${remaining}`,
        );
      }

      const createdBy = await resolveAgentUserId(tx as any);
      const inserted = [] as any[];
      for (const a of args.allocations) {
        // Verify each procedure exists so we fail fast (FK is enforced at DB level too).
        const [proc] = await tx
          .select({ id: proceduresTable.id })
          .from(proceduresTable)
          .where(eq(proceduresTable.reference, a.procedure_reference));
        if (!proc) {
          throw new McpToolError(
            `Procedure with reference "${a.procedure_reference}" does not exist`,
          );
        }
        const [row] = await tx
          .insert(paymentDistributions)
          .values({
            incomingPaymentId: args.incoming_payment_id,
            procedureReference: a.procedure_reference,
            distributedAmount: a.distributed_amount,
            paymentType: a.payment_type,
            distributionDate: a.distribution_date ? new Date(a.distribution_date) : new Date(),
            createdBy,
          })
          .returning();
        inserted.push(row);
      }

      // Refresh the parent incoming payment's distributed/remaining tallies.
      const newDistributed = (
        parseFloat((incoming as any).amountDistributed ?? "0") + allocSum
      ).toFixed(2);
      const newRemaining = (
        parseFloat((incoming as any).totalAmount ?? "0") - parseFloat(newDistributed)
      ).toFixed(2);
      const status =
        parseFloat(newRemaining) <= 0.005
          ? ("fully_distributed" as const)
          : parseFloat(newDistributed) > 0
          ? ("partially_distributed" as const)
          : ("pending_distribution" as const);
      await tx
        .update(incomingPaymentsTable)
        .set({
          amountDistributed: newDistributed,
          remainingBalance: newRemaining,
          distributionStatus: status,
          updatedAt: new Date(),
        })
        .where(eq(incomingPaymentsTable.id, args.incoming_payment_id));

      const createdIds = inserted.map((r) => r.id);
      return {
        data: { distributions: inserted, new_status: status },
        meta: {
          affectedTable: "payment_distributions",
          affectedIds: createdIds,
          summary: `Distributed incoming payment ${args.incoming_payment_id} into ${createdIds.length} allocations (status=${status})`,
        },
      };
    });
  },
});
