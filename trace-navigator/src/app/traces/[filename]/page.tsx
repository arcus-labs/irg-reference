import TraceDetailClient from '@/components/TraceDetailClient';

interface TraceDetailPageProps {
  params: Promise<{ filename: string }>;
}

// Mark this route as dynamic to prevent static generation
export const dynamic = 'force-dynamic';

export default async function TraceDetailPage({ params }: TraceDetailPageProps) {
  const { filename } = await params;

  return <TraceDetailClient filename={filename} />;
}

