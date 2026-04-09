import { Button } from "@/components/ui/button";

export default function ProviderHome() {
  return (
    <section className="mx-auto max-w-2xl">
      <h1 className="text-3xl font-semibold tracking-tight">
        Welcome, care provider
      </h1>
      <p className="mt-3 text-ink-muted">
        This is where you will manage your profile, answer contact requests,
        and track the people in your care. Nothing here is wired up yet.
      </p>
      <div className="mt-8">
        <Button>Complete your profile</Button>
      </div>
    </section>
  );
}
