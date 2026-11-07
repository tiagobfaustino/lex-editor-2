import { z } from 'zod';

import { DesktopErrorDtoSchema } from './desktop-api.js';

export const SESSION_GET_STATE_CHANNEL = 'session:get-state' as const;
export const SESSION_SIGN_IN_CHANNEL = 'session:sign-in' as const;
export const SESSION_SIGN_OUT_CHANNEL = 'session:sign-out' as const;
export const DESKTOP_SESSION_LIMITS = Object.freeze({ commandBytes: 8_192, stateBytes: 1_024 });
export const SessionEmptyCommandSchema = z.strictObject({});
export const SessionSignInCommandSchema = z.strictObject({
  email: z.email().max(254),
  password: z.string().min(1).max(1_024),
});
export const SessionRoleSchema = z.enum(['editor_juridico', 'administrador_tecnico']);
export const SessionStateDtoSchema = z.discriminatedUnion('sessionState', [
  z.strictObject({ sessionState: z.literal('not_configured'), userId: z.null(), role: z.null() }),
  z.strictObject({ sessionState: z.literal('signed_out'), userId: z.null(), role: z.null() }),
  z.strictObject({
    sessionState: z.literal('authenticated'),
    userId: z.uuid(),
    role: SessionRoleSchema,
  }),
]);
export const SessionStateResultSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), value: SessionStateDtoSchema }),
  z.strictObject({ ok: z.literal(false), error: DesktopErrorDtoSchema }),
]);
export type SessionEmptyCommand = z.infer<typeof SessionEmptyCommandSchema>;
export type SessionSignInCommand = z.infer<typeof SessionSignInCommandSchema>;
export type SessionRole = z.infer<typeof SessionRoleSchema>;
export type SessionStateDto = z.infer<typeof SessionStateDtoSchema>;
export type SessionStateResult = z.infer<typeof SessionStateResultSchema>;
