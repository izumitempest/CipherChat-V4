import { Suspense } from "react";
import CipherChatApp from "@/components/cc/app";
import { AppleSplashLinks } from "@/components/cc/apple-splash";

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center bg-paper" />
      }
    >
      {/* Server component — React 19 hoists these <link>s into <head>.
          Branded iOS launch image for the installed home-screen app. */}
      <AppleSplashLinks />
      <CipherChatApp />
    </Suspense>
  );
}
