import { FlightDetailClient } from "@/components/FlightDetailClient";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    callsign?: string;
    begin?: string;
    end?: string;
  }>;
};

export default async function FlightPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  return (
    <main className="flex-1 bg-stone-50">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-10">
        <FlightDetailClient
          id={decodeURIComponent(id)}
          callsign={sp.callsign}
          begin={sp.begin}
          end={sp.end}
        />
      </div>
    </main>
  );
}
