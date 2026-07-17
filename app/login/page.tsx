import { Suspense } from "react";

import { ProtectedLogin } from "@/components/auth/protected-login";

export default function LoginPage() {
  return <Suspense fallback={<main className="min-h-screen bg-background" />}><ProtectedLogin /></Suspense>;
}
