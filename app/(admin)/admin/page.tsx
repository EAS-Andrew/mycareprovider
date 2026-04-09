import { Button } from "@/components/ui/button";

export default function AdminHome() {
  return (
    <section className="mx-auto max-w-2xl">
      <h1 className="text-3xl font-semibold tracking-tight">
        Administrator console
      </h1>
      <p className="mt-3 text-ink-muted">
        This is where admins verify providers, triage disputes and
        safeguarding reports, and handle data subject requests. Nothing here
        is wired up yet.
      </p>
      <div className="mt-8">
        <Button>Open verification queue</Button>
      </div>
    </section>
  );
}
