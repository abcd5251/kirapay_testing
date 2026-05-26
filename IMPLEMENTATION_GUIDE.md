# KiraPay Integration — Implementation Guide

> This guide is written based on direct study of two live KiraPay reference
> implementations: **Kira Demo Website** (Next.js backend + webhooks) and
> **Kira POS** (React SPA + client polling). Use it to understand the full
> KiraPay flow and apply the changes needed in your own codebase.

---

## How KiraPay Works (The Full Picture)

```
Your server                    KiraPay                       Customer
    │                              │                              │
    │── POST /link/generate ──────>│                              │
    │<── { data: { url } } ────────│                              │
    │                              │                              │
    │   send checkout URL ─────────────────────────────────────>  │
    │                              │<── customer pays ────────────│
    │                              │                              │
    │<── POST webhook ─────────────│                              │
    │    (x-kirapay-signature)     │                              │
    │── 200 OK ───────────────────>│                              │
```

**Two ways to detect payment:**

| Method | Used by | When to use |
|--------|---------|-------------|
| **Webhooks** (push) | Kira Demo Website | Backend servers — KiraPay calls your endpoint |
| **Polling** (pull) | Kira POS | Frontend apps — you poll `/link/{code}/availability` |

Your system uses **webhooks** — KiraPay POSTs to your server when a payment succeeds.

---

## Part 1 — Creating a Payment Link

### API call

```
POST https://api.kira-pay.com/api/link/generate
Header: x-api-key: YOUR_KIRAPAY_API_KEY
```

### Request payload

```json
{
  "receiver": "0xYOUR_WALLET_ADDRESS",
  "originalPrice": 10.00,
  "fiatCurrency": "USD",
  "isViewAsCrypto": false,
  "name": "Payment for Pro Plan",
  "customOrderId": "your-unique-session-uuid",
  "redirectUrl": "https://your-app.com/payment/success",
  "type": "single_use",
  "tokenOut": {
    "chainId": "8453",
    "address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
  }
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `receiver` | Yes | Your blockchain wallet address. Set as `KIRAPAY_RECEIVER_ADDRESS` env var |
| `originalPrice` | Yes | Amount in USD |
| `fiatCurrency` | Yes | Always `"USD"` |
| `isViewAsCrypto` | Yes | `false` shows USD price to customer |
| `name` | Yes | Human-readable label (shown on checkout page) |
| `customOrderId` | Yes | **Your unique ID** — this is how you match the webhook back to the user. Use a UUID |
| `redirectUrl` | No | Where KiraPay redirects the customer after payment |
| `type` | Yes | Always `"single_use"` — each link can only be paid once |
| `tokenOut.chainId` | Yes | Blockchain network. `"8453"` = Base, `"56"` = BSC |
| `tokenOut.address` | Yes | Token contract address. See token reference below |

### Token reference

| Network | chainId | Token | Address |
|---------|---------|-------|---------|
| Base | `8453` | USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| BSC | `56` | USDT | `0x55d398326f99059fF775485246999027B3197955` |

### Response

```json
{
  "message": "success",
  "data": {
    "url": "https://checkout.kira-pay.com/fkuprxt43w"
  },
  "code": 201
}
```

The `data.url` is the checkout page you send to the customer (or render as a QR code).
The short code at the end (`fkuprxt43w`) is the **link identifier** — store this
alongside the `customOrderId` in your database so you can look up the link later.

---

## Part 2 — Webhook Handler

When the customer pays, KiraPay POSTs a signed webhook to your endpoint.

### Webhook event types

| Event | Meaning | Action |
|-------|---------|--------|
| `transaction.succeeded` | Payment confirmed ✅ | Fulfil the order / add credits |
| `transaction.created` | Transaction started | Optional — payment not final yet |
| `transaction.failed` | Payment failed | Optional — notify user |
| `transaction.refund` | Refund processed | Optional — remove credits |

### Webhook payload structure

```json
{
  "type": "transaction.succeeded",
  "data": {
    "transactionId": "txn_abc123",
    "customOrderId": "your-unique-session-uuid",
    "amount": 10.00,
    "settlementAmount": 9.85
  }
}
```

The `data.customOrderId` matches the `customOrderId` you sent when creating the
link — this is how you identify **which user paid**.

### Signature verification

KiraPay signs every webhook with HMAC-SHA256 using your `KIRAPAY_WEBHOOK_SECRET`.

**Headers sent by KiraPay:**
```
x-kirapay-signature: sha256=<base64-encoded-hmac>
x-kirapay-timestamp: 1716000000   (optional — unix timestamp)
```

**How to verify (exact logic from Kira Demo Website):**

```typescript
import crypto from 'crypto'

