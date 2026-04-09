import { Button } from "@/components/ui/button";

export default function ReceiverHome() {
  return (
    <section className="mx-auto max-w-2xl">
      <h1 className="text-3xl font-semibold tracking-tight">
        Welcome, care receiver
      </h1>
      <p className="mt-3 text-ink-muted">
        This is where you will find providers, arrange visits, and manage care
        for yourself or someone you love. Nothing here is wired up yet.
      </p>
      <div className="mt-8">
        <Button>Find a provider</Button>
      </div>
    </section>
  );
}
