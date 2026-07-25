import { redirect } from "next/navigation";

export default function Home() {
  // The at-risk worklist is the product's center of gravity; start there.
  redirect("/at-risk");
}
