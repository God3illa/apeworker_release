"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SignUpPage() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to home where Keycloak AuthProvider will capture and trigger SSO signup/login
    router.replace("/");
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#09090b] text-lime-400 font-bold gap-3">
      <div className="w-8 h-8 rounded-full border-4 border-lime-400 border-t-transparent animate-spin" />
      <span>Redirecting to ApeWorker Auth SSO...</span>
    </div>
  );
}
