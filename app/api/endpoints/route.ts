// app/api/endpoints/route.ts
import { NextResponse } from "next/server";

const CIRCLE_BASE_URL = "https://api.circle.com";
const CIRCLE_API_KEY = process.env.CIRCLE_API_KEY as string;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, ...params } = body ?? {};

    if (!action) {
      return NextResponse.json({ error: "Missing action" }, { status: 400 });
    }

    switch (action) {
      // ─── إنشاء جلسة الجهاز للـ Social Login ───
      case "createDeviceToken": {
        const { deviceId } = params;
        if (!deviceId) {
          return NextResponse.json({ error: "Missing deviceId" }, { status: 400 });
        }

        const response = await fetch(`${CIRCLE_BASE_URL}/v1/w3s/users/social/token`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${CIRCLE_API_KEY}`,
          },
          body: JSON.stringify({
            idempotencyKey: crypto.randomUUID(),
            deviceId,
          }),
        });

        const data = await response.json();
        if (!response.ok) return NextResponse.json(data, { status: response.status });
        // Returns: { deviceToken, deviceEncryptionKey }
        return NextResponse.json(data.data, { status: 200 });
      }

      // ─── تهيئة المستخدم وإنشاء المحفظة ───
      case "initializeUser": {
        const { userToken } = params;
        if (!userToken) {
          return NextResponse.json({ error: "Missing userToken" }, { status: 400 });
        }

        const response = await fetch(`${CIRCLE_BASE_URL}/v1/w3s/user/initialize`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${CIRCLE_API_KEY}`,
            "X-User-Token": userToken,
          },
          body: JSON.stringify({
            idempotencyKey: crypto.randomUUID(),
            accountType: "SCA",
            blockchains: ["ARC-TESTNET"],
          }),
        });

        const data = await response.json();
        if (!response.ok) return NextResponse.json(data, { status: response.status });
        // Returns: { challengeId }
        return NextResponse.json(data.data, { status: 200 });
      }

      // ─── جلب قائمة المحافظ ───
      case "listWallets": {
        const { userToken } = params;
        if (!userToken) {
          return NextResponse.json({ error: "Missing userToken" }, { status: 400 });
        }

        const response = await fetch(`${CIRCLE_BASE_URL}/v1/w3s/wallets`, {
          method: "GET",
          headers: {
            accept: "application/json",
            Authorization: `Bearer ${CIRCLE_API_KEY}`,
            "X-User-Token": userToken,
          },
        });

        const data = await response.json();
        if (!response.ok) return NextResponse.json(data, { status: response.status });
        // Returns: { wallets: [...] }
        return NextResponse.json(data.data, { status: 200 });
      }

      // ─── جلب رصيد USDC ───
      case "getTokenBalance": {
        const { userToken, walletId } = params;
        if (!userToken || !walletId) {
          return NextResponse.json({ error: "Missing userToken or walletId" }, { status: 400 });
        }

        const response = await fetch(`${CIRCLE_BASE_URL}/v1/w3s/wallets/${walletId}/balances`, {
          method: "GET",
          headers: {
            accept: "application/json",
            Authorization: `Bearer ${CIRCLE_API_KEY}`,
            "X-User-Token": userToken,
          },
        });

        const data = await response.json();
        if (!response.ok) return NextResponse.json(data, { status: response.status });
        // Returns: { tokenBalances: [...] }
        return NextResponse.json(data.data, { status: 200 });
      }

      // ─── إرسال USDC (تحويل P2P) ───
      case "sendUsdc": {
        const { userToken, walletId, walletAddress, destinationAddress, amount } = params;
        if (!userToken || !destinationAddress || !amount) {
          return NextResponse.json(
            { error: "Missing required fields" },
            { status: 400 }
          );
        }

        // نبني body حسب ما هو متاح — walletId أو walletAddress
        const bodyPayload: any = {
          idempotencyKey: crypto.randomUUID(),
          destinationAddress,
          amounts: [amount.toString()],
          feeLevel: "MEDIUM",
          tokenAddress: "0x3600000000000000000000000000000000000000",
          blockchain: "ARC-TESTNET",
        };

        if (walletId) {
          bodyPayload.walletId = walletId;
        } else if (walletAddress) {
          bodyPayload.walletAddress = walletAddress;
        }

        console.log("Transfer payload:", JSON.stringify(bodyPayload, null, 2));

        const transferResponse = await fetch(
          `${CIRCLE_BASE_URL}/v1/w3s/user/transactions/transfer`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${CIRCLE_API_KEY}`,
              "X-User-Token": userToken,
            },
            body: JSON.stringify(bodyPayload),
          }
        );

        const transferData = await transferResponse.json();
        if (!transferResponse.ok) {
          console.log("Circle error:", JSON.stringify(transferData, null, 2));
          return NextResponse.json(transferData, { status: transferResponse.status });
        }

        // Returns: { challengeId } — المستخدم يحتاج يوقّع
        return NextResponse.json(transferData.data, { status: 200 });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    console.error("Error in /api/endpoints:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}