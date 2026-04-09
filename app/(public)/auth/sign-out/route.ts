import { signOut } from "@/lib/auth/actions";

/**
 * Sign out is POST-only to prevent CSRF and link prefetching from
 * accidentally ending a session. Forms in the public header post here.
 */
export async function POST() {
  await signOut();
}
