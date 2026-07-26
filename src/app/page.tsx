import { redirect } from "next/navigation";

export default function Home() {
  // Every account lands on its own dashboard first.
  redirect("/dashboard");
}
