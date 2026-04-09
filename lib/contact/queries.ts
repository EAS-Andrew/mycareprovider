import "server-only";

import { createServerClient } from "@/lib/supabase/server";

import type {
  ContactRequestDetail,
  ContactRequestRow,
  ContactRequestStatus,
  IncomingContactRequestRow,
  LocationMode,
  MeetingProposalRow,
  MeetingStatus,
  OutgoingContactRequestRow,
  ThreadPostRow,
  ThreadRow,
} from "./types";

/**
 * Read helpers for C8 Server Components. These are NOT `"use server"` - they
 * are pure server-only data functions consumed by Server Component pages.
 * Every query goes through the user-scoped Supabase client so the C8 RLS
 * policies in `supabase/migrations/0008_contact_messaging.sql` are the
 * authoritative gate. No admin client.
 *
 * The helpers return empty arrays / null rather than throwing on missing
 * auth, which matches how `lib/documents/actions.ts#listOwnDocuments`
 * degrades for the unauthenticated case. Unexpected DB errors still throw
 * so a misconfigured schema is not silently swallowed.
 */

const CONTACT_REQUEST_COLUMNS =
  "id, receiver_id, provider_id, subject, body, status, responded_at, response_note, created_at, updated_at";

const MEETING_PROPOSAL_COLUMNS =
  "id, contact_request_id, proposed_by, proposed_at, meeting_at, duration_minutes, location_mode, location_detail, status, responded_at, response_note, created_at, updated_at";

const THREAD_POST_COLUMNS = "id, thread_id, author_id, body, created_at";

/**
 * Hard cap for paginated listings. Keeps a single page bounded so a
 * provider with thousands of historical contact requests does not stream
 * the full table through the Server Component render path. Callers can
 * request up to DEFAULT_LIST_LIMIT items plus a cursor; older rows are
 * reachable via a subsequent call with `cursor` set to the last row's
 * `created_at`. See contact-findings H-7.
 */
export const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 100;
const DEFAULT_POST_LIMIT = 100;

export type ListOptions = {
  limit?: number;
  // ISO timestamp; return rows strictly older than this value.
  cursor?: string | null;
};

export type PaginatedResult<T> = {
  rows: T[];
  nextCursor: string | null;
};

function clampLimit(requested: number | undefined): number {
  if (!requested || !Number.isFinite(requested) || requested <= 0) {
    return DEFAULT_LIST_LIMIT;
  }
  return Math.min(Math.floor(requested), MAX_LIST_LIMIT);
}

type RawContactRequest = {
  id: string;
  receiver_id: string;
  provider_id: string;
  subject: string;
  body: string;
  status: string;
  responded_at: string | null;
  response_note: string | null;
  created_at: string;
  updated_at: string;
};

function mapContactRequest(row: RawContactRequest): ContactRequestRow {
  return {
    id: row.id,
    receiver_id: row.receiver_id,
    provider_id: row.provider_id,
    subject: row.subject,
    body: row.body,
    status: row.status as ContactRequestStatus,
    responded_at: row.responded_at,
    response_note: row.response_note,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

type RawMeetingProposal = {
  id: string;
  contact_request_id: string;
  proposed_by: string;
  proposed_at: string;
  meeting_at: string;
  duration_minutes: number;
  location_mode: string;
  location_detail: string | null;
  status: string;
  responded_at: string | null;
  response_note: string | null;
  created_at: string;
  updated_at: string;
};

function mapMeetingProposal(row: RawMeetingProposal): MeetingProposalRow {
  return {
    id: row.id,
    contact_request_id: row.contact_request_id,
    proposed_by: row.proposed_by,
    proposed_at: row.proposed_at,
    meeting_at: row.meeting_at,
    duration_minutes: row.duration_minutes,
    location_mode: row.location_mode as LocationMode,
    location_detail: row.location_detail,
    status: row.status as MeetingStatus,
    responded_at: row.responded_at,
    response_note: row.response_note,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Provider dashboard: every contact request targeted at the signed-in
 * provider, newest first. RLS hides rows that belong to other providers.
 * Joins the receiver's `display_name` via the column-level public grant
 * on `profiles`.
 */
export async function listIncomingContactRequests(
  options: ListOptions = {},
): Promise<PaginatedResult<IncomingContactRequestRow>> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { rows: [], nextCursor: null };
  }

  const limit = clampLimit(options.limit);
  // Fetch limit+1 so we know whether a `nextCursor` should be emitted.
  let query = supabase
    .from("contact_requests")
    // The nested `receiver` join pulls the sender's display name via the
    // narrow cross-user SELECT policy added in migration 0009 (sql-fixer)
    // which exposes (id, role, display_name) on profiles to any
    // authenticated caller. Without that policy the join returns null and
    // the UI falls back to "Care receiver". See contact-findings H-4.
    .select(`${CONTACT_REQUEST_COLUMNS}, receiver:profiles!receiver_id(display_name)`)
    .eq("provider_id", user.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit + 1);

  if (options.cursor) {
    query = query.lt("created_at", options.cursor);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`listIncomingContactRequests: ${error.message}`);
  }

  type Row = RawContactRequest & {
    receiver:
      | { display_name: string | null }
      | Array<{ display_name: string | null }>
      | null;
  };

  const raw = (data ?? []) as Row[];
  const hasMore = raw.length > limit;
  const slice = hasMore ? raw.slice(0, limit) : raw;
  const rows = slice.map((row) => {
    const receiver = Array.isArray(row.receiver)
      ? (row.receiver[0] ?? null)
      : row.receiver;
    return {
      ...mapContactRequest(row),
      receiver_display_name: receiver?.display_name ?? null,
    };
  });
  const nextCursor = hasMore ? rows[rows.length - 1].created_at : null;
  return { rows, nextCursor };
}

/**
 * Receiver dashboard: every contact request the signed-in receiver has
 * sent, newest first. Joins the target provider's `headline` via the
 * `provider_profiles_public_read` RLS policy (verified providers only -
 * soft-deleted or unverified providers will return null).
 */
export async function listOutgoingContactRequests(
  options: ListOptions = {},
): Promise<PaginatedResult<OutgoingContactRequestRow>> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { rows: [], nextCursor: null };
  }

  const limit = clampLimit(options.limit);
  let query = supabase
    .from("contact_requests")
    .select(`${CONTACT_REQUEST_COLUMNS}, provider:provider_profiles!provider_id(headline)`)
    .eq("receiver_id", user.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit + 1);

  if (options.cursor) {
    query = query.lt("created_at", options.cursor);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`listOutgoingContactRequests: ${error.message}`);
  }

  type Row = RawContactRequest & {
    provider:
      | { headline: string | null }
      | Array<{ headline: string | null }>
      | null;
  };

  const raw = (data ?? []) as Row[];
  const hasMore = raw.length > limit;
  const slice = hasMore ? raw.slice(0, limit) : raw;
  const rows = slice.map((row) => {
    const provider = Array.isArray(row.provider)
      ? (row.provider[0] ?? null)
      : row.provider;
    return {
      ...mapContactRequest(row),
      provider_headline: provider?.headline ?? null,
    };
  });
  const nextCursor = hasMore ? rows[rows.length - 1].created_at : null;
  return { rows, nextCursor };
}

