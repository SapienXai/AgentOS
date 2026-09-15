import { NextResponse } from "next/server";
import { z } from "zod";

import {
  generateGatewayNativeAuthToken,
  getGatewayBindMode,
  getGatewayNativeAuthStatus,
  getMissionControlSnapshot,
  repairGatewayNativeDeviceAccess,
  saveGatewayNativeAuthCredential,
  updateGatewayRemoteUrl
} from "@/lib/agentos/control-plane";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";
import { requireAgentOsOpenClawPreflight } from "@/lib/security/agentos-openclaw-request";
import { requireAgentOsActorContext } from "@/lib/security/agentos-actor";
import { recordAgentOsAuditEvent } from "@/lib/security/agentos-audit";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const gatewaySettingsSchema = z.object({
  gatewayUrl: z.string().max(2048).optional().nullable()
});

const gatewayAuthCredentialSchema = z.object({
  action: z.literal("saveCredential").optional(),
  kind: z.enum(["token", "password"]),
  value: z.string().min(1).max(4096)
});

const gatewayAuthGenerateSchema = z.object({
  action: z.literal("generateLocalToken")
});

const gatewayAuthRepairSchema = z.object({
  action: z.literal("repairDeviceAccess")
});

const noStoreHeaders = {
  "Cache-Control": "private, no-store, max-age=0"
};

export async function GET(request: Request) {
  const bindOnly = new URL(request.url).searchParams.get("view") === "bind";

  try {
    if (bindOnly) {
      return NextResponse.json({
        gatewayBind: await getGatewayBindMode()
      }, { headers: noStoreHeaders });
    }

    const authStatus = await getGatewayNativeAuthStatus();

    return NextResponse.json({
      authStatus: redactSecrets(authStatus)
    }, { headers: noStoreHeaders });
  } catch (error) {
    return NextResponse.json(
      {
        error: redactErrorMessage(
          error,
          bindOnly
            ? "Unable to inspect the current OpenClaw Gateway bind value."
            : "Unable to inspect the OpenClaw gateway auth status."
        )
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  const authorization = await requireAgentOsOpenClawPreflight(request, {
    operation: "gateway.config.patch",
    method: "config.patch",
    targetKind: "gateway-config",
    securityClass: "privileged-mutation",
    executionPath: "gateway-or-verified-cli",
    productPermission: "gateway.manage"
  });
  if ("response" in authorization) return authorization.response;

  try {
    const input = gatewaySettingsSchema.parse(await request.json());
    const snapshot = await updateGatewayRemoteUrl({
      gatewayUrl: input.gatewayUrl ?? null
    }, authorization.commandOptions);
    await recordAgentOsAuditEvent({
      actor: authorization.actor,
      operation: "gateway.config.patch",
      targetKind: "gateway-config",
      result: "succeeded"
    }).catch(() => {});

    return NextResponse.json({
      snapshot: redactSecrets(snapshot)
    }, { headers: noStoreHeaders });
  } catch (error) {
    await recordAgentOsAuditEvent({
      actor: authorization.actor,
      operation: "gateway.config.patch",
      targetKind: "gateway-config",
      result: "failed"
    }).catch(() => {});
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "Unable to update the OpenClaw gateway.")
      },
      { status: 400 }
    );
  }
}

