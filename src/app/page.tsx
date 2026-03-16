import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getSyncConfig } from "@/lib/sheet-store";

export default async function HomePage() {
  const session = await auth();

  if (!session?.login) {
    redirect("/login");
  }

  redirect(getSyncConfig(session.login) ? "/sheet" : "/repos");
}
