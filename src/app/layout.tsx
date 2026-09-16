import type { Metadata, Viewport } from "next";
import { Lora, Inter, IBM_Plex_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { SwRegister } from "@/components/cc/sw-register";
import "./globals.css";

const lora = Lora({
  variable: "--font-lora",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "CipherChat — a conversation that leaves no trace",
  description:
    "End-to-end encrypted, ephemeral rooms. No accounts, no history, no trace. Messages are encrypted in your browser and destroyed on schedule.",
  applicationName: "CipherChat",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/icon-192.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "CipherChat",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F4F1EB" },
    { media: "(prefers-color-scheme: dark)", color: "#17181A" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${lora.variable} ${inter.variable} ${plexMono.variable} bg-paper text-charcoal font-sans antialiased`}
      >
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
          {children}
          {/* Paper grain — the whole world is paper, even at night */}
          <div className="grain" aria-hidden="true" />
          <Toaster position="top-center" />
          <SwRegister />
        </ThemeProvider>
      </body>
    </html>
  );
}
