import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";

import { Toaster } from "@/components/ui/sonner";
import { InstanceProtectionProvider } from "@/components/auth/instance-protection-provider";
import { PwaServiceWorkerRegistration } from "@/components/pwa/pwa-service-worker-registration";
import { getInstanceProtectionStatus, INSTANCE_PROTECTION_COOKIE } from "@/lib/security/instance-protection";

import "@/app/globals.css";

const siteTitle = "AgentOS | Control Plane";
const siteDescription = "Human Control Layer for AI Agents and Companies | Built on OpenClaw.";
const socialImagePath = "/readme/readme.jpeg";
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.VERCEL_URL;
const metadataBase = new URL(siteUrl ? (siteUrl.startsWith("http") ? siteUrl : `https://${siteUrl}`) : "http://localhost:3000");

export const viewport: Viewport = {
  themeColor: "#000000",
  viewportFit: "cover"
};

export const metadata: Metadata = {
  metadataBase,
  title: siteTitle,
  description: siteDescription,
  applicationName: "AgentOS",
  manifest: "/site.webmanifest",
  appleWebApp: {
    capable: true,
    title: "AgentOS",
    statusBarStyle: "black-translucent",
    startupImage: [
      {
        url: "/pwa/splash-1170x2532.png",
        media: "(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)"
      },
      {
        url: "/pwa/splash-1179x2556.png",
        media: "(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3)"
      },
      {
        url: "/pwa/splash-1284x2778.png",
        media: "(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3)"
      },
      {
        url: "/pwa/splash-1290x2796.png",
        media: "(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3)"
      },
      {
        url: "/pwa/splash-2048x2732.png",
        media: "(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2)"
      }
    ]
  },
  formatDetection: {
    telephone: false,
    email: false,
    address: false
  },
  other: {
    "mobile-web-app-capable": "yes"
  },
  openGraph: {
    type: "website",
    siteName: "AgentOS | Control Plane",
    title: siteTitle,
    description: siteDescription,
    images: [
      {
        url: socialImagePath,
        width: 1536,
        height: 1024,
        alt: "AgentOS control-plane interface"
      }
    ]
  },
  twitter: {
    card: "summary_large_image",
    title: siteTitle,
    description: siteDescription,
    images: [socialImagePath]
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any", type: "image/x-icon" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-48x48.png", sizes: "48x48", type: "image/png" },
      { url: "/pwa/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/pwa/icon-512.png", sizes: "512x512", type: "image/png" }
    ],
    apple: [{ url: "/pwa/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    shortcut: ["/favicon.ico"]
  }
};

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const initialProtectionStatus = await getInstanceProtectionStatus(
    cookieStore.get(INSTANCE_PROTECTION_COOKIE)?.value ?? null
  );

  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body>
        <InstanceProtectionProvider initialStatus={initialProtectionStatus}>
          {children}
          <PwaServiceWorkerRegistration />
          <Toaster theme="system" richColors closeButton />
        </InstanceProtectionProvider>
      </body>
    </html>
  );
}
