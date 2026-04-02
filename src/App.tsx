import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useMemo, useState } from 'react'

type PaymentStatus = 'pending' | 'success' | 'failed'

type Plan = {
  id: string
  name: string
  priceLabel: string
  amount: number
  creditsLabel: string
  accent: string
  description: string
  features: string[]
}

type Session = {
  id: string
  plan: Plan
  checkoutUrl: string
  qrCodeValue: string
  redirectUrl: string
  status: PaymentStatus
  providerReady: boolean
  clientReference: string
  customOrderId: string
  twitterId: string
  providerPrice: number | null
  lastWebhookEvent: string | null
  lastWebhookStatus: string | null
  lastWebhookAt: string | null
  createdAt: string
  updatedAt: string
}

type ApiResponse<T> = {
  message: string
  code: number
  data: T
}

async function requestJson<T>(input: RequestInfo, init?: RequestInit) {
  const response = await fetch(input, {
    headers: {
      'Content-Type': 'application/json',
    },
    ...init,
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || 'Request failed')
  }

  return (await response.json()) as ApiResponse<T>
}

function buildStatusMeta(session: Session) {
  if (session.status === 'success') {
    return {
      title: '付款成功',
      description: `${session.twitterId} 的 ${session.plan.priceLabel} 已完成付款，${session.plan.creditsLabel} 已可視為入帳。`,
      tone: 'is-success',
    }
  }

  if (session.status === 'failed') {
    return {
      title: '付款失敗',
      description: `${session.twitterId} 的付款流程未完成，請重新建立 KiraPay payment link 或改用其他付款方式。`,
      tone: 'is-failed',
    }
  }

  return {
    title: '等待付款中',
    description: 'KiraPay 付款頁完成後會回到此頁，前端會持續檢查 session 與 webhook 狀態直到付款結果確定。',
    tone: 'is-pending',
  }
}

const clearCheckoutQuery = () => {
  const url = new URL(window.location.href)

  url.searchParams.delete('sessionId')
  url.searchParams.delete('source')

  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
}