const WEBHOOK_SECRET = process.env.KIRAPAY_WEBHOOK_SECRET!
const TIMESTAMP_TOLERANCE_SECONDS = 5 * 60   // 5 minutes

function verifyWebhookSignature(
  rawBody: string,        // req body as raw text (before JSON.parse)
  signature: string,      // x-kirapay-signature header value
  timestamp?: string      // x-kirapay-timestamp header value (optional)
): boolean {
  if (!WEBHOOK_SECRET || !signature) return false

  // Header format is "sha256=<base64>" — strip the prefix
  const received = signature.startsWith('sha256=') ? signature.slice(7) : signature

  // Replay attack protection — reject stale timestamps
  if (timestamp) {
    const tsRaw = Number(timestamp)
    if (!Number.isFinite(tsRaw)) return false

    // Handles both milliseconds and seconds
    const tsSeconds = tsRaw > 1e12 ? Math.floor(tsRaw / 1000) : Math.floor(tsRaw)
    const now = Math.floor(Date.now() / 1000)
    if (Math.abs(now - tsSeconds) > TIMESTAMP_TOLERANCE_SECONDS) return false
  }

  // Message is "timestamp.rawBody" if timestamp is present, else just rawBody
  const message = timestamp ? `${timestamp}.${rawBody}` : rawBody
  const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(message).digest('base64')

  // Timing-safe comparison — prevents timing attacks
  const a = Buffer.from(received)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}
```

**Critical:** You must read the request body as raw text **before** `JSON.parse`.
The HMAC is computed over the exact bytes KiraPay sent. Parsing and re-serialising
the JSON will break the signature.

### Minimal webhook handler example

```typescript
app.post('/webhooks/kirapay', async (req, res) => {
  const rawBody = await getRawBody(req)   // raw text, not parsed
  const signature = req.headers['x-kirapay-signature']
  const timestamp = req.headers['x-kirapay-timestamp']

  if (!verifyWebhookSignature(rawBody, signature, timestamp)) {
    return res.status(401).json({ error: 'Invalid signature' })
  }

  const event = JSON.parse(rawBody)
  const { type, data } = event

  if (type === 'transaction.succeeded') {
    const { customOrderId, amount } = data

    // customOrderId is the UUID you set when creating the link
    // Use it to find the matching invoice/order in your database
    await markOrderAsPaid(customOrderId, amount)
  }

  return res.status(200).json({ received: true })
})
```

---

## Part 3 — Changes Required in Your Codebase

Your existing code already creates payment sessions and processes webhooks.
The webhook endpoint is currently unsecured (no signature check). These are
the exact changes needed to add signature verification and duplicate protection.

---

### Change 1 — Add `KIRAPAY_WEBHOOK_SECRET` to config

In `src/config/index.ts`, add one line inside the Valibot schema where the
other KiraPay variables are declared:

```typescript
// BEFORE
kirapayApiKey: v.optional(v.string()),
kirapayApiBaseUrl: v.optional(v.string()),
kirapayCheckoutBaseUrl: v.optional(v.string()),
kirapayReceiverAddress: v.string(),

// AFTER
kirapayApiKey: v.optional(v.string()),
kirapayApiBaseUrl: v.optional(v.string()),
kirapayCheckoutBaseUrl: v.optional(v.string()),
kirapayReceiverAddress: v.string(),
kirapayWebhookSecret: v.optional(v.string()),
```

---

### Change 2 — Update the secret resolver in `kirapay.webhook.ts`

In `src/services/payments/kirapay.webhook.ts` at **line 29**, update so the
dedicated webhook secret is checked first:

```typescript
// BEFORE
const secret = config.sessionSecret || config.jwt.secret

// AFTER
const secret = config.kirapayWebhookSecret || config.sessionSecret || config.jwt.secret
```

---

### Change 3 — Run the database migration

This creates the `webhook_idempotency_log` table that prevents a webhook retry
from crediting the same user twice:

```bash
# Using psql
psql $DATABASE_URL < src/migrations/create_webhook_idempotency_log.sql

# Or paste the SQL file contents into your DB admin panel
```

---

### Change 4 — Wire the secured handler into the webhook route

In `src/routes/payments.route.ts`, make two edits.

**Add the import** (with the other imports at the top):

```typescript
import { handleSecuredKiraPayWebhook } from '@/services/payments/kirapay.secured-webhook'
```

**Replace the webhook handler** (currently around line 46):

```typescript
// BEFORE
route.post('/webhooks/kirapay', async (c) => {
  const rawBody = await c.req.text()
  const result = await handleKiraPayWebhook(c, rawBody)
  return c.json({ code: httpStatus.OK, data: result, message: 'Webhook processed' })
})

