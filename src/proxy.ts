import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// The sign-in route (and Clerk's own internal routes) must stay public so a
// signed-out user can actually reach the login screen. Everything else requires
// a session.
const isPublic = createRouteMatcher(["/sign-in(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublic(req)) {
    // Redirects signed-out users to the sign-in page.
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Run on everything except Next internals and static files…
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // …and always on API routes.
    "/(api|trpc)(.*)",
  ],
};
