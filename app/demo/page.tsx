import EventExperience from "@/components/event/EventExperience";
import type { EventPhase } from "@/lib/contracts";
export default async function DemoPage({ searchParams }: { searchParams: Promise<{ phase?: string }> }) {
  const { phase } = await searchParams;
  const mode: EventPhase = phase === "live" || phase === "after" ? phase : "before";
  return <EventExperience demo={mode} />;
}
