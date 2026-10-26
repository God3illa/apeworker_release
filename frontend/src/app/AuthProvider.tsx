"use client";

import { createContext, useContext, useEffect, useState } from "react";
import Keycloak from "keycloak-js";

interface AuthContextType {
  authenticated: boolean;
  token: string | null;
  username: string | null;
  email: string | null;
  logout: () => void;
  getToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [keycloak, setKeycloak] = useState<Keycloak | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [userInfo, setUserInfo] = useState<{ preferred_username?: string; email?: string } | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const kc = new Keycloak({
      url: process.env.NEXT_PUBLIC_KEYCLOAK_URL || "https://auth.apeworker.top",
      realm: process.env.NEXT_PUBLIC_KEYCLOAK_REALM || "apeworker",
      clientId: process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID || "apeworker-frontend"
    });

    kc.init({ 
      onLoad: "login-required", 
      checkLoginIframe: false,
      pkceMethod: "S256"
    }).then(auth => {
      setAuthenticated(auth);
      setKeycloak(kc);
      if (auth) {
        setToken(kc.token || null);
        kc.loadUserInfo().then(info => setUserInfo(info as any));

        // Wipes Keycloak OIDC hash/fragment query params (code, state, iss, session_state) from URL securely
        if (typeof window !== "undefined" && window.location.hash) {
          const hash = window.location.hash;
          if (hash.includes("state=") || hash.includes("code=")) {
            window.history.replaceState(
              {},
              document.title,
              window.location.pathname + window.location.search
            );
          }
        }
      }
    }).catch(err => {
      console.error("Keycloak authentication initialization failed:", err);
    });
  }, []);

  const logout = () => {
    if (keycloak) {
      keycloak.logout({ redirectUri: window.location.origin });
    }
  };

  const getToken = async () => {
    if (!keycloak) return null;
    try {
      const refreshed = await keycloak.updateToken(30);
      if (refreshed) {
        setToken(keycloak.token || null);
      }
      return keycloak.token || null;
    } catch (e) {
      console.error("Session expired, redirecting to SSO...", e);
      keycloak.login();
      return null;
    }
  };

  return (
    <AuthContext.Provider value={{
      authenticated,
      token,
      username: userInfo?.preferred_username || null,
      email: userInfo?.email || null,
      logout,
      getToken
    }}>
      {authenticated ? children : (
        <div className="h-screen w-screen flex flex-col items-center justify-center bg-[#08080c] text-lime-400 font-bold gap-4 animate-pulse">
          <div className="w-10 h-10 rounded-full border-4 border-lime-400 border-t-transparent animate-spin" />
          <span className="text-xs tracking-widest uppercase">Connecting to ApeWorker Security SSO...</span>
        </div>
      )}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
};
