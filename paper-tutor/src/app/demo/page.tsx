import { AccountButton } from "@/components/account/AccountButton";
import { DemoPlayer } from "./DemoPlayer";

export const metadata = { title: "Attention Is All You Need, walked through | Paper Tutor" };

export default function DemoPage() {
  return (
    <>
      <AccountButton />
      <DemoPlayer />
    </>
  );
}
