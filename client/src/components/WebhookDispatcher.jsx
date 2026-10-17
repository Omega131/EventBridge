import { useState, useRef, useEffect } from 'react';
import confetti from 'canvas-confetti';
import {
  Terminal,
  Send,
  Copy,
  Check,
  Code2,
  Sparkles,
  ChevronDown,
  ShieldAlert,
  KeyRound,
  Eye,
  EyeOff,
  Wand2,
  FileCode,
  Flame,
  Lock
} from 'lucide-react';
import { sound } from '../utils/sound';


const PRESETS = [
  {
    id: 'payment',
    label: 'payment.succeeded',
    icon: '💳',
    payload: {
      event: 'payment.succeeded',
      amount: 249.99,
      currency: 'USD',
      customer: {
        id: 'cus_89412',
        email: 'alex.rivers@acme.corp',
        tier: 'enterprise'
      },
      metadata: {
        invoice_id: 'inv_2026_094',
        gateway: 'stripe'
      }
    }
  },
  {
    id: 'order',
    label: 'order.created',
    icon: '📦',
    payload: {
      event: 'order.created',
      order_id: 'ord_9942',
      items: [
        { sku: 'CLD-NODE-8X', qty: 2, price: 89.0 },
        { sku: 'MEM-OPT-32G', qty: 1, price: 71.99 }
      ],
      shipping: 'express_next_day',
      destination: 'Austin, TX'
    }
  },
  {
    id: 'user',
    label: 'user.signup',
    icon: '👤',
    payload: {
      event: 'user.signup',
      user_id: 'usr_m7204',
      email: 'samantha.chen@linear.app',
      plan: 'pro_annual',
      referrer: 'producthunt'
    }
  },
  {
    id: 'invoice_failed',
    label: 'invoice.failed',
    icon: '⚠️',
    payload: {
      event: 'invoice.payment_failed',
      invoice_id: 'inv_8829',
      attempt: 3,
      decline_code: 'insufficient_funds',
      dunning_step: 'final_warning'
    }
  },
  {
    id: 'refund',
    label: 'refund.processed',
    icon: '🔄',
    payload: {
      event: 'refund.processed',
      refund_id: 'ref_3012',
      original_charge: 'ch_882193',
      amount: 49.0,
      reason: 'requested_by_customer'
    }
  }
];

