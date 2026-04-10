import Link from "next/link";
import { buttonStyles } from "@/components/ui/button";

export default function AdminHome() {
  return (
    <section className="mx-auto max-w-2xl">
      <h1 className="text-3xl font-semibold tracking-tight">
        Administrator console
      </h1>
      <p className="mt-3 text-ink-muted">
        Verify providers, triage disputes and safeguarding reports, and handle
        data subject requests.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/admin/verification" className={buttonStyles()}>
          Verification queue
        </Link>
        <Link
          href="/admin/users"
          className={buttonStyles({ variant: "outline" })}
        >
          Users
        </Link>
      </div>
    </section>
  );
}
