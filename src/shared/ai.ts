import { z } from "zod";
import { AI_ACTIONS } from "./types";
import type { AiActionId } from "./types";

/**
 * Public, schema-validated contract for the DeepSeek decision advisor.
 * The model returns a proposal only. The server validates the shape, action
 * whitelist and target existence; the simulation engine validates the
 * preconditions and is solely responsible for changing the world.
 */
export const aiActionSchema = z.enum(AI_ACTIONS);

export const aiDecisionTargetSchema = z
  .object({
    id: z.string().min(1).max(64),
    kind: z.enum(["resident", "building"]),
    name: z.string().min(1).max(40),
    note: z.string().max(96).optional(),
  })
  .strict();

export const aiResidentSummarySchema = z
  .object({
    name: z.string().min(1).max(40),
    age: z.number().int().min(0).max(140),
    pronouns: z.string().max(4),
    jobTitle: z.string().max(40),
    factionName: z.string().max(40),
    personalityLabels: z.array(z.string().max(16)).max(8),
    values: z.array(z.string().max(24)).max(6),
    backstory: z.string().max(240),
    mood: z.number().min(0).max(100),
    stress: z.number().min(0).max(100),
    health: z.number().min(0).max(100),
    wealth: z.number().min(0).max(1_000_000),
    needs: z
      .object({
        hunger: z.number().min(0).max(100),
        energy: z.number().min(0).max(100),
        social: z.number().min(0).max(100),
        safety: z.number().min(0).max(100),
      })
      .strict(),
    goals: z.array(z.string().max(120)).max(5),
    importantMemories: z.array(z.string().max(160)).max(5),
    relationships: z
      .array(
        z
          .object({
            name: z.string().max(40),
            type: z.string().max(20),
            trust: z.number().min(-100).max(100),
            affinity: z.number().min(-100).max(100),
            attraction: z.number().min(-100).max(100),
            targetId: z.string().max(64),
          })
          .strict(),
      )
      .max(8),
    currentPlace: z.string().max(60),
    currentAction: z.string().max(80),
    recentDecisionReasons: z.array(z.string().max(120)).max(3),
  })
  .strict();

export const aiWorldSummarySchema = z
  .object({
    day: z.number().int().min(1).max(100_000),
    time: z.string().regex(/^\d{2}:\d{2}$/),
    weather: z.string().max(24),
    metrics: z
      .object({
        stability: z.number().min(0).max(100),
        pollution: z.number().min(0).max(100),
        trust: z.number().min(0).max(100),
        inequality: z.number().min(0).max(100),
        resourceSupply: z.number().min(0).max(100),
      })
      .strict(),
    reserves: z
      .object({
        food: z.number().min(0).max(1_000_000),
        energy: z.number().min(0).max(1_000_000),
        meds: z.number().min(0).max(1_000_000),
      })
      .strict(),
    recentEvents: z.array(z.string().max(160)).max(6),
  })
  .strict();

export const aiDecisionRequestSchema = z
  .object({
    requestId: z.string().min(1).max(64),
    residentId: z.string().min(1).max(64),
    resident: aiResidentSummarySchema,
    world: aiWorldSummarySchema,
    allowedActions: z.array(aiActionSchema).min(1).max(AI_ACTIONS.length),
    targets: z.array(aiDecisionTargetSchema).max(16),
  })
  .strict();

export const aiProposalSchema = z
  .object({
    action: aiActionSchema,
    targetId: z.string().max(64).nullish(),
    reason: z.string().min(2).max(160),
  })
  .strict();

export const aiModelResponseSchema = z
  .object({
    action: aiActionSchema,
    targetId: z.string().max(64).nullish(),
    reason: z.string().min(2).max(160),
  })
  .strict();

export type AiDecisionTarget = z.infer<typeof aiDecisionTargetSchema>;
export type AiResidentSummary = z.infer<typeof aiResidentSummarySchema>;
export type AiWorldSummary = z.infer<typeof aiWorldSummarySchema>;
export type AiDecisionRequest = z.infer<typeof aiDecisionRequestSchema>;
export type AiProposal = z.infer<typeof aiProposalSchema>;

export interface AiProposalMeta {
  model: string;
  latencyMs: number;
  retried: boolean;
  source: "deepseek" | "mock";
  requestId: string;
}

export interface AiProposalSuccessResponse {
  ok: true;
  proposal: AiProposal;
  meta: AiProposalMeta;
}

export interface AiProposalErrorResponse {
  ok: false;
  error: string;
  code:
    | "AI_OFFLINE"
    | "AI_RATE_LIMITED"
    | "AI_TIMEOUT"
    | "AI_UPSTREAM_ERROR"
    | "AI_INVALID_JSON"
    | "AI_INVALID_PROPOSAL"
    | "AI_ACTION_NOT_ALLOWED"
    | "AI_UNKNOWN_TARGET"
    | "AI_DISABLED"
    | "BAD_REQUEST";
}

export type AiProposalResponse = AiProposalSuccessResponse | AiProposalErrorResponse;

/** Actions for which a target may be meaningful; used to filter the request targets. */
export const ACTION_TARGET_KIND: Partial<Record<AiActionId, "resident" | "building">> = {
  work: "building",
  eat: "building",
  shop: "building",
  go_home: "building",
  heal: "building",
  study: "building",
  wander: "building",
  talk: "resident",
  befriend: "resident",
  seek_help: "resident",
  date: "resident",
  argue: "resident",
  reconcile: "resident",
  cooperate: "resident",
  conceal: "resident",
  betray: "resident",
  rest: "building",
};
