export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { prepareAgentOsRuntimeStorage } = await import("@/lib/agentos/runtime-storage");
  await prepareAgentOsRuntimeStorage();

  const { bootstrapInitialInstanceProtection } = await import(
    "@/lib/security/initial-instance-bootstrap"
  );
  const result = await bootstrapInitialInstanceProtection();

  if (result.status === "created") {
    console.info("AgentOS Instance Protection was initialized for this deployment.");
  }
}
