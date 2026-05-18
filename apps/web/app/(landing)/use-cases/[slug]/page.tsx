import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LandingHeader } from "@/features/landing/components/landing-header";
import { LandingFooter } from "@/features/landing/components/landing-footer";
import { Screenshot } from "@/features/landing/components/mdx/screenshot";
import { useCasesSource } from "@/lib/use-cases-source";

type Params = { slug: string };

export function generateStaticParams() {
  return useCasesSource
    .generateParams()
    .filter((p) => p.slug.length > 0)
    .map((p) => ({ slug: p.slug[0]! }));
}

export async function generateMetadata(props: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await props.params;
  const page = useCasesSource.getPage([slug]);
  if (!page) return {};

  return {
    title: page.data.title,
    description: page.data.description,
    openGraph: {
      title: page.data.title,
      description: page.data.description,
      url: `/use-cases/${slug}`,
    },
    alternates: {
      canonical: `/use-cases/${slug}`,
    },
  };
}

export default async function UseCasePage(props: { params: Promise<Params> }) {
  const { slug } = await props.params;
  const page = useCasesSource.getPage([slug]);
  if (!page) notFound();

  const MDX = page.data.body;

  return (
    <>
      <LandingHeader variant="light" />
      <main className="bg-white text-[#0a0d12]">
        <article className="mx-auto max-w-[720px] px-4 py-16 sm:px-6 sm:py-20 lg:py-24">
          <h1 className="font-[family-name:var(--font-serif)] text-[2.6rem] leading-[1.05] tracking-[-0.03em] sm:text-[3.4rem]">
            {page.data.title}
          </h1>
          <div className="mt-10 space-y-6 text-[15px] leading-[1.8] text-[#0a0d12]/70 sm:text-[16px]">
            <MDX components={{ Screenshot }} />
          </div>
        </article>
      </main>
      <LandingFooter />
    </>
  );
}
