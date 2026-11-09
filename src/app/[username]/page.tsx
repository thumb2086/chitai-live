import { notFound } from "next/navigation";
import PublicProfileClient from "./profile";

export function generateStaticParams() {
  return [
    { username: "thumb" },
    { username: "test" },
    { username: "accept" },
    { username: "leddo_auto_xra5" },
  ];
}

export default async function Page({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  if (!username) notFound();
  return <PublicProfileClient username={username} />;
}
