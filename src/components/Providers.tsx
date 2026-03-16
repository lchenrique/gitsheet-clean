"use client";

import { ReactNode, useEffect } from "react";
import { SessionProvider } from "next-auth/react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { useTimesheetStore } from "@/store/timesheetStore";

interface ProvidersProps {
  children: ReactNode;
}

function ZustandProvider({ children }: ProvidersProps) {
  useEffect(() => {
    useTimesheetStore.persist.rehydrate();
  }, []);

  return <>{children}</>;
}

export default function Providers({ children }: ProvidersProps) {
  return (
    <SessionProvider>
      <ZustandProvider>
        {children}
        <Toaster />
        <Sonner />
      </ZustandProvider>
    </SessionProvider>
  );
}
