import { Suspense } from "react";
import CipherChatApp from "@/components/cc/app";
import { AppleSplashLinks } from "@/components/cc/apple-splash";
import { LetterSite } from "@/components/portfolio/letter";
import { ReaderSite } from "@/components/portfolio/site";

// One route, three faces (DESIGN.md §7):
//   /           - the Letter: the porch, a sheet on a desk
//   /?read=1    - the field-notes reader (the cabinet's document)
//   ?app=1      - the live product
//   ?join=CODE  - every invite link's first landing
// The client roots of the letter and the reader additionally hand
// off on hash routes (#/join, #/rooms…), which never round-trip
// the server.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const wantsApp =
    params.app === "1" ||
    (params.join !== undefined && params.join !== "");

  if (wantsApp) {
    return (
      <Suspense
        fallback={
          <div className="flex min-h-dvh items-center justify-center bg-paper" />
        }
      >
        {/* Server component. React 19 hoists these <link>s into <head>.
            Branded iOS launch image for the installed home-screen app. */}
        <AppleSplashLinks />
        <CipherChatApp />
      </Suspense>
    );
  }

  // The reader: the long document the porch's cabinet points at.
  // Anchors ride along (?read=1#protocol scrolls on arrival).
  if (params.read === "1") {
    return <ReaderSite />;
  }

  return <LetterSite />;
}
