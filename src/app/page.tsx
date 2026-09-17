import { Suspense } from "react";
import CipherChatApp from "@/components/cc/app";

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center bg-paper" />
      }
    >
      <CipherChatApp />
    </Suspense>
  );
}
