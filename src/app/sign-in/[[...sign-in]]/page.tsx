import { SignIn } from "@clerk/nextjs";

// Clerk's prebuilt sign-in UI. The [[...sign-in]] catch-all folder lets Clerk
// handle its own sub-routes (verification steps, etc.) under /sign-in.
//
// fallbackRedirectUrl sends Clerk straight to /dashboard after auth, rather
// than to "/" and relying on that page's redirect() to forward the user —
// the client-side navigation Clerk performs post-sign-in wasn't following
// that second hop reliably (landed on "/" with a fully-resolved response but
// never continued on to /dashboard until a hard refresh).
export default function SignInPage() {
  return (
    <div style={{ display: "flex", justifyContent: "center", paddingTop: "3rem" }}>
      <SignIn fallbackRedirectUrl="/dashboard" />
    </div>
  );
}
