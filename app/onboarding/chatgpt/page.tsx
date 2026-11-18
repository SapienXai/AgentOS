import Image from "next/image";

export default function ChatGptBrowserHandoff() {
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-6 text-foreground">
      <div className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-card p-7">
        <Image src="/assets/logo.webp" alt="AgentOS" width={36} height={36} className="rounded-lg" />
        <h1 className="text-2xl font-semibold tracking-tight">Opening ChatGPT sign-in</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Keep your AgentOS setup tab open. OpenAI will open here when OpenClaw has prepared your secure sign-in.
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          If this page stays open, switch back to the AgentOS tab to check the connection status.
        </p>
      </div>
    </main>
  );
}
