import EventExperience from "@/components/event/EventExperience";
export const dynamic = "force-dynamic";
export default async function CardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <EventExperience token={token} />;
}