export default function WebhookDispatcher({
  showToast,
  soundEnabled,
  isLoggedIn,
  adminWebhookSecret,
  onRequestLogin
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('dispatcher'); // 'dispatcher' | 'curl' | 'js' | 'python'
  const [selectedPreset, setSelectedPreset] = useState('payment');
  const [jsonText, setJsonText] = useState(() =>
    JSON.stringify(PRESETS[0].payload, null, 2)
  );
  const [secret, setSecret] = useState(adminWebhookSecret || '');
  const [showSecret, setShowSecret] = useState(false);

  useEffect(() => {
    if (isLoggedIn && adminWebhookSecret) {
      setSecret(adminWebhookSecret);
    } else if (!isLoggedIn) {
      setSecret('');
      setShowSecret(false);
    }
  }, [isLoggedIn, adminWebhookSecret]);
  const [customKey, setCustomKey] = useState('');
  const [isSending, setIsSending] = useState(false);
  const isSendingRef = useRef(false);
  const [lastResult, setLastResult] = useState(null);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const webhookUrl = `${origin}/api/webhook`;

  function handleSelectPreset(preset) {
    setSelectedPreset(preset.id);
    setJsonText(JSON.stringify(preset.payload, null, 2));
    sound.playTap(soundEnabled);
  }

  function handlePrettify() {
    try {
      const parsed = JSON.parse(jsonText);
      setJsonText(JSON.stringify(parsed, null, 2));
      sound.playTap(soundEnabled);
      showToast('Formatted JSON payload', 'info');
    } catch {
      showToast('Invalid JSON syntax: cannot format', 'error');
    }
  }

  async function handleCopyWebhookUrl(e) {
    e?.stopPropagation();
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopiedUrl(true);
      sound.playTap(soundEnabled);
      showToast('Copied webhook URL to clipboard', 'info');
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch (err) {
      console.error('Failed to copy URL:', err);
    }
  }

  async function handleCopySnippet(code) {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(true);
      sound.playTap(soundEnabled);
      showToast('Copied code snippet to clipboard', 'info');
      setTimeout(() => setCopiedCode(false), 2000);
    } catch (err) {
      console.error('Failed to copy code snippet:', err);
    }
  }

  async function handleFireWebhook(e) {
    e.preventDefault();
    if (isSendingRef.current || isSending) return;

    let parsedBody;
    try {
      parsedBody = JSON.parse(jsonText);
    } catch {
      showToast('Invalid JSON payload. Please fix syntax errors before sending.', 'error');
      return;
    }

    if (typeof parsedBody !== 'object' || parsedBody === null || Array.isArray(parsedBody)) {
      showToast('Payload must be a valid JSON object.', 'error');
      return;
    }

    if (!isLoggedIn) {
      showToast('Administrator login required to dispatch webhooks with secret verification', 'info');
      onRequestLogin?.();
      return;
    }

    if (!secret.trim()) {
      showToast('Webhook secret is required to dispatch', 'error');
      return;
    }

    isSendingRef.current = true;
    setIsSending(true);
    setLastResult(null);

    const headers = {
      'Content-Type': 'application/json',
      'x-webhook-secret': secret.trim()
    };
    if (customKey.trim()) {
      headers['idempotency-key'] = customKey.trim();
    }

    try {
      const startTime = performance.now();
      const response = await fetch('/api/webhook', {
        method: 'POST',
        headers,
        body: JSON.stringify(parsedBody)
      });
      const duration = Math.round(performance.now() - startTime);
      const data = await response.json();

      if (response.ok && data.success) {
        sound.playSuccess(soundEnabled);
        confetti({
          particleCount: 45,
          spread: 60,
          origin: { y: 0.7 },
          colors: ['#6366f1', '#10b981', '#38bdf8', '#a855f7']
        });

        const statusMsg = data.duplicate
          ? `Duplicate acknowledged (${data.id.slice(0, 8)}...)`
          : `Event ingested (${data.id.slice(0, 8)}...)`;

        setLastResult({
          type: 'success',
          status: response.status,
          id: data.id,
          duplicate: data.duplicate,
          duration,
          message: statusMsg
        });

        showToast(
          data.duplicate
            ? 'Duplicate detected! Updated existing record.'
            : 'Webhook dispatched & streaming in real-time!',
          'success'
        );
      } else {
        setLastResult({
          type: 'error',
          status: response.status,
          message: data.error || data.message || `HTTP ${response.status}`
        });
        showToast(`Webhook rejected (${response.status}): ${data.error || 'Failed'}`, 'error');
      }
    } catch (err) {
      console.error('Dispatcher error:', err);
      setLastResult({
        type: 'error',
        status: 0,
        message: 'Network error reaching backend server'
      });
      showToast('Could not reach backend server on port 3000', 'error');
    } finally {
      isSendingRef.current = false;
      setIsSending(false);
    }
  }

  // Code generator (masks secret for visitors)
  const cleanSecret = (isLoggedIn && secret.trim()) ? secret.trim() : 'YOUR_WEBHOOK_SECRET';
  const curlCode = `curl -X POST ${webhookUrl} \\
  -H "Content-Type: application/json" \\
  -H "x-webhook-secret: ${cleanSecret}" ${customKey ? `\\\n  -H "idempotency-key: ${customKey}" ` : ''}\\
  -d '${JSON.stringify(JSON.parse(jsonText || '{}'))}'`;

  const jsCode = `// Dispatch webhook using standard fetch
const response = await fetch('${webhookUrl}', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-webhook-secret': '${cleanSecret}'${customKey ? `,\n    'idempotency-key': '${customKey}'` : ''}
  },
  body: JSON.stringify(${jsonText})
});

const result = await response.json();
console.log('Ingested Event:', result);`;

  const pythonCode = `import requests

url = "${webhookUrl}"
headers = {
    "Content-Type": "application/json",
    "x-webhook-secret": "${cleanSecret}"${customKey ? `,\n    "idempotency-key": "${customKey}"` : ''}
}
payload = ${jsonText}

response = requests.post(url, headers=headers, json=payload)
print(response.status_code, response.json())`;

  return (
    <section className="webhook-helper-card" aria-label="Webhook Ingestion Studio">
      {/* ─── CARD HEADER (COLLAPSIBLE) ─── */}
      <div
        className="webhook-helper-header"
        onClick={() => setIsOpen((prev) => !prev)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsOpen((prev) => !prev);
          }
        }}
        aria-expanded={isOpen}
      >
        <div className="webhook-helper-title-group">
          <div className="terminal-icon-badge" aria-hidden="true">
            <Terminal size={18} />
          </div>
          <div>
            <div className="helper-card-heading-row">
              <h2 className="helper-card-heading">Webhook Ingestion Studio</h2>
              <span className="badge-studio-pulse">
                <Flame size={12} className="inline mr-1 text-amber-400" />
                Live Dispatcher
              </span>
            </div>
            <p className="helper-card-subheading">
              <span className="http-method-badge">POST</span>
              <code className="endpoint-pill">{webhookUrl}</code>
            </p>
          </div>
        </div>

        <div className="helper-header-actions">
          <button
            type="button"
            className="btn btn-secondary btn-xs btn-copy-endpoint"
            onClick={handleCopyWebhookUrl}
            title="Copy webhook URL"
          >
            {copiedUrl ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
            <span>{copiedUrl ? 'Copied URL' : 'Copy URL'}</span>
          </button>

          <div className={`chevron-wrap ${isOpen ? 'chevron-open' : ''}`}>
            <ChevronDown size={18} />
          </div>
        </div>
      </div>

      {/* ─── CARD BODY ─── */}
      {isOpen && (
        <div className="webhook-helper-body animate-fade-in">
          {/* Subheader Studio Navigation */}
          <div className="studio-tabs-bar">
            <div className="studio-tabs" role="tablist">
              <button
                type="button"
                className={`studio-tab ${activeTab === 'dispatcher' ? 'active' : ''}`}
                onClick={() => setActiveTab('dispatcher')}
              >
                <Sparkles size={14} />
                <span>Live Dispatcher</span>
              </button>
              <button
                type="button"
                className={`studio-tab ${activeTab === 'curl' ? 'active' : ''}`}
                onClick={() => setActiveTab('curl')}
              >
                <Terminal size={14} />
                <span>cURL</span>
              </button>
              <button
                type="button"
                className={`studio-tab ${activeTab === 'js' ? 'active' : ''}`}
                onClick={() => setActiveTab('js')}
              >
                <Code2 size={14} />
                <span>JavaScript</span>
              </button>
              <button
                type="button"
                className={`studio-tab ${activeTab === 'python' ? 'active' : ''}`}
                onClick={() => setActiveTab('python')}
              >
                <FileCode size={14} />
                <span>Python</span>
              </button>
            </div>

            {activeTab !== 'dispatcher' && (
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                onClick={() =>
                  handleCopySnippet(
                    activeTab === 'curl' ? curlCode : activeTab === 'js' ? jsCode : pythonCode
                  )
                }
              >
                {copiedCode ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                <span>{copiedCode ? 'Copied!' : 'Copy Code'}</span>
              </button>
            )}
          </div>

          {/* TAB 1: LIVE DISPATCHER */}
          {activeTab === 'dispatcher' && (
            <div className="dispatcher-container">
              {/* Presets Bar */}
              <div className="dispatcher-presets-bar">
                <span className="presets-label">Preset Events:</span>
                <div className="presets-list">
                  {PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className={`preset-btn ${selectedPreset === preset.id ? 'active' : ''}`}
                      onClick={() => handleSelectPreset(preset)}
                    >
                      <span className="preset-icon">{preset.icon}</span>
                      <span className="preset-name">{preset.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Payload Editor + Configuration Grid */}
              <div className="dispatcher-grid">
                {/* Left: JSON Editor */}
                <div className="dispatcher-editor-col">
                  <div className="editor-top-bar">
                    <span className="editor-title">JSON Webhook Payload</span>
                    <button
                      type="button"
                      className="btn-link-action"
                      onClick={handlePrettify}
                      title="Format and validate JSON"
                    >
                      <Wand2 size={12} />
                      <span>Format JSON</span>
                    </button>
                  </div>
                  <textarea
                    className="payload-textarea font-mono"
                    value={jsonText}
                    onChange={(e) => setJsonText(e.target.value)}
                    rows={8}
                    spellCheck="false"
                    placeholder="Enter JSON object payload..."
                  />
                </div>

                {/* Right: Security & Headers Config */}
                <div className="dispatcher-config-col">
                  {/* Secret Input - Only visible & customizable for Admin */}
                  <div className="config-field">
                    <div className="config-label-row">
                      <label htmlFor="secret-input" className="config-label">
                        <KeyRound size={13} />
                        <span>Webhook Secret (x-webhook-secret)</span>
                      </label>
                      {isLoggedIn ? (
                        <button
                          type="button"
                          className="btn-toggle-secret"
                          onClick={() => setShowSecret((p) => !p)}
                          title={showSecret ? 'Hide secret' : 'Show secret'}
                        >
                          {showSecret ? <EyeOff size={13} /> : <Eye size={13} />}
                        </button>
                      ) : (
                        <span className="badge-admin-locked" title="Admin authentication required to view/edit secret">
                          <Lock size={11} />
                          <span>Admin Only</span>
                        </span>
                      )}
                    </div>
                    <div className="input-with-action">
                      <input
                        id="secret-input"
                        type={isLoggedIn && showSecret ? 'text' : 'password'}
                        className={`form-input font-mono input-sm ${!isLoggedIn ? 'input-locked' : ''}`}
                        value={isLoggedIn ? secret : ''}
                        onChange={(e) => {
                          if (isLoggedIn) setSecret(e.target.value);
                        }}
                        readOnly={!isLoggedIn}
                        disabled={!isLoggedIn}
                        placeholder={isLoggedIn ? 'Enter webhook secret...' : 'Secret protected • Admin access required'}
                      />
                    </div>
                    <span className="field-hint">
                      {isLoggedIn
                        ? 'Loaded securely from server session. Verified server-side via timingSafeEqual.'
                        : 'Secret is never loaded into browser memory for public visitors. Sign in as admin to view.'}
                    </span>
                  </div>

                  {/* Optional Custom Idempotency Key */}
                  <div className="config-field">
                    <label htmlFor="idempotency-input" className="config-label">
                      <span>Idempotency Key (Optional Header)</span>
                    </label>
                    <input
                      id="idempotency-input"
                      type="text"
                      className="form-input font-mono input-sm"
                      value={customKey}
                      onChange={(e) => setCustomKey(e.target.value)}
                      placeholder="e.g. ord_test_uuid_99 (or leave blank to hash body)"
                    />
                    <span className="field-hint">
                      Leave empty to auto-generate SHA-256 fingerprint from body.
                    </span>
                  </div>

                  {/* Dispatch Action Button & Result Feedback */}
                  <div className="dispatcher-action-box">
                    <button
                      type="button"
                      className={`btn btn-primary btn-dispatch-fire ${isSending ? 'loading' : ''}`}
                      onClick={handleFireWebhook}
                      disabled={isSending}
                    >
                      {isSending ? (
                        <>
                          <div className="spinner-sm" aria-hidden="true" />
                          <span>Streaming Ingestion...</span>
                        </>
                      ) : !isLoggedIn ? (
                        <>
                          <Lock size={14} />
                          <span>Sign in as Admin to Dispatch</span>
                        </>
                      ) : (
                        <>
                          <Send size={15} />
                          <span>Dispatch Live Webhook</span>
                        </>
                      )}
                    </button>

                    {lastResult && (
                      <div
                        className={`dispatch-result-badge ${
                          lastResult.type === 'success' ? 'result-success' : 'result-error'
                        } animate-fade-in`}
                      >
                        <span className="result-dot" />
                        <span className="result-text">{lastResult.message}</span>
                        {lastResult.duration && (
                          <span className="result-latency font-mono">
                            {lastResult.duration}ms
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: CURL SNIPPET */}
          {activeTab === 'curl' && (
            <div className="snippet-container animate-fade-in">
              <pre className="curl-code font-mono">{curlCode}</pre>
            </div>
          )}

          {/* TAB 3: JAVASCRIPT SNIPPET */}
          {activeTab === 'js' && (
            <div className="snippet-container animate-fade-in">
              <pre className="curl-code font-mono">{jsCode}</pre>
            </div>
          )}

          {/* TAB 4: PYTHON SNIPPET */}
          {activeTab === 'python' && (
            <div className="snippet-container animate-fade-in">
              <pre className="curl-code font-mono">{pythonCode}</pre>
            </div>
          )}

          {/* Helper Footer Notice */}
          <div className="webhook-notice">
            <ShieldAlert size={15} className="flex-shrink-0 text-indigo-400" />
            <span>
              The <code>x-webhook-secret</code> header is verified in constant time. Ingested events
              are written to the database with status <code>Received</code> and streamed live via
              Server-Sent Events (SSE).
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
