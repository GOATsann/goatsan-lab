import { AccountButton } from "@/components/account/AccountButton";
import { PaperView } from "@/components/paper/PaperView";

export default async function PaperPage({ params }: PageProps<"/paper/[slug]">) {
  const { slug } = await params;
  return (
    <>
      <AccountButton />
      <PaperView slug={slug} />
    </>
  );
}
