import type { Metadata } from "next";
import { AuthProvider } from "./AuthProvider";
import Sidebar from "./Sidebar";
import "./globals.css";

export const metadata: Metadata = {
  title: "ApeLabs Team Tool",
  description: "Download viral videos, overlay transparency watermarks, and schedule automated post publishing.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <AuthProvider>
      <html lang="en">
        <body className="bg-[#08080c] text-[#fafafa] h-screen overflow-hidden">
          {/* Main Dashboard Layout Container */}
          <div className="flex h-screen relative overflow-hidden">
            {/* Sidebar Navigation Client Component */}
            <Sidebar />

            {/* Main Content Workspace */}
            <main className="flex-1 bg-[#08080c] h-screen relative overflow-y-auto">
              {/* Background gradient layout accents in cosmic Gemini Omni style */}
              <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-lime-400/5 rounded-full blur-[120px] pointer-events-none -z-10" />
              <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-lime-400/3 rounded-full blur-[120px] pointer-events-none -z-10" />
              
              <div className="p-8 max-w-7xl mx-auto relative">
                {children}
              </div>
            </main>
          </div>
        </body>
      </html>
    </AuthProvider>
  );
}
