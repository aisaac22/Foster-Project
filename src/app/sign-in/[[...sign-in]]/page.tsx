import { SignIn } from "@clerk/nextjs";

// Clerk's prebuilt sign-in UI. The [[...sign-in]] catch-all folder lets Clerk
// handle its own sub-routes (verification steps, etc.) under /sign-in.
export default function SignInPage() {
  return (
    <div style={{ display: "flex", justifyContent: "center", paddingTop: "3rem" }}>
      <SignIn />
    </div>
  );
}
