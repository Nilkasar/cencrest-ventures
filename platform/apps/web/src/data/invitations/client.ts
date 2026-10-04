import { apiClient, ApiError } from "@/lib/api-client";

/**
 * Epic 22 Phase 2 — the `/invitations/accept?token=` page's data seam
 * (`apps/api/src/routes/orgs.ts`):
 *
 *   GET  /api/orgs/invitations/preview?token=   PUBLIC -> previewInvitation()
 *   POST /api/orgs/invitations/accept { token } auth   -> acceptInvitation()
 *
 * The preview is fetched with plain `fetch`, not `apiClient`: it is public,
 * and `apiClient`'s 401 → refresh → "session expired, go to /login" path
 * must never fire for a signed-out visitor reading an invitation.
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api";

export interface InvitationPreview {
  organizationName: string;
  inviterName: string | null;
  role: string;
  /** Masked (`j***@acme.example`). */
  email: string;
  expired: boolean;
  accepted: boolean;
}

export class InvitationNotFoundError extends Error {
  constructor(message = "This invitation link is not valid. Ask the person who invited you to send a new one.") {
    super(message);
    this.name = "InvitationNotFoundError";
  }
}

export async function previewInvitation(token: string, signal?: AbortSignal): Promise<InvitationPreview> {
  const res = await fetch(`${API_BASE_URL}/orgs/invitations/preview?token=${encodeURIComponent(token)}`, { signal });
  if (res.status === 404) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new InvitationNotFoundError(body?.message);
  }
  if (!res.ok) throw new Error(`Couldn't load this invitation (HTTP ${res.status}). Try again in a moment.`);
  return (await res.json()) as InvitationPreview;
}

export interface AcceptedInvitation {
  success: true;
  organizationId: string;
  organizationSlug: string;
  organizationName: string;
  role: string;
  alreadyMember: boolean;
}

export type AcceptErrorCode =
  | "invalid_request"
  | "invalid_token"
  | "email_mismatch"
  | "already_accepted"
  | "expired"
  | "revoked"
  | "organization_deleted"
  | "unknown";

export class AcceptInvitationError extends Error {
  constructor(
    message: string,
    public readonly code: AcceptErrorCode,
  ) {
    super(message);
    this.name = "AcceptInvitationError";
  }
}

const KNOWN_CODES: readonly AcceptErrorCode[] = [
  "invalid_request",
  "invalid_token",
  "email_mismatch",
  "already_accepted",
  "expired",
  "revoked",
  "organization_deleted",
];

export async function acceptInvitation(token: string): Promise<AcceptedInvitation> {
  try {
    return await apiClient.post<AcceptedInvitation>("/orgs/invitations/accept", { token });
  } catch (err) {
    if (err instanceof ApiError) {
      const body = (err.body ?? {}) as { code?: string; message?: string; error?: string };
      const code = KNOWN_CODES.includes(body.code as AcceptErrorCode) ? (body.code as AcceptErrorCode) : "unknown";
      throw new AcceptInvitationError(body.message ?? body.error ?? "Couldn't accept this invitation — try again.", code);
    }
    throw err;
  }
}