/**
 * Full detail view for a single contact request: the request itself plus
 * all meeting proposals, the thread (if the request has been accepted),
 * and every post in it. Returns `null` if RLS hides the row from the
 * caller. Used by both sides' "/<role>/contacts/[id]" pages.
 */
export async function getContactRequestWithThread(
  contactRequestId: string,
): Promise<ContactRequestDetail | null> {
  if (!contactRequestId) {
    return null;
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return null;
  }

  const { data: requestRow, error: requestError } = await supabase
    .from("contact_requests")
    .select(
      `${CONTACT_REQUEST_COLUMNS}, receiver:profiles!receiver_id(display_name), provider:provider_profiles!provider_id(headline)`,
    )
    .eq("id", contactRequestId)
    .is("deleted_at", null)
    .maybeSingle();

  if (requestError) {
    throw new Error(`getContactRequestWithThread: ${requestError.message}`);
  }
  if (!requestRow) {
    return null;
  }

  type RequestShape = RawContactRequest & {
    receiver:
      | { display_name: string | null }
      | Array<{ display_name: string | null }>
      | null;
    provider:
      | { headline: string | null }
      | Array<{ headline: string | null }>
      | null;
  };

  const typed = requestRow as RequestShape;
  const receiver = Array.isArray(typed.receiver)
    ? (typed.receiver[0] ?? null)
    : typed.receiver;
  const provider = Array.isArray(typed.provider)
    ? (typed.provider[0] ?? null)
    : typed.provider;

  const { data: proposalsData, error: proposalsError } = await supabase
    .from("meeting_proposals")
    .select(MEETING_PROPOSAL_COLUMNS)
    .eq("contact_request_id", contactRequestId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (proposalsError) {
    throw new Error(
      `getContactRequestWithThread.proposals: ${proposalsError.message}`,
    );
  }

  const { data: threadData, error: threadError } = await supabase
    .from("contact_threads")
    .select("id, contact_request_id, created_at, updated_at")
    .eq("contact_request_id", contactRequestId)
    .is("deleted_at", null)
    .maybeSingle();

  if (threadError) {
    throw new Error(
      `getContactRequestWithThread.thread: ${threadError.message}`,
    );
  }

  let posts: ThreadPostRow[] = [];
  let thread: ThreadRow | null = null;
  if (threadData) {
    thread = threadData as ThreadRow;
    // Cap to DEFAULT_POST_LIMIT newest posts (descending), then reverse so
    // the UI still reads oldest->newest. A "Load more" cursor for older
    // history lands with C9; for the Phase 1a bridge a hard cap keeps
    // memory bounded on a long-running thread. See contact-findings H-7.
    const { data: postsData, error: postsError } = await supabase
      .from("contact_thread_posts")
      .select(THREAD_POST_COLUMNS)
      .eq("thread_id", thread.id)
      .order("created_at", { ascending: false })
      .limit(DEFAULT_POST_LIMIT);
    if (postsError) {
      throw new Error(
        `getContactRequestWithThread.posts: ${postsError.message}`,
      );
    }
    posts = ((postsData ?? []) as ThreadPostRow[]).slice().reverse();
  }

  return {
    request: {
      ...mapContactRequest(typed),
      receiver_display_name: receiver?.display_name ?? null,
      provider_headline: provider?.headline ?? null,
    },
    proposals: ((proposalsData ?? []) as RawMeetingProposal[]).map(
      mapMeetingProposal,
    ),
    thread,
    posts,
  };
}
