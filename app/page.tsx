"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { setCookie, getCookie } from "cookies-next";
import { SocialLoginProvider } from "@circle-fin/w3s-pw-web-sdk/dist/src/types";
import type { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";

const appId = process.env.NEXT_PUBLIC_CIRCLE_APP_ID as string;
const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID as string;
const redirectUri = process.env.NEXT_PUBLIC_APP_URL || "https://hawala-x-theta.vercel.app";

type LoginResult = { userToken: string; encryptionKey: string };
type Wallet = { id: string; address: string; blockchain: string; [k: string]: unknown };
type StatusType = "idle" | "loading" | "success" | "error";
type Tab = "send" | "receive" | "history";
type TxItem = { type: "send" | "receive"; addr: string; amount: string; date: string };

type AppState =
  | "init"
  | "needDeviceToken"
  | "needLogin"
  | "loggedIn"
  | "needChallenge"
  | "ready";

export default function HomePage() {
  const sdkRef = useRef<W3SSdk | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [deviceId, setDeviceId] = useState("");
  const [deviceToken, setDeviceToken] = useState("");
  const [deviceEncryptionKey, setDeviceEncryptionKey] = useState("");
  const [loginResult, setLoginResult] = useState<LoginResult | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [usdcBalance, setUsdcBalance] = useState<string>("0.00");
  const [appState, setAppState] = useState<AppState>("init");
  const [status, setStatus] = useState("");
  const [statusType, setStatusType] = useState<StatusType>("idle");
  const [activeTab, setActiveTab] = useState<Tab>("send");
  const [sendAddr, setSendAddr] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [txHistory, setTxHistory] = useState<TxItem[]>([]);
  const [copied, setCopied] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const setStatusMsg = (msg: string, type: StatusType = "idle") => {
    setStatus(msg);
    setStatusType(type);
  };

  // ─── تهيئة SDK ───
  useEffect(() => {
    let cancelled = false;

    const initSdk = async () => {
      try {
        const { W3SSdk } = await import("@circle-fin/w3s-pw-web-sdk");

        const onLoginComplete = (error: unknown, result: any) => {
          if (cancelled) return;
          if (error) {
            console.error("Login error:", JSON.stringify(error));
            setStatusMsg("فشل تسجيل الدخول. حاول مرة أخرى.", "error");
            return;
          }
          if (!result?.userToken) {
            setStatusMsg("فشل: لا يوجد userToken في النتيجة.", "error");
            return;
          }
          setLoginResult({ userToken: result.userToken, encryptionKey: result.encryptionKey });
          setAppState("loggedIn");
          setStatusMsg("تم تسجيل الدخول بنجاح ✓", "success");
        };

        // نستخدم env أولاً ثم cookies كاحتياط
        const activeAppId = appId || (getCookie("appId") as string) || "";
        const activeGoogleClientId = googleClientId || (getCookie("google.clientId") as string) || "";
        const activeDeviceToken = (getCookie("deviceToken") as string) || "";
        const activeDeviceEncryptionKey = (getCookie("deviceEncryptionKey") as string) || "";
        const origin = typeof window !== "undefined" ? window.location.origin : "";

        const sdk = new W3SSdk(
          {
            appSettings: { appId: activeAppId },
            loginConfigs: {
              deviceToken: activeDeviceToken,
              deviceEncryptionKey: activeDeviceEncryptionKey,
              google: {
                clientId: activeGoogleClientId,
                redirectUri: origin,
                selectAccountPrompt: true,
              },
            },
          },
          onLoginComplete
        );

        sdkRef.current = sdk;

        if (!cancelled) {
          setSdkReady(true);
          setAppState("needDeviceToken");
          setStatusMsg("جاهز. ابدأ بإنشاء جلسة الجهاز.", "idle");
        }
      } catch (e) {
        console.error("SDK init error:", e);
        if (!cancelled) setStatusMsg("فشل تهيئة SDK", "error");
      }
    };

    void initSdk();
    return () => { cancelled = true; };
  }, []);

  // ─── جلب deviceId ───
  useEffect(() => {
    const fetchDeviceId = async () => {
      if (!sdkRef.current) return;
      try {
        const cached = window.localStorage.getItem("deviceId");
        if (cached) { setDeviceId(cached); return; }
        const id = await sdkRef.current.getDeviceId();
        setDeviceId(id);
        window.localStorage.setItem("deviceId", id);
      } catch {
        setStatusMsg("فشل جلب معرّف الجهاز", "error");
      }
    };
    if (sdkReady) void fetchDeviceId();
  }, [sdkReady]);

  // ─── تحميل رصيد USDC ───
  const loadBalance = useCallback(async (userToken: string, walletId: string) => {
    const res = await fetch("/api/endpoints", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "getTokenBalance", userToken, walletId }),
    });
    const data = await res.json();
    if (!res.ok) return;
    const balances = (data.tokenBalances as any[]) || [];
    const usdc = balances.find(t => t.token?.symbol?.startsWith("USDC") || t.token?.name?.includes("USDC"));
    setUsdcBalance(usdc?.amount ?? "0.00");
  }, []);

  // ─── تحميل المحافظ ───
  const loadWallets = useCallback(async (userToken: string) => {
    setStatusMsg("جاري تحميل المحفظة...", "loading");
    const res = await fetch("/api/endpoints", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "listWallets", userToken }),
    });
    const data = await res.json();
    if (!res.ok) { setStatusMsg("فشل تحميل المحفظة", "error"); return; }
    const ws = (data.wallets as Wallet[]) || [];
    setWallets(ws);
    if (ws.length > 0) {
      await loadBalance(userToken, ws[0].id);
      setAppState("ready");
      setStatusMsg("المحفظة جاهزة ✓", "success");
    }
  }, [loadBalance]);

  // ─── الخطوة 1: إنشاء device token ───
  const handleCreateDeviceToken = async () => {
    if (!deviceId) return;
    setStatusMsg("جاري إنشاء جلسة الجهاز...", "loading");
    const res = await fetch("/api/endpoints", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "createDeviceToken", deviceId }),
    });
    const data = await res.json();
    if (!res.ok) { setStatusMsg("فشل إنشاء جلسة الجهاز", "error"); return; }

    setDeviceToken(data.deviceToken);
    setDeviceEncryptionKey(data.deviceEncryptionKey);
    setCookie("deviceToken", data.deviceToken);
    setCookie("deviceEncryptionKey", data.deviceEncryptionKey);

    // تحديث SDK بالـ token الجديد
    sdkRef.current?.updateConfigs({
      appSettings: { appId },
      loginConfigs: {
        deviceToken: data.deviceToken,
        deviceEncryptionKey: data.deviceEncryptionKey,
        google: {
          clientId: googleClientId,
          redirectUri: redirectUri,
          selectAccountPrompt: true,
        },
      },
    });

    setAppState("needLogin");
    setStatusMsg("تم إنشاء جلسة الجهاز. سجّل دخولك.", "success");
  };

  // ─── الخطوة 2: تسجيل الدخول بـ Google ───
  const handleLoginWithGoogle = () => {
    const sdk = sdkRef.current;
    if (!sdk || !deviceToken) return;
    setCookie("appId", appId);
    setCookie("google.clientId", googleClientId);
    setCookie("deviceToken", deviceToken);
    setCookie("deviceEncryptionKey", deviceEncryptionKey);

    sdk.updateConfigs({
      appSettings: { appId },
      loginConfigs: {
        deviceToken,
        deviceEncryptionKey,
        google: {
          clientId: googleClientId,
          redirectUri: redirectUri,
          selectAccountPrompt: true,
        },
      },
    });
    setStatusMsg("جاري التوجيه إلى Google...", "loading");
    sdk.performLogin(SocialLoginProvider.GOOGLE);
  };

  // ─── الخطوة 3: تهيئة المستخدم ───
  const handleInitializeUser = async () => {
    if (!loginResult?.userToken) return;
    setStatusMsg("جاري تهيئة المستخدم...", "loading");

    const res = await fetch("/api/endpoints", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "initializeUser", userToken: loginResult.userToken }),
    });
    const data = await res.json();

    if (!res.ok) {
      if (data.code === 155106) {
        await loadWallets(loginResult.userToken);
        return;
      }
      setStatusMsg("فشل تهيئة المستخدم: " + (data.error || data.message), "error");
      return;
    }
    setChallengeId(data.challengeId);
    setAppState("needChallenge");
    setStatusMsg("تم. الآن أنشئ محفظتك.", "success");
  };

  // ─── الخطوة 4: تنفيذ challenge لإنشاء المحفظة ───
  const handleExecuteChallenge = () => {
    const sdk = sdkRef.current;
    if (!sdk || !challengeId || !loginResult) return;

    sdk.setAuthentication({ userToken: loginResult.userToken, encryptionKey: loginResult.encryptionKey });
    setStatusMsg("جاري إنشاء المحفظة...", "loading");

    sdk.execute(challengeId, (error) => {
      if (error) {
        setStatusMsg("فشل إنشاء المحفظة: " + ((error as any)?.message ?? ""), "error");
        return;
      }
      setChallengeId(null);
      setStatusMsg("تم إنشاء المحفظة! ⏳ جاري التحميل...", "loading");
      setTimeout(async () => {
        await loadWallets(loginResult.userToken);
      }, 2000);
    });
  };

  // ─── إرسال USDC ───
  const handleSend = async () => {
    if (!loginResult || !wallets[0] || !sendAddr || !sendAmount) return;
    if (parseFloat(sendAmount) <= 0) { showToast("أدخل مبلغاً صحيحاً"); return; }
    if (parseFloat(sendAmount) > parseFloat(usdcBalance)) { showToast("الرصيد غير كافٍ"); return; }

    setIsSending(true);
    setStatusMsg("جاري إرسال " + sendAmount + " USDC...", "loading");

    const res = await fetch("/api/endpoints", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "sendUsdc",
        userToken: loginResult.userToken,
        walletId: wallets[0].id || "",
        walletAddress: wallets[0].address || "",
        destinationAddress: sendAddr,
        amount: sendAmount,
      }),
    });
    const data = await res.json();

    if (!res.ok) {
      setStatusMsg("فشل الإرسال: " + (data.error || data.message), "error");
      setIsSending(false);
      return;
    }

    const sdk = sdkRef.current;
    if (!sdk || !data.challengeId) { setIsSending(false); return; }

    sdk.setAuthentication({ userToken: loginResult.userToken, encryptionKey: loginResult.encryptionKey });
    sdk.execute(data.challengeId, async (error) => {
      if (error) {
        setStatusMsg("فشل التوقيع: " + ((error as any)?.message ?? ""), "error");
        setIsSending(false);
        return;
      }
      setTxHistory(prev => [{
        type: "send",
        addr: sendAddr,
        amount: sendAmount,
        date: new Date().toLocaleDateString("ar-EG"),
      }, ...prev]);
      setSendAddr("");
      setSendAmount("");
      showToast("✓ تم الإرسال بنجاح!");
      setStatusMsg("تم الإرسال بنجاح ✓", "success");
      setIsSending(false);
      setTimeout(() => loadBalance(loginResult!.userToken, wallets[0].id), 3000);
    });
  };

  // ─── نسخ العنوان ───
  const copyAddress = () => {
    if (!wallets[0]) return;
    navigator.clipboard.writeText(wallets[0].address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    showToast("تم نسخ العنوان ✓");
  };

  const step = appState === "init" ? 0
    : appState === "needDeviceToken" ? 0
    : appState === "needLogin" ? 1
    : appState === "loggedIn" ? 2
    : appState === "needChallenge" ? 3
    : 4;

  const primaryWallet = wallets[0];

  return (
    <div className="app-shell">
      <header className="header">
        <div className="logo">
          <div className="logo-mark">H</div>
          <span className="logo-text">Hawala<span>X</span></span>
        </div>
        <span className="header-badge">Arc Testnet</span>
      </header>

      <main className="main">
        {appState !== "ready" && (
          <>
            <div className="steps">
              {[0, 1, 2, 3].map(i => (
                <div
                  key={i}
                  className={`step-dot ${i < step ? "done" : i === step ? "active" : ""}`}
                />
              ))}
            </div>

            <div className="card">
              <p className="card-label">إعداد المحفظة</p>

              <button
                className="btn btn-outline"
                onClick={handleCreateDeviceToken}
                disabled={!sdkReady || !deviceId || appState !== "needDeviceToken"}
              >
                {statusType === "loading" && appState === "needDeviceToken"
                  ? <><div className="spinner" /> جاري التحضير...</>
                  : "① إنشاء جلسة الجهاز"}
              </button>

              <button
                className="btn btn-google"
                onClick={handleLoginWithGoogle}
                disabled={appState !== "needLogin"}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                ② تسجيل الدخول بـ Google
              </button>

              <button
                className="btn btn-outline"
                onClick={handleInitializeUser}
                disabled={appState !== "loggedIn"}
              >
                ③ تهيئة المستخدم
              </button>

              <button
                className="btn btn-primary"
                onClick={handleExecuteChallenge}
                disabled={appState !== "needChallenge"}
              >
                {statusType === "loading" && appState === "needChallenge"
                  ? <><div className="spinner" /> جاري الإنشاء...</>
                  : "④ إنشاء المحفظة"}
              </button>
            </div>

            {status && (
              <div className="status-bar">
                <div className={`status-dot ${statusType}`} />
                <span>{status}</span>
              </div>
            )}
          </>
        )}

        {appState === "ready" && primaryWallet && (
          <>
            <div className="balance-card">
              <p className="balance-label">رصيدك الحالي</p>
              <div className="balance-amount">
                {parseFloat(usdcBalance).toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </div>
              <div className="balance-currency">
                <div className="usdc-dot" />
                USDC على Arc Testnet
              </div>
              <div className="wallet-address" onClick={copyAddress}>
                <span className="addr-text">{primaryWallet.address}</span>
                <span className="copy-icon">{copied ? "✓" : "⎘"}</span>
              </div>
            </div>

            <div className="tabs">
              <button className={`tab ${activeTab === "send" ? "active" : ""}`} onClick={() => setActiveTab("send")}>إرسال</button>
              <button className={`tab ${activeTab === "receive" ? "active" : ""}`} onClick={() => setActiveTab("receive")}>استقبال</button>
              <button className={`tab ${activeTab === "history" ? "active" : ""}`} onClick={() => setActiveTab("history")}>السجل</button>
            </div>

            {activeTab === "send" && (
              <div className="card">
                <p className="card-label">إرسال USDC</p>
                <div className="input-group">
                  <label className="input-label">عنوان المستلم</label>
                  <input className="input input-mono" placeholder="0x..." value={sendAddr} onChange={e => setSendAddr(e.target.value)} />
                </div>
                <div className="input-group">
                  <label className="input-label">المبلغ</label>
                  <div className="amount-wrapper">
                    <span className="amount-currency">USDC</span>
                    <input className="input" type="number" placeholder="0.00" min="0.01" step="0.01" value={sendAmount} onChange={e => setSendAmount(e.target.value)} />
                  </div>
                </div>
                <button className="btn btn-primary" onClick={handleSend} disabled={isSending || !sendAddr || !sendAmount}>
                  {isSending ? <><div className="spinner" /> جاري الإرسال...</> : `إرسال ${sendAmount || "0"} USDC`}
                </button>
                {status && (
                  <div className="status-bar" style={{ marginTop: 12, marginBottom: 0 }}>
                    <div className={`status-dot ${statusType}`} />
                    <span>{status}</span>
                  </div>
                )}
              </div>
            )}

            {activeTab === "receive" && (
              <div className="card">
                <p className="card-label">استقبال USDC</p>
                <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16, lineHeight: 1.7 }}>
                  شارك عنوانك مع المُرسل لاستقبال USDC على Arc Testnet.
                </p>
                <div className="input-group">
                  <label className="input-label">عنوان محفظتك</label>
                  <div className="wallet-address" onClick={copyAddress} style={{ marginTop: 0 }}>
                    <span className="addr-text">{primaryWallet.address}</span>
                    <span className="copy-icon">{copied ? "✓" : "⎘"}</span>
                  </div>
                </div>
                <div className="divider">أو</div>
                <p style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center" }}>
                  احصل على USDC تجريبي مجاناً من{" "}
                  <a href="https://faucet.circle.com" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", textDecoration: "none" }}>
                    faucet.circle.com
                  </a>
                  {" → اختر Arc Testnet"}
                </p>
                <button className="btn btn-outline" style={{ marginTop: 16 }} onClick={() => window.open("https://faucet.circle.com", "_blank")}>
                  فتح الـ Faucet ↗
                </button>
              </div>
            )}

            {activeTab === "history" && (
              <div className="card">
                <p className="card-label">سجل المعاملات</p>
                {txHistory.length === 0 ? (
                  <div className="empty">
                    <div className="empty-icon">📭</div>
                    لا توجد معاملات بعد
                  </div>
                ) : (
                  txHistory.map((tx, i) => (
                    <div className="tx-item" key={i}>
                      <div className={`tx-icon ${tx.type}`}>{tx.type === "send" ? "↑" : "↓"}</div>
                      <div className="tx-info">
                        <div className="tx-label">{tx.type === "send" ? "إرسال" : "استقبال"}</div>
                        <div className="tx-addr">{tx.addr.slice(0, 6)}...{tx.addr.slice(-4)}</div>
                      </div>
                      <div className={`tx-amount ${tx.type}`}>
                        {tx.type === "send" ? "-" : "+"}{tx.amount} USDC
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        )}
      </main>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}