export async function POST(request: Request) {
  const actorResult = await requireAgentOsActorContext(request);
  if ("response" in actorResult) return actorResult.response;

  try {
    const body = await request.json();

    if (gatewayAuthGenerateSchema.safeParse(body).success) {
      const permission = await requireAgentOsProductPermission(request, "gateway.manage");
      if ("response" in permission) return permission.response;
      const result = await generateGatewayNativeAuthToken();
      const authStatus = await getGatewayNativeAuthStatus();
      const verified = result.verified === true && authStatus.native.ok === true;
      const snapshot = verified ? await getMissionControlSnapshot({ force: true }) : null;
      await recordAgentOsAuditEvent({
        actor: actorResult.actor,
        operation: "gateway.auth.generate-token",
        targetKind: "gateway-credential",
        result: verified ? "succeeded" : "partial"
      }).catch(() => {});

      if (!verified) {
        return NextResponse.json({
          error: "Gateway token repair was applied, but native authentication could not be verified. Test auth again or use a known credential.",
          saved: true,
          generated: true,
          result: redactSecrets(result),
          authStatus: redactSecrets(authStatus),
          ...(snapshot ? { snapshot: redactSecrets(snapshot) } : {})
        }, { status: 409, headers: noStoreHeaders });
      }

      return NextResponse.json({
        saved: true,
        generated: true,
        result: redactSecrets(result),
        authStatus: redactSecrets(authStatus),
        ...(snapshot ? { snapshot: redactSecrets(snapshot) } : {})
      }, { headers: noStoreHeaders });
    }

    const repairInput = gatewayAuthRepairSchema.safeParse(body);
    if (repairInput.success) {
      // The repair scope set is server-owned. Browser input cannot request
      // arbitrary OpenClaw privileges.
      const repairAuthorization = await requireAgentOsOpenClawPreflight(request, {
        operation: "gateway.device.repair",
        method: "device.pair.approve",
        targetKind: "gateway-device",
        securityClass: "privileged-mutation",
        executionPath: "gateway-or-verified-cli",
        productPermission: "gateway.manage"
      });
      if ("response" in repairAuthorization) return repairAuthorization.response;

      const result = await repairGatewayNativeDeviceAccess({
        gatewayOptions: repairAuthorization.commandOptions
      });
      const authStatus = await getGatewayNativeAuthStatus();
      const verified = authStatus.native.ok === true;
      const snapshot = verified ? await getMissionControlSnapshot({ force: true }) : null;
      await recordAgentOsAuditEvent({
        actor: actorResult.actor,
        operation: "gateway.device.repair",
        targetKind: "gateway-device",
        result: verified ? "succeeded" : "partial"
      }).catch(() => {});

      if (!verified) {
        return NextResponse.json({
          error: "Local Gateway access was updated, but native authentication could not be verified. Test auth again.",
          saved: true,
          repaired: true,
          result: redactSecrets(result),
          authStatus: redactSecrets(authStatus),
          ...(snapshot ? { snapshot: redactSecrets(snapshot) } : {})
        }, { status: 409, headers: noStoreHeaders });
      }

      return NextResponse.json({
        saved: true,
        repaired: true,
        result: redactSecrets(result),
        authStatus: redactSecrets(authStatus),
        ...(snapshot ? { snapshot: redactSecrets(snapshot) } : {})
      }, { headers: noStoreHeaders });
    }

    const input = gatewayAuthCredentialSchema.parse(body);
    const permission = await requireAgentOsProductPermission(request, "gateway.manage");
    if ("response" in permission) return permission.response;
    const result = await saveGatewayNativeAuthCredential(input);
    const authStatus = await getGatewayNativeAuthStatus();
    const snapshot = authStatus.native.ok ? await getMissionControlSnapshot({ force: true }) : null;
    await recordAgentOsAuditEvent({
      actor: actorResult.actor,
      operation: "gateway.auth.save-credential",
      targetKind: "gateway-credential",
      result: authStatus.native.ok ? "succeeded" : "partial"
    }).catch(() => {});

    return NextResponse.json({
      saved: true,
      result: redactSecrets(result),
      authStatus: redactSecrets(authStatus),
      ...(snapshot ? { snapshot: redactSecrets(snapshot) } : {})
    }, { headers: noStoreHeaders });
  } catch (error) {
    await recordAgentOsAuditEvent({
      actor: actorResult.actor,
      operation: "gateway.auth.mutation",
      targetKind: "gateway-credential",
      result: "failed"
    }).catch(() => {});
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "Unable to save the OpenClaw gateway credential.")
      },
      { status: 400 }
    );
  }
}