// AFTER
route.post('/webhooks/kirapay', async (c) => {
  const result = await handleSecuredKiraPayWebhook(c)
  return c.json({ code: httpStatus.OK, data: result, message: 'Webhook processed' })
})
```

Remove `handleKiraPayWebhook` from the service import on line 3 if it is no
longer needed elsewhere:

```typescript
// BEFORE
import { handleKiraPayRedirectCallback, handleKiraPayWebhook } from '../services/payments.service'

// AFTER
import { handleKiraPayRedirectCallback } from '../services/payments.service'
```

---

### Change 5 — Add the env variable

In your `.env` and production environment:

```env
KIRAPAY_WEBHOOK_SECRET='the-secret-from-your-kirapay-dashboard'
```

> Contact KiraPay to get the webhook signing secret for your account, or
> configure one in their dashboard. This value must match **exactly** on both
> sides — your server and KiraPay's system.

---

## Part 4 — Testing

### Test 1: Confirm a valid webhook is accepted

```bash
PAYLOAD='{"type":"transaction.succeeded","data":{"customOrderId":"your-test-uuid","amount":10}}'
SECRET="your-kirapay-webhook-secret"

SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" -binary | base64)

curl -X POST https://your-api.com/api/v1/payments/webhooks/kirapay \
  -H "Content-Type: application/json" \
  -H "x-kirapay-signature: sha256=$SIGNATURE" \
  -d "$PAYLOAD"
```

Expected: `200 OK`

### Test 2: Confirm a bad signature is rejected

```bash
curl -X POST https://your-api.com/api/v1/payments/webhooks/kirapay \
  -H "Content-Type: application/json" \
  -H "x-kirapay-signature: sha256=thisiswrong" \
  -d "$PAYLOAD"
```

Expected: `401 Unauthorized`

### Test 3: Confirm idempotency (send same webhook twice)

Send the exact same valid request twice. The second response should contain
`"cached": true` — meaning the duplicate was detected and not processed again.

---

## Checklist

- [ ] `KIRAPAY_WEBHOOK_SECRET` added to `.env` and production environment
- [ ] `kirapayWebhookSecret` field added to `src/config/index.ts`
- [ ] Secret line updated in `src/services/payments/kirapay.webhook.ts` (Change 2)
- [ ] Migration SQL executed — `webhook_idempotency_log` table confirmed in DB
- [ ] Import added in `src/routes/payments.route.ts`
- [ ] Webhook handler replaced in `src/routes/payments.route.ts`
- [ ] Webhook signing secret confirmed with KiraPay (same value both sides)
- [ ] Test 1 passes: valid webhook → `200 OK`
- [ ] Test 2 passes: bad signature → `401 Unauthorized`
- [ ] Test 3 passes: duplicate webhook → `"cached": true`

---

## Environment Variables Reference

| Variable | Required | Example | Description |
|----------|----------|---------|-------------|
| `KIRAPAY_API_KEY` | Yes | `kp_abc123...` | Your KiraPay API key |
| `KIRAPAY_API_BASE_URL` | Yes | `https://api.kira-pay.com/api` | KiraPay API base URL |
| `KIRAPAY_CHECKOUT_BASE_URL` | Yes | `https://checkout.kira-pay.com` | KiraPay checkout base URL |
| `KIRAPAY_RECEIVER_ADDRESS` | Yes | `0xYourWallet...` | Wallet address to receive payments |
| `KIRAPAY_WEBHOOK_SECRET` | Yes | `your-secret` | Shared secret for webhook signature verification |

---

## Appendix — How Kira POS Handles Payment Without Webhooks

For frontend-only apps where you cannot receive webhooks, KiraPay offers a
polling approach. This is how **Kira POS** works:

```typescript
// 1. Create payment link (same API call as above)
const { url, code } = await generatePaymentLink(amountUSD)

// 2. Show QR code of `url` to the customer

// 3. Poll every 3 seconds until paid or expired
const poll = setInterval(async () => {
  const res = await fetch(`https://api.kira-pay.com/api/link/${code}/availability`, {
    headers: { 'x-api-key': API_KEY }
  })
  const { status } = await res.json()
  // status values: "active" | "used" | "expired"

  if (status === 'used') {
    clearInterval(poll)
    // Payment confirmed — fetch transaction details
    const tx = await getLastTransaction()
    showSuccess(tx)
  }

  if (status === 'expired') {
    clearInterval(poll)
    showExpired()
  }
}, 3000)
```

**Important:** After payment, `GET /link/{code}` returns **400 "Link already used"**.
Always use `GET /wallet/transactions?page=1&limit=1` to get the transaction details.

This approach is suitable only for attended kiosk/POS terminals where the
browser stays open. For server-to-server flows, use webhooks.
