"use client";

import { toast } from "sonner";

import { useInstanceProtection } from "@/components/auth/instance-protection-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function OperatorAccessPage() {
  const { signOut } = useInstanceProtection();
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-6 text-foreground">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle><h1>Operator access required</h1></CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            This view includes shared OpenClaw runtime data. Sign in with an authorized operator account to open it.
          </p>
          <Button type="button" onClick={() => void signOut().catch(() => toast.error("AgentOS could not sign out."))}>
            Sign out
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
