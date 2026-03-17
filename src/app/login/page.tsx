import { redirect } from "next/navigation";
import { auth } from "@/auth";
import LoginPageClient from "@/components/LoginPageClient";

export default async function LoginPage() {
  const session = await auth();

  if (session?.login) {
    redirect("/repos");
  }

  return <LoginPageClient />;
}
