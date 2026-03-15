# Subscription Model

## Tiers

| Plan | Price | Projects | Sparks | Sparks/Flow | Messages/Chat |
|------|-------|----------|--------|-------------|---------------|
| Free | $0/mo | 1 | 2 | 1 | 50 |
| Lite | $5/mo | 5 | 5 | 3 | 500 |
| Premium | $30/mo (14-day trial) | 999 | 999 | 7 | 999,999 |
| Team | $20/seat/mo (min 3, max 100) | 999 | 999 | 7 | 999,999 |
| Academic | Free (access code) | 999 | 999 | 7 | 999,999 |

## Analysis Phases (NOT plan-gated)

All authenticated users get both phases. Only unauthenticated demo users are limited to Phase 1.

- **Phase 1 (Demo)**: Inline ~10-15s. Top 3 keywords, 10 sources/entity, 3 YouTube videos, AI image, voice classification.
- **Phase 2 (Full)**: Background. All keywords, 300 sources/entity, 7 YouTube videos, regenerates system prompt & description.

Gate: `continueToFullAnalysis: !!authenticatedUserId` (auth check, not plan check).

## Premium-only Features

- Custom voice IDs
- API endpoint per Mind
- Priority support

## Plan Resolution Priority

Team subscription > Academic enrollment > Stripe subscription (Premium/Lite) > Free fallback.

## Key Files

- `utils/plans.ts` — plan limits
- `server/utils/stripe.ts` — Stripe client, plan resolution
- `server/utils/subscription-guard.ts` — access control
- `server/api/billing/` — all billing APIs
- `composables/auth/useSubscription.ts` — client-side subscription