function App() {
  const [plans, setPlans] = useState<Plan[]>([])
  const [activeSession, setActiveSession] = useState<Session | null>(null)
  const [returnSession, setReturnSession] = useState<Session | null>(null)
  const [twitterId, setTwitterId] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    const loadPlans = async () => {
      try {
        setIsLoading(true)
        const response = await requestJson<Plan[]>('/api/plans')
        setPlans(response.data)
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : '載入方案失敗')
      } finally {
        setIsLoading(false)
      }
    }

    void loadPlans()
  }, [])

  useEffect(() => {
    const sessionId = new URLSearchParams(window.location.search).get('sessionId')

    if (!sessionId) {
      return
    }

    let isCancelled = false
    let intervalId: number | null = null

    const syncReturnedSession = async () => {
      try {
        const response = await requestJson<Session>(`/api/payments/session/${sessionId}`)

        if (isCancelled) {
          return
        }

        setReturnSession(response.data)

        if (response.data.status !== 'pending' && intervalId !== null) {
          window.clearInterval(intervalId)
          intervalId = null
        }
      } catch (error) {
        if (!isCancelled) {
          setErrorMessage(error instanceof Error ? error.message : '讀取付款回傳結果失敗')
        }

        if (intervalId !== null) {
          window.clearInterval(intervalId)
          intervalId = null
        }
      }
    }

    void syncReturnedSession()
    intervalId = window.setInterval(() => {
      void syncReturnedSession()
    }, 5000)

    return () => {
      isCancelled = true

      if (intervalId !== null) {
        window.clearInterval(intervalId)
      }
    }
  }, [])

  useEffect(() => {
    if (!activeSession || activeSession.status !== 'pending') {
      return
    }

    const intervalId = window.setInterval(async () => {
      try {
        const response = await requestJson<Session>(`/api/payments/session/${activeSession.id}`)
        setActiveSession(response.data)
      } catch {
        window.clearInterval(intervalId)
      }
    }, 5000)

    return () => window.clearInterval(intervalId)
  }, [activeSession])

  const activeStatusMeta = useMemo(() => (activeSession ? buildStatusMeta(activeSession) : null), [activeSession])
  const returnStatusMeta = useMemo(() => (returnSession ? buildStatusMeta(returnSession) : null), [returnSession])

  const startCheckout = async (planId: string) => {
    try {
      if (!twitterId.trim()) {
        setErrorMessage('請先輸入 Twitter ID')
        return
      }

      setErrorMessage('')
      setIsSubmitting(planId)
      setReturnSession(null)
      clearCheckoutQuery()
      const response = await requestJson<Session>('/api/payments/session', {
        method: 'POST',
        body: JSON.stringify({ planId, twitterId }),
      })
      setActiveSession(response.data)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '建立付款流程失敗')
    } finally {
      setIsSubmitting(null)
    }
  }

  return (
    <main className="page-shell">
      <section className="panel-card">
        <div className="section-header">
          <div>
            <h2>Top Up API Credits</h2>
            <p>後端會用 .env 內的 KIRAPAY_API_KEY 建立 Base 鏈 USDC payment link，付款後會回跳到這個頁面並顯示結果。</p>
          </div>
        </div>

        {returnSession && returnStatusMeta ? (
          <div className={`feedback-banner ${returnStatusMeta.tone} result-banner`}>
            <strong>{returnStatusMeta.title}</strong>
            <span>{returnStatusMeta.description}</span>
            <span>
              方案 {returnSession.plan.name} / customOrderId {returnSession.customOrderId}
            </span>
          </div>
        ) : null}

        {errorMessage ? <div className="feedback-banner is-failed">{errorMessage}</div> : null}

        <div className="identity-panel">
          <label className="field-label" htmlFor="twitter-id">
            Twitter ID
          </label>
          <input
            id="twitter-id"
            className="text-input"
            type="text"
            value={twitterId}
            onChange={(event) => setTwitterId(event.target.value)}
            placeholder="@your_handle"
            autoComplete="off"
          />
          <div className="field-meta">
            KiraPay payment link 的 name 會直接帶這個 Twitter ID，customOrderId 會自動帶對應方案與 session。
          </div>
        </div>

        <div className="pricing-grid">
          {isLoading
            ? [1, 2, 3].map((item) => (
                <article className="pricing-card skeleton-card" key={item}>
                  <div className="skeleton-line large" />
                  <div className="skeleton-line medium" />
                  <div className="skeleton-line" />
                  <div className="skeleton-line" />
                  <div className="skeleton-line" />
                </article>
              ))
            : plans.map((plan, index) => (
                <article className={`pricing-card ${index === 1 ? 'featured' : ''}`} key={plan.id}>
                  <div className="plan-header">
                    <div>
                      <h3>{plan.name}</h3>
                      <p>{plan.description}</p>
                    </div>
                    <span className="plan-badge">{plan.accent}</span>
                  </div>
                  <div className="plan-price">{plan.priceLabel}</div>
                  <div className="plan-credits">{plan.creditsLabel}</div>
                  <ul className="plan-features">
                    {plan.features.map((feature) => (
                      <li key={feature}>{feature}</li>
                    ))}
                  </ul>
                  <button
                    className={`cta-button ${index === 1 ? 'primary' : ''}`}
                    type="button"
                    onClick={() => void startCheckout(plan.id)}
                    disabled={Boolean(isSubmitting) || !twitterId.trim()}
                  >
                    {isSubmitting === plan.id ? 'Opening KiraPay...' : `Top Up ${plan.priceLabel}`}
                  </button>
                </article>
              ))}
        </div>
      </section>

      {activeSession ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setActiveSession(null)}>
          <div className="checkout-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="modal-top">
              <div>
                <span className="section-kicker">KiraPay Checkout</span>
                <h3>{activeSession.plan.name}</h3>
                <p>
                  掃描 QRCode 或開啟外部 checkout 頁面完成付款。此畫面會保留付款結果狀態與對應訊息。
                </p>
              </div>
              <button className="close-button" type="button" onClick={() => setActiveSession(null)}>
                ×
              </button>
            </div>

            <div className="modal-content">
              <div className="qr-panel">
                <div className="qr-frame">
                  <QRCodeSVG value={activeSession.qrCodeValue} size={180} bgColor="#ffffff" fgColor="#111111" includeMargin />
                </div>
                <div className="qr-caption">{activeSession.plan.priceLabel}</div>
                <a className="cta-button primary full-width" href={activeSession.checkoutUrl} target="_blank" rel="noreferrer">
                  Open KiraPay Checkout
                </a>
                <div className="field-meta centered-text">付款完成後，KiraPay 會導回 {activeSession.redirectUrl}</div>
              </div>

              <div className="status-panel">
                {activeStatusMeta ? (
                  <div className={`feedback-banner ${activeStatusMeta.tone}`}>
                    <strong>{activeStatusMeta.title}</strong>
                    <span>{activeStatusMeta.description}</span>
                  </div>
                ) : null}

                <div className="detail-grid">
                  <div className="detail-item">
                    <span>Twitter ID</span>
                    <strong>{activeSession.twitterId}</strong>
                  </div>
                  <div className="detail-item">
                    <span>Session Ref</span>
                    <strong className="truncate">{activeSession.clientReference}</strong>
                  </div>
                  <div className="detail-item">
                    <span>customOrderId</span>
                    <strong className="truncate">{activeSession.customOrderId}</strong>
                  </div>
                  <div className="detail-item">
                    <span>Plan</span>
                    <strong>{activeSession.plan.name}</strong>
                  </div>
                  <div className="detail-item">
                    <span>Amount</span>
                    <strong>{activeSession.plan.priceLabel}</strong>
                  </div>
                  <div className="detail-item">
                    <span>Checkout URL</span>
                    <strong className="truncate">{activeSession.checkoutUrl}</strong>
                  </div>
                  <div className="detail-item">
                    <span>Redirect URL</span>
                    <strong className="truncate">{activeSession.redirectUrl}</strong>
                  </div>
                  <div className="detail-item">
                    <span>Merchant API</span>
                    <strong>{activeSession.providerReady ? 'Connected' : 'Configured'}</strong>
                  </div>
                  <div className="detail-item">
                    <span>KiraPay Price</span>
                    <strong>{activeSession.providerPrice ? `${activeSession.providerPrice} USDC` : 'Waiting for provider'}</strong>
                  </div>
                  <div className="detail-item">
                    <span>Webhook Event</span>
                    <strong>{activeSession.lastWebhookEvent ?? 'Waiting'}</strong>
                  </div>
                  <div className="detail-item">
                    <span>Webhook Status</span>
                    <strong>{activeSession.lastWebhookStatus ?? 'Pending callback'}</strong>
                  </div>
                </div>

                <div className="webhook-note">
                  這筆 payment link 會以 Base 鏈 USDC 建立，name 使用 Twitter ID，customOrderId 會對應方案與 session。完成付款後會先導回首頁，再由 webhook / session 狀態自動更新結果。
                </div>

                {activeSession.status === 'success' ? (
                  <div className="success-reward">
                    <span>已發送內容</span>
                    <strong>{activeSession.plan.creditsLabel}</strong>
                    <p>系統已將本次 Top Up 視為完成，可依你的實際業務流程發放 API credits 或對應權益。</p>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}

export default App
